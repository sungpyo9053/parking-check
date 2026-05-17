from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FavoriteGroupCreate(BaseModel):
    name: str | None = Field(default=None, max_length=80)


class FavoriteGroupOut(BaseModel):
    id: int
    code: str
    name: str | None
    created_at: datetime


class FavoriteItemCreate(BaseModel):
    place_id: int | None = None
    name: str = Field(..., min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    lat: float
    lng: float
    added_by: str | None = Field(default=None, max_length=64)


class FavoriteItemOut(BaseModel):
    id: int
    place_id: int | None
    name: str
    address: str | None
    lat: float
    lng: float
    added_by: str | None
    created_at: datetime


class FavoriteGroupDetail(BaseModel):
    group: FavoriteGroupOut
    items: list[FavoriteItemOut]
