from __future__ import annotations

from pydantic import BaseModel


class PlaceSearchItem(BaseModel):
    external_source: str
    external_id: str | None = None
    place_id: int | None = None
    name: str
    address: str | None = None
    road_address: str | None = None
    category: str | None = None
    lat: float
    lng: float


class PlaceSearchResponse(BaseModel):
    items: list[PlaceSearchItem]
    # AI 의도 추천 — Groq 가 후보 중 하나를 사용자 의도로 판단
    ai_best_index: int | None = None
    ai_reason: str | None = None
