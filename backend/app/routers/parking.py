from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..db import SessionLocal
from ..models import Place, PlaceSelfParkingFeedback, SearchLog
from ..schemas.parking import (
    AnalyzeResponse,
    AnalyzeSummary,
    Candidate,
    Destination,
    ExternalCandidate,
    HistoryBlock,
    HistoryForDestination,
    HistoryLastVisit,
    MenuBlock,
    MenuItem,
    NearbyItem,
    NearbyResponse,
    RealtimeBlock,
    SelfParking,
    SelfParkingFeedbackStats,
    TopRecommendation,
)
from ..services.external_recommender import pick_top_external
from ..services.kakao_place_detail import (
    KakaoPlaceDetail,
    extract_place_id as extract_kakao_place_id,
    fetch_detail_sync as fetch_kakao_detail,
)
from ..services.llm_summary import summarize_analysis
from ..services.menu_extractor import extract_menus, is_food_place
from ..services.parking_fallback import collect_external_candidates
from ..services.parking_search import latest_realtime_for_lots, nearby_parking_lots
from ..services.self_parking_web import enrich_self_parking
from ..services.walking_route import batch_compute as walking_batch_compute
from ..services.recommendation import (
    classify_congestion,
    fee_summary,
    is_open_now,
    score_candidate,
)
from ..services.self_parking import estimate_self_parking
from ..services.visit_history import history_for_place, personal_stats_for_lots
from ..utils.geo import walk_minutes

router = APIRouter(prefix="/api/parking", tags=["parking"])


def _self_parking_feedback_stats(db: Session, place_id: int) -> SelfParkingFeedbackStats:
    rows = (
        db.execute(
            select(PlaceSelfParkingFeedback).where(
                PlaceSelfParkingFeedback.place_id == place_id
            )
        )
        .scalars()
        .all()
    )
    yes = sum(1 for r in rows if r.answer == "yes")
    no = sum(1 for r in rows if r.answer == "no")
    unk = sum(1 for r in rows if r.answer == "unknown")
    return SelfParkingFeedbackStats(
        place_id=place_id,
        yes_count=yes,
        no_count=no,
        unknown_count=unk,
        total=len(rows),
    )


@router.get("/nearby", response_model=NearbyResponse)
def nearby(
    lat: float = Query(...),
    lng: float = Query(...),
    radius: int = Query(500, ge=50, le=3000),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
) -> NearbyResponse:
    rows = nearby_parking_lots(db, lat=lat, lng=lng, radius_m=radius, limit=limit)
    items = [
        NearbyItem(
            id=r["id"],
            name=r["name"],
            type=r.get("type"),
            parking_type=r.get("parking_type"),
            distance_m=r["distance_m"],
            lat=r["lat"],
            lng=r["lng"],
            capacity=r.get("capacity"),
            fee_type=r.get("fee_type"),
            base_time=r.get("base_time"),
            base_fee=r.get("base_fee"),
            extra_time=r.get("extra_time"),
            extra_fee=r.get("extra_fee"),
            road_address=r.get("road_address"),
        )
        for r in rows
    ]
    return NearbyResponse(count=len(items), radius=radius, items=items)


def _persist_search_log(payload: dict) -> None:
    """fire-and-forget DB insert. 실패는 조용히 로그만 — 사용자 응답에 영향 없게."""
    try:
        with SessionLocal() as s:
            s.add(SearchLog(**payload))
            s.commit()
    except Exception as e:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).warning("search_log insert failed: %s", e)


@router.get("/analyze", response_model=AnalyzeResponse)
def analyze(
    background: BackgroundTasks,
    request: Request,
    place_id: Optional[int] = Query(None),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    name: Optional[str] = Query(
        None,
        description=(
            "매장 이름 (선택). place_id 가 없을 때 자체주차 웹 검색 키워드로 사용. "
            "Kakao keyword search 에서 좌표만 가져온 경우 반드시 전달해야 정확도가 올라간다."
        ),
    ),
    radius: int = Query(500, ge=50, le=3000),
    limit: int = Query(20, ge=1, le=50),
    user_token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> AnalyzeResponse:
    # 목적지 결정
    dest_place: Place | None = None
    if place_id is not None:
        dest_place = db.execute(select(Place).where(Place.id == place_id)).scalar_one_or_none()
        if dest_place is None:
            raise HTTPException(status_code=404, detail="place_id not found")
        dest_lat = dest_place.lat
        dest_lng = dest_place.lng
        dest_name = dest_place.name
        dest_addr = dest_place.road_address or dest_place.address
    elif lat is not None and lng is not None:
        dest_lat, dest_lng = lat, lng
        # name 이 주어졌으면 자체주차 웹 검색 키워드로 활용. 없으면 None.
        dest_name = name.strip() if name and name.strip() else None
        dest_addr = None
    else:
        raise HTTPException(status_code=400, detail="place_id 또는 lat+lng 가 필요합니다.")

    # 후보 조회
    lots = nearby_parking_lots(db, lat=dest_lat, lng=dest_lng, radius_m=radius, limit=limit)
    lot_ids = [l["id"] for l in lots]

    realtime_map = latest_realtime_for_lots(db, lot_ids)
    personal_map = personal_stats_for_lots(db, lot_ids)

    candidates: list[Candidate] = []
    any_full_risk = False
    for lot in lots:
        rt = realtime_map.get(lot["id"])
        open_now = is_open_now(lot)
        personal = personal_map.get(lot["id"])
        score, reasons = score_candidate(lot, rt, open_now, personal)
        congestion = classify_congestion(rt, lot)
        if congestion in ("risky", "full"):
            any_full_risk = True

        rt_block: RealtimeBlock | None = None
        if rt:
            from datetime import datetime, timezone

            stale = None
            if rt.get("observed_at"):
                stale = int(
                    (datetime.now(timezone.utc) - rt["observed_at"]).total_seconds()
                )
            rt_block = RealtimeBlock(
                available_count=rt.get("available_count"),
                total_capacity=rt.get("total_capacity"),
                observed_at=rt.get("observed_at"),
                source=rt.get("source"),
                stale_seconds=stale,
            )

        history_block = None
        if personal:
            total = personal.get("total") or 0
            success = personal.get("success") or 0
            success_rate = (success / total) if total else None
            last = (
                HistoryLastVisit(
                    result=personal.get("last_result"),
                    visited_at=personal.get("last_visit_at"),
                )
                if personal.get("last_visit_at")
                else None
            )
            history_block = HistoryBlock(
                my_visits=total,
                my_success_rate=round(success_rate, 2) if success_rate is not None else None,
                last_visit=last,
            )

        candidates.append(
            Candidate(
                id=lot["id"],
                name=lot["name"],
                type=lot.get("type"),
                lat=lot["lat"],
                lng=lot["lng"],
                distance_m=lot["distance_m"],
                walk_minutes=walk_minutes(lot["distance_m"]),
                capacity=lot.get("capacity"),
                fee_summary=fee_summary(lot),
                is_open_now=open_now,
                realtime=rt_block,
                congestion=congestion,
                score=score,
                reasons=reasons,
                history=history_block,
            )
        )

    # DB candidates 에도 실 도보 경로 적용
    if candidates:
        pairs = [(c.lat, c.lng, dest_lat, dest_lng) for c in candidates]
        routes = walking_batch_compute(pairs)
        for c, r in zip(candidates, routes):
            c.walking_route_distance_m = r["distance_m"]
            c.walk_minutes = r["walking_minutes"]
            c.walking_route_source = r["source"]  # type: ignore[assignment]

    candidates.sort(key=lambda c: c.score, reverse=True)

    self_parking_base = estimate_self_parking(
        db,
        destination_name=dest_name,
        destination_address=dest_addr,
        lat=dest_lat,
        lng=dest_lng,
    )

    # data_quality 휴리스틱
    with_rt = sum(1 for c in candidates if c.realtime)
    if not candidates:
        quality = "sparse"
    elif with_rt / max(1, len(candidates)) >= 0.5:
        quality = "rich"
    elif with_rt > 0:
        quality = "partial"
    else:
        quality = "sparse"

    summary = AnalyzeSummary(
        nearby_count=len(candidates),
        nearest_distance_m=lots[0]["distance_m"] if lots else None,
        any_full_risk=any_full_risk,
        data_quality=quality,
    )

    history_dest_rows: list[HistoryForDestination] = []
    if place_id is not None:
        for r in history_for_place(db, place_id, limit=10):
            history_dest_rows.append(
                HistoryForDestination(
                    visit_id=r["visit_id"],
                    selected_parking_name=r.get("selected_parking_name"),
                    searched_at=r["searched_at"],
                    actual_result=r.get("actual_result"),
                    memo=r.get("memo"),
                )
            )

    disclaimers = ["실시간 정보는 현장과 5분 이상 차이가 날 수 있습니다."]

    # --- 외부(Kakao/Web) 폴백 ---
    # DB 후보를 dedup 비교용 ExternalCandidate 로 가볍게 표현 (UI 에는 노출 안 함).
    db_as_external = [
        ExternalCandidate(
            source="public_db",
            source_label="공공데이터 기반",
            name=c.name,
            lat=c.lat,
            lng=c.lng,
        )
        for c in candidates
    ]
    fallback = collect_external_candidates(
        db_count=len(candidates),
        db_existing=db_as_external,
        destination_name=dest_name,
        destination_address=dest_addr,
        lat=dest_lat,
        lng=dest_lng,
        radius_m=radius,
        self_parking_unknown=(self_parking_base.get("status") == "unknown"),
    )
    external_candidates = list(fallback.evidence_items)

    # 외부 후보 중 '목적지명 일치(매장 자체 주차장)' 매칭 후보가 있으면
    # self_parking 을 likely 로 격상 (Tavily/Naver evidence 0건이어도)
    has_kakao_self = any(
        any("목적지명" in r for r in c.usability_reasons)
        for c in (external_candidates + (fallback.excluded_items or []))
    )

    # 웹 검색 evidence + 카테고리 prior + 카카오 자체 주차장 POI 매칭 으로 보강
    self_parking = enrich_self_parking(
        self_parking_base,
        dest_name=dest_name,
        dest_addr=dest_addr,
        dest_category=dest_place.category if dest_place else None,
        has_kakao_self_parking=has_kakao_self,
    )

    # 사용자 셀프 라벨링(PlaceSelfParkingFeedback) 가산 — 데이터 플라이휠.
    # 의도: 시스템이 uncertain/unknown 으로 본 매장이라도 방문자 다수가 "있었음" 으로
    # 답하면 confidence + status 격상. 반대로 다수가 "없었음" 이면 강등.
    # 임계값:
    #   total>=2 + yes_ratio>=0.7 → +30, uncertain/unknown → likely
    #   total>=5 + yes_ratio>=0.8 → +50
    #   total>=3 + yes_ratio<=0.3 + no_count>=2 → -20, likely/available → uncertain
    if dest_place is not None:
        _fb = _self_parking_feedback_stats(db, dest_place.id)
        _total = _fb.total or 0
        _yes = _fb.yes_count or 0
        _no = _fb.no_count or 0
        _yes_ratio = (_yes / _total) if _total else 0.0
        if _total >= 2 and _yes >= 2 and _yes_ratio >= 0.7:
            bonus = 50 if (_total >= 5 and _yes_ratio >= 0.8) else 30
            self_parking.confidence = min(100, (self_parking.confidence or 0) + bonus)
            if self_parking.status in ("unknown", "uncertain"):
                self_parking.status = "likely"
                self_parking.label = "자체 주차 가능 (사용자 보고 다수)"
                self_parking.reason = (
                    (self_parking.reason or "")
                    + f" / 사용자 보고 {_total}건 중 {_yes}건이 '있었음'."
                ).strip(" /")
        elif _total >= 3 and _yes_ratio <= 0.3 and _no >= 2:
            self_parking.confidence = max(
                0, (self_parking.confidence or 0) - 20
            )
            if self_parking.status in ("available", "likely"):
                self_parking.status = "uncertain"
                self_parking.reason = (
                    (self_parking.reason or "")
                    + f" / 사용자 보고 {_total}건 중 {_no}건이 '없었음'."
                ).strip(" /")

    if len(candidates) == 0 and len(external_candidates) == 0:
        disclaimers.append(
            "현재 연결된 데이터 소스에서는 반경 내 주차장 후보를 찾지 못했습니다. "
            "카카오맵/현장 확인이 필요합니다."
        )
    if len(external_candidates) > 0:
        disclaimers.append(
            "카카오/웹 검색 기반 후보는 실시간 가용 여부를 알 수 없으니 방문 전 확인이 필요합니다."
        )

    # --- 최우선 추천 1개 선정 ---
    # 자체 주차 가능 여부와 무관하게 외부 후보 중 1위는 항상 노출 — 자체로 안 되는
    # 만약을 위한 백업 + 지도에 ⭐ 마커로 시각 표시. 자체 주차 카드와 시각 충돌은
    # frontend 에서 카드 노출 분기로 해결.
    top_rec: TopRecommendation | None = None

    # LLM 검증 (Groq) — 모든 외부 후보를 병렬로 검증해서 순위 조절 + 실제 가능
    # 여부 체크. 룰베이스 classifier 놓친 케이스 차단 (피드백: 거위 버그).
    # 캐시 hit 시 0ms, miss 면 동시 6 worker 로 보통 1~3초.
    try:
        from ..services import llm_parking_verifier as llm_v

        if llm_v.is_enabled() and external_candidates:
            # 비용/TPM 한도 보호 — 가장 가까운 3건만 LLM 검증.
            # 1순위 + 그 옆 후보들이 회사/관공서 자체 주차장인지 차단이 핵심.
            # 그 이상은 classifier 룰(60+ 키워드) 만으로 충분.
            sorted_by_dist = sorted(
                enumerate(external_candidates),
                key=lambda x: x[1].distance_m if x[1].distance_m is not None else 99999,
            )
            target_indices = [i for i, _ in sorted_by_dist[:3]]
            target_set = set(target_indices)
            batch_input = [
                {
                    "name": c.name,
                    "category": c.category,
                    "address": c.address or c.road_address,
                    "destination_name": dest_name,
                }
                for i, c in enumerate(external_candidates)
                if i in target_set
            ]
            llm_subset_results = llm_v.verify_batch(batch_input)
            # 원본 index 순서로 펼침
            llm_results: list = [None] * len(external_candidates)
            for k, orig_i in enumerate(target_indices):
                llm_results[orig_i] = llm_subset_results[k]
            import logging as _lg
            _llog = _lg.getLogger(__name__)
            verified = 0
            promoted = 0
            demoted = 0
            blocked = 0
            for cand, res in zip(external_candidates, llm_results):
                if res is None:
                    continue
                verified += 1
                # LLM 결과 후보에 저장 (사용자 화면에 노출)
                cand.llm_verdict = res.verdict  # type: ignore[assignment]
                cand.llm_reason = res.reason
                cand.llm_confidence = res.confidence  # type: ignore[assignment]
                cand.usability_reasons = list(cand.usability_reasons or []) + [
                    f"LLM: {res.reason}"
                ]
                if res.verdict == "restricted":
                    cand.usability = "private_restricted"  # type: ignore[assignment]
                    cand.usability_label = "추천 제외 (LLM 검증)"
                    blocked += 1
                elif res.verdict == "uncertain":
                    if cand.usability == "usable":
                        cand.usability = "caution"  # type: ignore[assignment]
                        cand.usability_label = "확인 필요 (LLM 모호)"
                        demoted += 1
                elif res.verdict == "open_to_public":
                    # LLM 이 일반 개방 확신 → AI 추천 라벨 + 점수 승격
                    if res.confidence in ("high", "medium"):
                        cand.llm_recommended = True  # ⭐AI 배지
                    if cand.usability == "caution" and res.confidence in ("high", "medium"):
                        cand.usability = "usable"  # type: ignore[assignment]
                        cand.usability_label = "추천 가능 (LLM 검증)"
                        promoted += 1
            _llog.info(
                "LLM verify: total=%d verified=%d blocked=%d demoted=%d promoted=%d",
                len(external_candidates), verified, blocked, demoted, promoted,
            )

            # LLM 결과 반영 후 fallback.shown/excluded 재분류 — 사용자 화면에서
            # restricted 된 후보가 표시되지 않도록.
            new_shown: list[ExternalCandidate] = []
            new_excluded: list[ExternalCandidate] = list(fallback.excluded_items or [])
            for c in external_candidates:
                if c.usability == "private_restricted":
                    new_excluded.append(c)
                else:
                    new_shown.append(c)
            fallback.evidence_items = new_shown
            fallback.excluded_items = new_excluded
            fallback.usable_count = sum(1 for c in new_shown if c.usability == "usable")
            fallback.caution_count = sum(1 for c in new_shown if c.usability == "caution")
            fallback.excluded_count = len(new_excluded)
            external_candidates = new_shown
    except Exception as e:  # noqa: BLE001
        import logging as _lg
        _lg.getLogger(__name__).warning("LLM batch verify failed: %s", e)

    top_cand, top_score, top_reasons = pick_top_external(external_candidates)

    if top_cand is not None:
        walk = top_cand.walking_minutes
        dist = top_cand.walking_route_distance_m or top_cand.distance_m
        src = top_cand.walking_route_source
        time_phrase = (
            f"도보 약 {walk}분 ({dist}m, "
            + ("실 경로)" if src == "osrm" else "직선거리)")
        ) if walk is not None and dist is not None else ""
        rationale = (
            f"외부 후보 {len(external_candidates)}개 중 거리·개방성·정보 신뢰도를 "
            f"종합해 1순위로 추천합니다."
            + (f" 주차 후 목적지까지 {time_phrase}." if time_phrase else "")
        )
        top_rec = TopRecommendation(
            candidate=top_cand,
            score=top_score,
            reasons=top_reasons,
            rationale=rationale,
        )

    # --- 메뉴(식당/카페) 추출 ---
    menu_block: MenuBlock | None = None
    if dest_place and is_food_place(dest_place.category):
        menu_items = extract_menus(dest_name, dest_place.category)
        if menu_items:
            menu_block = MenuBlock(items=[MenuItem(**m) for m in menu_items])

    # Groq 한 줄 결론 — 분석 응답에 ai_summary 로 노출 (UI 카드에 자연어 표시)
    try:
        from ..services import llm_parking_verifier as llm_v

        nearby_usable = sum(
            1 for c in external_candidates
            if c.usability == "usable" and (c.distance_m or 9999) <= 600
        )
        if self_parking.status in ("available", "likely"):
            visit_label = "차량 방문 추천 — 자체 주차 가능"
            dedicated = "있음"
        elif top_rec is not None and nearby_usable >= 1:
            visit_label = "조건부 추천 — 근처 주차장 활용"
            dedicated = "없음" if self_parking.status == "unavailable" else "확인 필요"
        elif top_rec is not None:
            visit_label = "방문 전 확인 필요"
            dedicated = "확인 필요"
        else:
            visit_label = "추천 정보 부족 — 대중교통 고려"
            dedicated = "확인 필요"
        ai_summary = llm_v.generate_summary(
            place_name=dest_name,
            visit_recommendation=visit_label,
            has_dedicated=dedicated,
            nearby_usable_count=nearby_usable,
            top_walk_min=(top_rec.candidate.walking_minutes if top_rec else None),
            top_rec_name=(top_rec.candidate.name if top_rec else None),
        )
    except Exception as e:  # noqa: BLE001
        import logging as _lg
        _lg.getLogger(__name__).warning("ai_summary failed: %s", e)
        ai_summary = None

    response = AnalyzeResponse(
        destination=Destination(
            place_id=dest_place.id if dest_place else None,
            name=dest_name,
            address=dest_addr,
            lat=dest_lat,
            lng=dest_lng,
        ),
        self_parking=self_parking,
        summary=summary,
        candidates=candidates,
        external_candidates=external_candidates,
        top_recommendation=top_rec,
        menu=menu_block,
        fallback=fallback,
        ai_summary=ai_summary,
        analysis_summary=summarize_analysis(
            dest_name=dest_name,
            self_status=self_parking.status,
            self_label=self_parking.label,
            self_reason=self_parking.reason,
            top_rec_name=(top_rec.candidate.name if top_rec else None),
            top_rec_distance_m=(
                (top_rec.candidate.walking_route_distance_m or top_rec.candidate.distance_m)
                if top_rec else None
            ),
            top_rec_walking_minutes=(top_rec.candidate.walking_minutes if top_rec else None),
            top_rec_kind=(
                "self" if self_parking.status in ("available", "likely") else "external"
            ),
        ),
        self_parking_feedback_stats=(
            _self_parking_feedback_stats(db, dest_place.id) if dest_place else None
        ),
        history_for_destination=history_dest_rows,
        disclaimers=disclaimers,
    )

    # 검색 로그 (운영자 분석용, 백그라운드 — fire-and-forget)
    try:
        background.add_task(
            _persist_search_log,
            {
                "place_id": dest_place.id if dest_place else None,
                "place_name": dest_name,
                "lat": dest_lat,
                "lng": dest_lng,
                "radius_m": radius,
                "self_parking_status": self_parking.status,
                "top_recommendation_name": (
                    top_rec.candidate.name if top_rec else None
                ),
                "top_recommendation_walking_min": (
                    top_rec.candidate.walking_minutes if top_rec else None
                ),
                "external_candidate_count": len(external_candidates),
                "user_token": user_token,
                "user_agent": request.headers.get("user-agent"),
                "referer": request.headers.get("referer"),
            },
        )
    except Exception:  # noqa: BLE001
        pass

    return response


@router.get("/nearby-pois")
def nearby_pois(
    lat: float = Query(...),
    lng: float = Query(...),
    category: str = Query(..., description="ev | subway | bus"),
    radius_m: int = Query(800, ge=100, le=3000),
):
    """목적지 주변 EV 충전소 / 지하철역 / 버스정류장 검색.
    피드백 6/5: 대중교통 정류장 + 전기차 충전소 노출."""
    from ..services import kakao as kakao_svc

    try:
        if category == "ev":
            docs = kakao_svc.search_keyword_near(
                "전기차충전소", lat=lat, lng=lng, radius_m=radius_m, size=12
            )
        elif category == "subway":
            docs = kakao_svc.search_category_nearby(
                "SW8", lat, lng, radius_m=radius_m, size=8
            )
        elif category == "bus":
            docs = kakao_svc.search_keyword_near(
                "버스정류장", lat=lat, lng=lng, radius_m=radius_m, size=10
            )
        else:
            raise HTTPException(status_code=400, detail="category must be ev|subway|bus")
    except kakao_svc.KakaoAPIError as e:
        import logging

        logging.getLogger(__name__).warning("nearby_pois kakao fail: %s", e)
        return {"items": []}

    items = []
    for d in docs:
        try:
            items.append({
                "name": d.get("place_name"),
                "address": d.get("address_name"),
                "road_address": d.get("road_address_name"),
                "category": d.get("category_name"),
                "lat": float(d["y"]),
                "lng": float(d["x"]),
                "distance_m": int(d["distance"]) if d.get("distance") else None,
                "url": d.get("place_url"),
                "phone": d.get("phone") or None,
            })
        except (KeyError, ValueError, TypeError):
            continue
    return {"items": items}


@router.get("/kakao-detail", response_model=KakaoPlaceDetail | None)
def kakao_detail(
    kakao_place_id: Optional[str] = Query(
        None, description="카카오 place_id (숫자 문자열). 예: 1263774782"
    ),
    url: Optional[str] = Query(
        None,
        description="place.map.kakao.com URL 그대로 전달해도 됨 — 자동 파싱.",
    ),
) -> KakaoPlaceDetail | None:
    """1순위 추천 후보의 카카오맵 상세 (요금/운영시간/면수/결제방식) 추출.

    프론트에서 분석 결과 받고 1순위 후보의 c.url 로 lazy 호출.
    캐시 hit 시 즉시 반환, miss 시 Playwright 호출 (~3~5초).
    """
    pid = kakao_place_id or extract_kakao_place_id(url)
    if not pid:
        raise HTTPException(
            status_code=400,
            detail="kakao_place_id 또는 url(place.map.kakao.com/...) 필요",
        )
    detail = fetch_kakao_detail(pid)
    return detail


class AskRequest(BaseModel):
    place_name: str
    place_id: int | None = None
    question: str
    visit_label: str | None = None
    dedicated: str | None = None
    nearby_count: int | None = None
    top_rec_name: str | None = None
    top_walk_min: int | None = None
    top_fee_text: str | None = None


@router.post("/ask")
def ask_about_place(req: AskRequest):
    """AI 자유 질문 — 사용자가 분석 결과 페이지에서 자유 텍스트로 질문하면
    Groq 가 분석 컨텍스트 기반 답변."""
    from ..services import llm_parking_verifier as llm_v

    answer = llm_v.answer_question(
        req.question,
        {
            "place_name": req.place_name,
            "visit_label": req.visit_label,
            "dedicated": req.dedicated,
            "nearby_count": req.nearby_count,
            "top_rec_name": req.top_rec_name,
            "top_walk_min": req.top_walk_min,
            "top_fee_text": req.top_fee_text,
        },
    )
    if not answer:
        return {"answer": None, "error": "현재 답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요."}
    return {"answer": answer, "error": None}
