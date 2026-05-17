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
