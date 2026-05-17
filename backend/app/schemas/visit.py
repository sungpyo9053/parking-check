from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

ActualResult = Literal[
    "success", "full", "waited", "entrance_lost", "fee_mismatch", "closed", "etc"
]
PredictedStatus = Literal["available", "uncertain", "risky", "full", "unknown"]


class VisitCreate(BaseModel):
    destination_name: str | None = None
    destination_place_id: int | None = None
    destination_lat: float | None = None
    destination_lng: float | None = None
    selected_parking_lot_id: int | None = None
    selected_parking_name: str | None = None
    expected_arrival_at: datetime | None = None
    predicted_status: PredictedStatus | None = None
    predicted_risk_score: Decimal | None = None
    api_available_count: int | None = None
    api_total_capacity: int | None = None


class VisitResultUpdate(BaseModel):
    actual_result: ActualResult
    actual_wait_minutes: int | None = None
    actual_fee: int | None = None
    entrance_difficulty: int | None = Field(default=None, ge=1, le=5)
    walking_difficulty: int | None = Field(default=None, ge=1, le=5)
    perceived_congestion: int | None = Field(default=None, ge=1, le=5)
    memo: str | None = None


class VisitOut(BaseModel):
    id: int
    destination_name: str | None
    destination_place_id: int | None
    destination_lat: float | None
    destination_lng: float | None
    selected_parking_lot_id: int | None
    selected_parking_name: str | None
    searched_at: datetime
    expected_arrival_at: datetime | None
    predicted_status: str | None
    predicted_risk_score: Decimal | None
    api_available_count: int | None
    api_total_capacity: int | None
    actual_result: str | None
    actual_wait_minutes: int | None
    actual_fee: int | None
    entrance_difficulty: int | None
    walking_difficulty: int | None
    perceived_congestion: int | None
    memo: str | None
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True


class VisitListResponse(BaseModel):
    count: int
    items: list[VisitOut]
