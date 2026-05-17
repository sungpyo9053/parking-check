from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Place
from ..schemas.place import PlaceSearchItem, PlaceSearchResponse
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
    return PlaceSearchResponse(items=items)
