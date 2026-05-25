from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Place, PlaceSelfParkingFeedback
from ..schemas.place import PlaceSearchItem, PlaceSearchResponse
from ..schemas.self_parking_feedback import (
    SelfParkingFeedbackCreate,
    SelfParkingFeedbackItem,
    SelfParkingFeedbackSummary,
)
from ..services.kakao import KakaoAPIError, search_keyword

router = APIRouter(prefix="/api/places", tags=["places"])


@router.get("/search", response_model=PlaceSearchResponse)
def places_search(
    query: str = Query(..., min_length=1, max_length=80),
    size: int = Query(10, ge=1, le=15),
    db: Session = Depends(get_db),
) -> PlaceSearchResponse:
    try:
        documents = search_keyword(query, size=size)
    except KakaoAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    items: list[PlaceSearchItem] = []
    for d in documents:
        try:
            lat = float(d["y"])
            lng = float(d["x"])
        except (KeyError, TypeError, ValueError):
            continue

        external_id = str(d.get("id") or "")
        # upsert(아주 단순)
        existing: Place | None = db.execute(
            select(Place).where(
                Place.external_source == "kakao",
                Place.external_id == external_id,
            )
        ).scalar_one_or_none() if external_id else None

        if existing is None:
            existing = Place(
                external_source="kakao",
                external_id=external_id or None,
                name=d.get("place_name") or "",
                address=d.get("address_name"),
                road_address=d.get("road_address_name"),
                category=d.get("category_name"),
                lat=lat,
                lng=lng,
                updated_at=datetime.now(timezone.utc),
            )
            db.add(existing)
            db.flush()
        else:
            # 가벼운 갱신
            existing.name = d.get("place_name") or existing.name
            existing.address = d.get("address_name") or existing.address
            existing.road_address = d.get("road_address_name") or existing.road_address
            existing.category = d.get("category_name") or existing.category
            existing.lat = lat
            existing.lng = lng
            existing.updated_at = datetime.now(timezone.utc)

        items.append(
            PlaceSearchItem(
                external_source="kakao",
                external_id=external_id or None,
                place_id=existing.id,
                name=existing.name,
                address=existing.address,
                road_address=existing.road_address,
                category=existing.category,
                lat=existing.lat,
                lng=existing.lng,
            )
        )

    db.commit()

    # Groq 의도 추천 — 후보가 2개 이상일 때 LLM 이 사용자 의도와 가장 맞는 1개 선정
    ai_best_index: int | None = None
    ai_reason: str | None = None
    try:
        if len(items) >= 2:
            from ..services import llm_parking_verifier as llm_v

            res = llm_v.pick_search_intent(
                query,
                [
                    {
                        "name": it.name,
                        "category": it.category,
                        "road_address": it.road_address,
                        "address": it.address,
                    }
                    for it in items
                ],
            )
            if res and res.get("best_index", -1) >= 0:
                ai_best_index = res["best_index"]
                ai_reason = res["reason"]
    except Exception as e:  # noqa: BLE001
        import logging as _lg
        _lg.getLogger(__name__).warning("search intent failed: %s", e)

    return PlaceSearchResponse(items=items, ai_best_index=ai_best_index, ai_reason=ai_reason)


# --- 자체 주차 사용자 피드백 ---

@router.post(
    "/{place_id}/self-parking-feedback",
    response_model=SelfParkingFeedbackItem,
    status_code=201,
)
def submit_self_parking_feedback(
    place_id: int,
    body: SelfParkingFeedbackCreate,
    db: Session = Depends(get_db),
) -> SelfParkingFeedbackItem:
    place: Place | None = db.execute(
        select(Place).where(Place.id == place_id)
    ).scalar_one_or_none()
    if place is None:
        raise HTTPException(status_code=404, detail="place_id not found")

    row = PlaceSelfParkingFeedback(
        place_id=place_id,
        answer=body.answer,
        note=(body.note or None),
        user_token=(body.user_token or None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return SelfParkingFeedbackItem(
        id=row.id,
        place_id=row.place_id,
        answer=row.answer,  # type: ignore[arg-type]
        note=row.note,
        created_at=row.created_at,
    )


@router.get(
    "/{place_id}/self-parking-feedback/summary",
    response_model=SelfParkingFeedbackSummary,
)
def self_parking_feedback_summary(
    place_id: int,
    db: Session = Depends(get_db),
) -> SelfParkingFeedbackSummary:
    rows = (
        db.execute(
            select(PlaceSelfParkingFeedback)
            .where(PlaceSelfParkingFeedback.place_id == place_id)
            .order_by(PlaceSelfParkingFeedback.created_at.desc())
        )
        .scalars()
        .all()
    )
    yes = sum(1 for r in rows if r.answer == "yes")
    no = sum(1 for r in rows if r.answer == "no")
    unk = sum(1 for r in rows if r.answer == "unknown")
    last = rows[0] if rows else None
    return SelfParkingFeedbackSummary(
        place_id=place_id,
        yes_count=yes,
        no_count=no,
        unknown_count=unk,
        total=len(rows),
        last_answer=last.answer if last else None,  # type: ignore[arg-type]
        last_at=last.created_at if last else None,
    )
