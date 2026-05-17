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


# --- 외부(Kakao / Web Search) 폴백 후보 ---

CandidateSource = Literal["public_db", "kakao_fallback", "web_search"]


class ExternalCandidate(BaseModel):
    """DB 에 없는 보조 후보. 카카오 지도 검색 결과 또는 웹 검색 결과.

    공통:
      - 실시간/요금/운영여부는 단정하지 않는다. fee_summary/realtime_status 는 "확인 필요" 고정.
      - source/source_label 로 카드 UI 구분.
    """

    source: CandidateSource
    source_label: str
    name: str
    title: str | None = None
    url: str | None = None
    snippet: str | None = None
    distance_m: int | None = None
    lat: float | None = None
    lng: float | None = None
    address: str | None = None
    road_address: str | None = None
    category: str | None = None
    capacity: int | None = None
    available_count: int | None = None
    fee_summary: str = "확인 필요"
    realtime_status: str = "실시간 정보 없음"
    confidence: Literal["low", "medium", "high"] = "low"
    warning: str = (
        "웹 검색/외부 지도 기반 정보입니다. 운영 여부와 위치는 방문 전 확인이 필요합니다."
    )


class FallbackInfo(BaseModel):
    """DB → Kakao → Web Search 단계 결과 메타.

    summary 는 처음에는 rule-based 로 생성되고, 추후 LLM 요약으로 교체할 수 있게
    evidence_items / warnings 도 함께 노출한다.
    """

    db_count: int = 0
    kakao_pk6_count: int = 0
    kakao_keyword_count: int = 0
    web_search_count: int = 0
    web_search_enabled: bool = False
    web_search_executed: bool = False
    sources_tried: list[str] = []
    evidence_items: list[ExternalCandidate] = []
    summary: str | None = None
    warnings: list[str] = []


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
    external_candidates: list[ExternalCandidate] = []
    fallback: FallbackInfo | None = None
    history_for_destination: list[HistoryForDestination] = []
    disclaimers: list[str] = []
