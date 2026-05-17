from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..services.discover import Category, cache_stats, discover_hot_places

router = APIRouter(prefix="/api/discover", tags=["discover"])


class HotPlaceItem(BaseModel):
    name: str
    category: str | None = None
    category_group_code: str | None = None
    phone: str | None = None
    address: str | None = None
    road_address: str | None = None
    lat: float
    lng: float
    distance_m: int
    walking_minutes: int | None = None
    place_url: str | None = None
    hot_score: float
    instagram_mentions: int = 0
    region_label: str | None = None


class HotResponse(BaseModel):
    category: Literal["cafe", "food", "sights"]
    label: str
    region: str | None = None
    items: list[HotPlaceItem]


_LABEL = {"cafe": "카페", "food": "맛집", "sights": "가볼곳"}


@router.get("/hot", response_model=HotResponse)
def discover_hot(
    lat: float = Query(...),
    lng: float = Query(...),
    category: Category = Query("cafe"),
    limit: int = Query(3, ge=1, le=5),
    radius: int = Query(1500, ge=200, le=5000),
) -> HotResponse:
    items = discover_hot_places(lat, lng, category, limit=limit, radius_m=radius)
    if not items:
        # 빈 응답은 정상 (404 안 던짐) — 프론트가 안내 문구로 처리
        return HotResponse(category=category, label=_LABEL[category], items=[])
    return HotResponse(
        category=category,
        label=_LABEL[category],
        region=items[0].get("region_label"),
        items=[HotPlaceItem(**i) for i in items],
    )


@router.get("/cache-stats")
def discover_cache_stats() -> dict:
    return cache_stats()
