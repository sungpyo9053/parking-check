"""실 도보 경로 거리/시간 계산 — OSRM 공식 데모 서버 + 직선 폴백.

카카오 모빌리티 도보 길찾기 API 는 제휴 파트너 전용이라 사용 불가.
대안으로 OpenStreetMap 기반 OSRM 공식 데모 (`router.project-osrm.org`) 의
foot profile 을 사용한다. 무료 + 키 불필요 + CORS 허용. 한국 OSM 데이터가
카카오만큼 촘촘하지 않으므로 정확도는 카카오 < OSM 이지만 직선보다는 훨씬 낫다.

비용/안정성:
  - 30분 TTL 캐시 (좌표 round(4) 단위, 약 11m grid)
  - ThreadPool 최대 8 워커로 batch 병렬
  - 실패 시 직선거리 기반 추정으로 폴백
"""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

import httpx

from ..utils.cache import TTLCache
from ..utils.geo import haversine_m, walk_minutes_straight

logger = logging.getLogger(__name__)

OSRM_BASE = "https://router.project-osrm.org/route/v1/foot"
_TIMEOUT = 4.0
_CACHE: TTLCache[tuple, dict] = TTLCache(max_size=2048, ttl_seconds=30 * 60)
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="osrm")


def _haversine_route(from_lat, from_lng, to_lat, to_lng) -> dict:
    dist = int(haversine_m(from_lat, from_lng, to_lat, to_lng))
    return {
        "distance_m": dist,
        "walking_minutes": walk_minutes_straight(dist),
        "source": "haversine",
    }


def _osrm_call(from_lat, from_lng, to_lat, to_lng) -> dict | None:
    url = f"{OSRM_BASE}/{from_lng},{from_lat};{to_lng},{to_lat}?overview=false"
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.get(url)
    except httpx.HTTPError as e:
        logger.warning("osrm http error: %s", e)
        return None
    if r.status_code != 200:
        logger.warning("osrm status %s", r.status_code)
        return None
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        return None
    route = data["routes"][0]
    dist = int(round(float(route.get("distance") or 0)))
    dur_sec = float(route.get("duration") or 0)
    # OSRM 의 foot 평균 5km/h ≒ 83m/min. 한국 도시 보행 4.2km/h ≒ 70m/min 으로
    # 약간 보정 (1.18 배). 너무 짧은 거리는 1분 미만이라 max(1) 보장.
    minutes = max(1, math.ceil(dur_sec * 1.18 / 60))
    return {"distance_m": dist, "walking_minutes": minutes, "source": "osrm"}


def compute_walking_route(
    from_lat: float, from_lng: float, to_lat: float, to_lng: float
) -> dict:
    """실 도보 경로 거리/시간. 항상 dict 를 반환 (실패 시 직선 fallback)."""
    if from_lat is None or from_lng is None or to_lat is None or to_lng is None:
        return _haversine_route(from_lat or 0, from_lng or 0, to_lat or 0, to_lng or 0)
    key = (round(from_lat, 4), round(from_lng, 4), round(to_lat, 4), round(to_lng, 4))
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    res = _osrm_call(from_lat, from_lng, to_lat, to_lng)
    if res is None:
        res = _haversine_route(from_lat, from_lng, to_lat, to_lng)
    _CACHE.set(key, res)
    return res


def batch_compute(
    pairs: Iterable[tuple[float, float, float, float]],
) -> list[dict]:
    """여러 (from_lat, from_lng, to_lat, to_lng) 쌍을 병렬로 계산."""
    pairs_list = list(pairs)
    if not pairs_list:
        return []
    futures = [
        _POOL.submit(compute_walking_route, fl, fg, tl, tg)
        for (fl, fg, tl, tg) in pairs_list
    ]
    return [f.result() for f in futures]


def cache_stats() -> dict:
    return _CACHE.stats()
