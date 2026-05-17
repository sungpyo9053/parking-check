from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Congestion = Literal["easy", "moderate", "busy", "risky", "full", "unknown"]


class NearbyItem(BaseModel):
    id: int
    name: str
    type: str | None = None
    parking_type: str | None = None
    distance_m: int
    lat: float
    lng: float
    capacity: int | None = None
    fee_type: str | None = None
    base_time: int | None = None
    base_fee: int | None = None
    extra_time: int | None = None
    extra_fee: int | None = None
    road_address: str | None = None


class NearbyResponse(BaseModel):
    count: int
    radius: int
    items: list[NearbyItem]


class RealtimeBlock(BaseModel):
    available_count: int | None = None
    total_capacity: int | None = None
    observed_at: datetime | None = None
    source: str | None = None
    stale_seconds: int | None = None


class HistoryLastVisit(BaseModel):
    result: str | None
    visited_at: datetime | None


class HistoryBlock(BaseModel):
    my_visits: int = 0
    my_success_rate: float | None = None
    last_visit: HistoryLastVisit | None = None


class Candidate(BaseModel):
    id: int
    name: str
    type: str | None = None
    lat: float
    lng: float
    distance_m: int
    walk_minutes: int | None = None
    capacity: int | None = None
    fee_summary: str | None = None
    is_open_now: bool | None = None
    realtime: RealtimeBlock | None = None
    congestion: Congestion = "unknown"
    score: float
    reasons: list[str] = []
    history: HistoryBlock | None = None


class SelfParking(BaseModel):
    status: Literal["available", "uncertain", "unavailable", "unknown"] = "unknown"
    confidence: int = 0
    reason: str | None = None
    matched_lot_id: int | None = None


class AnalyzeSummary(BaseModel):
    nearby_count: int
    nearest_distance_m: int | None = None
    any_full_risk: bool = False
    data_quality: Literal["rich", "partial", "sparse"] = "sparse"


class Destination(BaseModel):
    place_id: int | None = None
    name: str | None = None
    address: str | None = None
    lat: float
    lng: float


class HistoryForDestination(BaseModel):
    visit_id: int
    selected_parking_name: str | None
    searched_at: datetime
    actual_result: str | None
    memo: str | None


class AnalyzeResponse(BaseModel):
    destination: Destination
    self_parking: SelfParking
    summary: AnalyzeSummary
    candidates: list[Candidate]
    history_for_destination: list[HistoryForDestination] = []
    disclaimers: list[str] = []
