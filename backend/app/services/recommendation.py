"""룰 기반 추천 점수 + 혼잡도 산정.

우선순위:
  1. 운영 중인 주차장
  2. 가까운 주차장
  3. 실시간 잔여면수 있는 주차장
  4. 잔여면수 많은 주차장
  5. 총 면수 큰 주차장
  6. 내가 과거에 성공한 주차장 (가점)
  7. 내가 과거에 실패한 주차장 (감점)
"""
from __future__ import annotations

from datetime import datetime, time
from typing import Any

from ..utils.geo import walk_minutes


def is_open_now(lot: dict, now: datetime | None = None) -> bool | None:
    now = now or datetime.now()
    weekday = now.weekday()  # 0=월 ... 6=일
    if weekday == 5:
        ot, ct = lot.get("saturday_open_time"), lot.get("saturday_close_time")
    elif weekday == 6:
        ot, ct = lot.get("holiday_open_time"), lot.get("holiday_close_time")
    else:
        ot, ct = lot.get("weekday_open_time"), lot.get("weekday_close_time")
    if ot is None or ct is None:
        return None
    if isinstance(ot, str):
        # 룰 단순화 — TIME 컬럼이면 보통 time 객체로 들어옴
        return None
    cur = now.time()
    if ot == ct == time(0, 0):
        return True  # 24시간 추정
    if ot < ct:
        return ot <= cur <= ct
    # 자정 넘김
    return cur >= ot or cur <= ct


def classify_congestion(realtime: dict | None, lot: dict) -> str:
    if realtime and realtime.get("available_count") is not None and realtime.get("total_capacity"):
        avail = realtime["available_count"]
        total = realtime["total_capacity"]
        if total <= 0:
            return "unknown"
        if avail == 0:
            return "full"
        ratio = avail / total
        if ratio < 0.03:
            return "risky"
        if ratio < 0.10:
            return "busy"
        if ratio < 0.30:
            return "moderate"
        return "easy"
    capacity = lot.get("capacity") or 0
    if capacity and capacity <= 20:
        return "risky"  # 작은 주차장은 만차 가능성 높음 추정
    return "unknown"


def fee_summary(lot: dict) -> str | None:
    bt, bf = lot.get("base_time"), lot.get("base_fee")
    et, ef = lot.get("extra_time"), lot.get("extra_fee")
    if not bt and not bf:
        return lot.get("fee_type")
    parts = []
    if bt and bf is not None:
        parts.append(f"{bt}분 {bf}원")
    if et and ef is not None:
        parts.append(f"{et}분당 {ef}원")
    return " / ".join(parts) if parts else lot.get("fee_type")


def score_candidate(
    lot: dict,
    realtime: dict | None,
    open_now: bool | None,
    personal: dict | None = None,
) -> tuple[float, list[str]]:
    score = 0.0
    reasons: list[str] = []

    # 거리: 0m=35점, 1000m=0점 선형
    dist = lot.get("distance_m", 9999)
    distance_score = max(0.0, 35.0 * (1 - min(dist, 1000) / 1000))
    score += distance_score
    reasons.append(f"거리 {dist}m")

    # 실시간 잔여
    avail_score = 0.0
    if realtime and realtime.get("available_count") is not None and realtime.get("total_capacity"):
        ratio = realtime["available_count"] / max(realtime["total_capacity"], 1)
        avail_score = 25.0 * min(1.0, ratio / 0.3)
        reasons.append(f"실시간 잔여 {realtime['available_count']}/{realtime['total_capacity']}")
    score += avail_score

    # 운영 중
    if open_now is True:
        score += 15
        reasons.append("운영 중")
    elif open_now is False:
        score -= 25
        reasons.append("운영시간 외")

    # 가격 (저렴할수록 가점) — base_fee 기준 단순화
    bf = lot.get("base_fee")
    if bf is not None:
        if bf == 0:
            score += 10
            reasons.append("기본요금 무료")
        elif bf <= 1000:
            score += 6
        elif bf <= 2000:
            score += 3

    # 총 면수
    cap = lot.get("capacity") or 0
    if cap >= 200:
        score += 10
    elif cap >= 50:
        score += 6
    elif cap >= 20:
        score += 3
    elif cap > 0 and cap <= 10:
        score -= 5
        reasons.append("총 면수 10 이하 — 만차 가능성")

    # 개인 경험
    if personal:
        ok = personal.get("success") or 0
        ng = personal.get("fail") or 0
        if ok:
            score += min(8, ok * 4)
            reasons.append(f"내가 {ok}회 성공")
        if ng:
            score -= min(12, ng * 6)
            reasons.append(f"내가 {ng}회 실패")

    return round(score, 1), reasons
