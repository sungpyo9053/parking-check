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
    HistoryBlock,
    HistoryForDestination,
    HistoryLastVisit,
    NearbyItem,
    NearbyResponse,
    RealtimeBlock,
    SelfParking,
)
from ..services.parking_search import latest_realtime_for_lots, nearby_parking_lots
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

    self_parking = estimate_self_parking(
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

    return AnalyzeResponse(
        destination=Destination(
            place_id=dest_place.id if dest_place else None,
            name=dest_name,
            address=dest_addr,
            lat=dest_lat,
            lng=dest_lng,
        ),
        self_parking=SelfParking(**self_parking),
        summary=summary,
        candidates=candidates,
        history_for_destination=history_dest_rows,
        disclaimers=disclaimers,
    )
