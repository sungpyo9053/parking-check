"""목적지 자체 주차 가능성 추정.

룰:
  - 같은 도로명/지번 주소 (앞 4토큰 일치) + '부설' 타입 → confidence +50
  - 목적지명/건물명이 주차장명에 포함 → +30
  - 50m 이내 + 부설/노외 → +20
  - 1순위 매칭이 있으면 status=available, 아니면 uncertain
"""
from __future__ import annotations

from typing import Iterable

from .parking_search import nearby_parking_lots
from sqlalchemy.orm import Session


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return s.replace(" ", "").lower()


def _addr_prefix(addr: str | None, n_tokens: int = 4) -> str:
    if not addr:
        return ""
    return " ".join(addr.split()[:n_tokens])


def estimate_self_parking(
    db: Session,
    destination_name: str | None,
    destination_address: str | None,
    lat: float,
    lng: float,
) -> dict:
    candidates = nearby_parking_lots(db, lat, lng, radius_m=80, limit=10)
    if not candidates:
        return {
            "status": "unknown",
            "confidence": 0,
            "reason": "목적지 주변 80m 이내 등록된 주차장 데이터가 없습니다.",
            "matched_lot_id": None,
        }

    norm_dest_name = _norm(destination_name)
    dest_addr_prefix = _addr_prefix(destination_address)

    best: tuple[int, dict, list[str]] | None = None  # (score, lot, reasons)
    for lot in candidates:
        score = 0
        reasons: list[str] = []

        lot_name_norm = _norm(lot.get("name"))
        if norm_dest_name and lot_name_norm and (
            norm_dest_name in lot_name_norm or lot_name_norm in norm_dest_name
        ):
            score += 30
            reasons.append("주차장명에 목적지명 포함")

        lot_addr = lot.get("road_address") or lot.get("jibun_address") or ""
        if dest_addr_prefix and lot_addr.startswith(dest_addr_prefix):
            score += 50
            reasons.append("같은 주소 prefix")

        if (lot.get("parking_type") == "부설" or lot.get("type") == "부설") \
                and lot.get("distance_m", 9999) <= 50:
            score += 20
            reasons.append("50m 이내 부설주차장")

        if best is None or score > best[0]:
            best = (score, lot, reasons)

    score, lot, reasons = best  # type: ignore[misc]
    if score >= 50:
        status = "available"
    elif score >= 20:
        status = "uncertain"
    else:
        status = "unknown"

    nearby_count = len(candidates)
    if status == "unknown":
        reason = (
            f"같은 주소의 부설주차장 데이터가 확인되지 않았습니다. "
            f"다만 도보 5분 이내 대체 주차장이 {nearby_count}개 있습니다."
        )
        matched_id = None
    else:
        reason = "; ".join(reasons) if reasons else "유사 부설주차장 후보 매칭"
        matched_id = lot["id"]

    return {
        "status": status,
        "confidence": min(100, score),
        "reason": reason,
        "matched_lot_id": matched_id,
    }
