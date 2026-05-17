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
