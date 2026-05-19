"""시간대·요일·카테고리 기반 혼잡도 예측 (휴리스틱).

실제 인구 데이터(카카오/SKT/통신3사) 는 B2B 유료라 무료 라인업에서는 접근 불가.
대신 카테고리별 일반 패턴(평일 점심/저녁, 주말 오후) 을 룰로 정의해서 노출한다.

UI 에는 반드시 "예상" / "일반 패턴 기준" 으로 표기해 추측임을 분명히 한다.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

CongestionLevel = Literal["low", "medium", "high"]
KST = ZoneInfo("Asia/Seoul")


@dataclass
class CongestionPrediction:
    level: CongestionLevel
    label: str  # 사용자 표시용 한 줄 ("주말 오후, 카페 매우 붐빌 가능성")
    basis: str  # "주말 14-18시 카페 일반 혼잡 패턴"

    def to_dict(self) -> dict:
        return {"level": self.level, "label": self.label, "basis": self.basis}


def _level_label(level: CongestionLevel) -> str:
    return {"low": "한산할 가능성", "medium": "보통 혼잡", "high": "매우 혼잡할 가능성"}[level]


def _is_weekend(dt: datetime) -> bool:
    # Mon=0..Sun=6
    return dt.weekday() >= 5


def _cafe_level(dt: datetime) -> CongestionLevel:
    h = dt.hour
    wk = _is_weekend(dt)
    if wk:
        if 13 <= h <= 18:
            return "high"
        if 11 <= h <= 20:
            return "medium"
        return "low"
    # 평일
    if 14 <= h <= 17:
        return "medium"
    if 9 <= h <= 21:
        return "low"
    return "low"


def _food_level(dt: datetime) -> CongestionLevel:
    h = dt.hour
    wk = _is_weekend(dt)
    # 점심
    if 12 <= h <= 13:
        return "high" if wk else "medium"
    # 저녁
    if 18 <= h <= 20:
        return "high"
    if 11 <= h <= 21:
        return "medium"
    return "low"


def _sights_level(dt: datetime) -> CongestionLevel:
    h = dt.hour
    wk = _is_weekend(dt)
    if wk and 11 <= h <= 17:
        return "high"
    if 11 <= h <= 17:
        return "medium"
    return "low"


def _general_level(dt: datetime) -> CongestionLevel:
    """카테고리 미상 — 시간대 일반 패턴."""
    h = dt.hour
    wk = _is_weekend(dt)
    if wk:
        if 12 <= h <= 19:
            return "medium"
        return "low"
    if 12 <= h <= 13 or 18 <= h <= 20:
        return "medium"
    return "low"


def _category_key(category: str | None) -> str:
    if not category:
        return "general"
    c = category.lower()
    if "ce7" in c or "카페" in c or "coffee" in c:
        return "cafe"
    if "fd6" in c or "음식점" in c or "맛집" in c or "food" in c:
        return "food"
    if "at4" in c or "관광" in c or "sights" in c:
        return "sights"
    return "general"


def _basis_label(key: str, dt: datetime) -> str:
    wk = "주말" if _is_weekend(dt) else "평일"
    name = {"cafe": "카페", "food": "음식점", "sights": "관광지"}.get(key, "일반")
    return f"{wk} {dt.hour}시 {name} 일반 혼잡 패턴 (휴리스틱)"


def predict(category: str | None, dt: datetime | None = None) -> CongestionPrediction:
    """카테고리 + 시각(KST) 으로 혼잡도 예측. dt=None 이면 지금 시각."""
    if dt is None:
        dt = datetime.now(KST)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=KST)
    else:
        dt = dt.astimezone(KST)

    key = _category_key(category)
    if key == "cafe":
        level = _cafe_level(dt)
    elif key == "food":
        level = _food_level(dt)
    elif key == "sights":
        level = _sights_level(dt)
    else:
        level = _general_level(dt)

    return CongestionPrediction(
        level=level,
        label=_level_label(level),
        basis=_basis_label(key, dt),
    )
