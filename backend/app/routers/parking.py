from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Place
from ..schemas.parking import (
    AnalyzeResponse,
    AnalyzeSummary,
    Candidate,
    Destination,
    ExternalCandidate,
    HistoryBlock,
    HistoryForDestination,
    HistoryLastVisit,
    NearbyItem,
    NearbyResponse,
    RealtimeBlock,
    SelfParking,
    TopRecommendation,
)
from ..services.external_recommender import pick_top_external
from ..services.parking_fallback import collect_external_candidates
from ..services.parking_search import latest_realtime_for_lots, nearby_parking_lots
from ..services.self_parking_web import enrich_self_parking
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


@router.get("/analyze", response_model=AnalyzeResponse)
def analyze(
    place_id: Optional[int] = Query(None),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: int = Query(500, ge=50, le=3000),
    limit: int = Query(20, ge=1, le=50),
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
        dest_name = None
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

    candidates.sort(key=lambda c: c.score, reverse=True)

    self_parking_base = estimate_self_parking(
        db,
        destination_name=dest_name,
        destination_address=dest_addr,
        lat=dest_lat,
        lng=dest_lng,
    )
    # 웹 검색 evidence 로 보강 (TAVILY 키/WEB_SEARCH_ENABLED 활성 시에만)
    self_parking = enrich_self_parking(
        self_parking_base,
        dest_name=dest_name,
        dest_addr=dest_addr,
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
        self_parking_unknown=self_parking.status == "unknown",
    )
    external_candidates = list(fallback.evidence_items)

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
    # 자체 주차가 명확히 가능(available)하거나 가능성 높음(likely)이면 그쪽이
    # 곧 답이므로 별도 외부 추천을 강조하지 않는다 (사용자 결정 방해 방지).
    top_rec: TopRecommendation | None = None
    if self_parking.status not in ("available", "likely"):
        top_cand, top_score, top_reasons = pick_top_external(external_candidates)
        if top_cand is not None:
            walk = top_cand.walking_minutes
            dist = top_cand.distance_m
            if walk is not None and dist is not None:
                rationale = (
                    f"외부 후보 {len(external_candidates)}개 중 거리·개방성·정보 신뢰도를 "
                    f"종합해 1순위로 추천합니다. 주차 후 목적지까지 직선거리 기준 "
                    f"도보 약 {walk}분 ({dist}m)."
                )
            else:
                rationale = (
                    f"외부 후보 {len(external_candidates)}개 중 거리·개방성·정보 신뢰도를 "
                    f"종합해 1순위로 추천합니다."
                )
            top_rec = TopRecommendation(
                candidate=top_cand,
                score=top_score,
                reasons=top_reasons,
                rationale=rationale,
            )

    return AnalyzeResponse(
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
        fallback=fallback,
        history_for_destination=history_dest_rows,
        disclaimers=disclaimers,
    )
