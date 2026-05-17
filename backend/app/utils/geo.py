from __future__ import annotations

import math


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def walk_minutes(distance_m: float, speed_m_per_min: float = 75.0) -> int:
    """평지 도보 ~4.5km/h ≒ 75 m/min."""
    return max(1, int(round(distance_m / speed_m_per_min)))


def walk_minutes_straight(distance_m: float, speed_m_per_min: float = 70.0) -> int:
    """직선거리 기반 도보 예상 시간. 70 m/min 기준, 올림.

    실제 도보 경로는 도로/횡단보도/경사로 인해 1.2~1.5배 길어질 수 있으므로
    여기서 나오는 분(min)은 어디까지나 직선거리 환산 추정치이며 카드/마커에
    표시할 때는 반드시 "직선거리 기준 도보 약 N분" 으로 표기한다.
    """
    import math as _math
    return max(1, _math.ceil(distance_m / speed_m_per_min))
