"""현위치 + 카테고리(cafe/food/sights) 기반 '인스타에서 핫한' 핫플 추천.

비공식 인스타 API 는 사용자 콘텐츠 검색이 불가능 (Graph API 는 비즈니스 계정
한정). 대신 Tavily Web Search 로 "{지역명} {카테고리} 인스타 추천 / 핫플" 을
검색해서 결과 snippet 안에 카카오 keyword search 후보 매장 이름이 등장하는
빈도를 셈으로써 '인스타에서 자주 언급되는 곳' 을 근사한다.

핫함 점수 = name_mention_count * 30 + distance_score(0~25) + category_quality_bonus

비용 보호:
  - in-memory TTL 캐시 30분
  - Tavily 쿼리 카테고리당 최대 2회
  - Kakao keyword search 카테고리당 최대 15 결과
  - 좌표는 round(3) 해서 캐시 키 공유
"""
from __future__ import annotations

import logging
import re
from typing import Literal

import httpx

from ..config import get_settings
from ..utils.cache import TTLCache
from ..utils.geo import haversine_m, walk_minutes_straight
from . import kakao as kakao_svc

logger = logging.getLogger(__name__)

Category = Literal["cafe", "food", "sights"]

# 카테고리별 카카오 keyword + 한국어 라벨
_KAKAO_QUERY = {
    "cafe": "카페",
    "food": "맛집",
    "sights": "가볼만한곳",
}
_CATEGORY_LABEL = {
    "cafe": "카페",
    "food": "맛집",
    "sights": "가볼곳",
}
# 카카오 category_group_code (선택적 필터)
_CATEGORY_CODE = {
    "cafe": "CE7",  # 카페
    "food": "FD6",  # 음식점
    "sights": "AT4",  # 관광명소
}

# 비용 보호 설정
_CACHE: TTLCache[tuple, list[dict]] = TTLCache(max_size=512, ttl_seconds=30 * 60)
_KAKAO_SIZE = 15
_TAVILY_MAX_QUERIES = 2
_TAVILY_TIMEOUT = 8.0
TAVILY_URL = "https://api.tavily.com/search"


def _tavily_search(query: str, api_key: str, max_results: int = 10) -> list[dict]:
    body = {
        "query": query,
        "search_depth": "basic",
        "max_results": max_results,
        "include_answer": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=_TAVILY_TIMEOUT) as c:
            r = c.post(TAVILY_URL, headers=headers, json=body)
    except httpx.HTTPError as e:
        logger.warning("discover tavily HTTPError: %s", e)
        return []
    if r.status_code != 200:
        logger.warning("discover tavily status=%s body=%s", r.status_code, r.text[:150])
        return []
    return r.json().get("results") or []


_NORM_RE = re.compile(r"[\s\-_·()\[\]/\\,]+")


def _norm(s: str) -> str:
    return _NORM_RE.sub("", (s or "")).lower()


def _count_mentions(snippets: list[str], name: str) -> int:
    if not name:
        return 0
    nn = _norm(name)
    if len(nn) < 2:
        return 0
    cnt = 0
    for s in snippets:
        if not s:
            continue
        if nn in _norm(s):
            cnt += 1
    return cnt


def discover_hot_places(
    lat: float, lng: float, category: Category, limit: int = 3, radius_m: int = 1500
) -> list[dict]:
    """카테고리에 맞는 인스타 추정 핫플 top N.

    캐시 히트면 즉시 반환 (Tavily 비용 0).
    """
    cache_key = (round(lat, 3), round(lng, 3), category, limit, radius_m)
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return cached

    settings = get_settings()
    kakao_q = _KAKAO_QUERY.get(category, "맛집")
    cat_code = _CATEGORY_CODE.get(category)

    # 1) 카카오 후보 (좌표 기반 keyword search) — radius 안에서 정확도순
    try:
        docs = kakao_svc.search_keyword_near(
            kakao_q, lat=lat, lng=lng, radius_m=radius_m, size=_KAKAO_SIZE
        )
    except kakao_svc.KakaoAPIError as e:
        logger.warning("discover kakao failed: %s", e)
        docs = []

    if cat_code:
        docs = [d for d in docs if cat_code in (d.get("category_group_code") or "")]

    if not docs:
        _CACHE.set(cache_key, [])
        return []

    # 2) 지역명 추출 (Tavily 쿼리에 사용)
    region_doc = None
    try:
        region_doc = kakao_svc.reverse_geocode_region(lat, lng)
    except Exception as e:  # noqa: BLE001
        logger.warning("discover reverse geocode failed: %s", e)
    region_label = (
        (region_doc or {}).get("region_3depth_name")
        or (region_doc or {}).get("region_2depth_name")
        or ""
    )

    # 3) Tavily 검색 (지역 + 카테고리 + 인스타 핫플 키워드)
    snippets: list[str] = []
    if settings.WEB_SEARCH_ENABLED and settings.TAVILY_API_KEY and region_label:
        queries: list[str] = [
            f"{region_label} {_CATEGORY_LABEL[category]} 인스타 추천",
            f"{region_label} {_CATEGORY_LABEL[category]} 핫플",
        ][:_TAVILY_MAX_QUERIES]
        for q in queries:
            results = _tavily_search(q, settings.TAVILY_API_KEY, max_results=8)
            for r in results:
                if not isinstance(r, dict):
                    continue
                snippets.append(f"{r.get('title') or ''} {r.get('content') or ''}")

    # 4) 점수 산정: 인스타 언급 빈도 + 거리 보너스 + 카테고리 보너스
    scored: list[dict] = []
    for d in docs:
        try:
            dlat = float(d["y"])
            dlng = float(d["x"])
        except (KeyError, ValueError):
            continue
        dist = int(haversine_m(lat, lng, dlat, dlng))
        if dist > radius_m:
            continue

        name = d.get("place_name") or ""
        mentions = _count_mentions(snippets, name) if snippets else 0
        dist_score = max(0, 25.0 * (1 - min(dist, radius_m) / radius_m))
        cat_bonus = 5 if cat_code and cat_code in (d.get("category_group_code") or "") else 0

        score = mentions * 30 + dist_score + cat_bonus
        scored.append(
            {
                "name": name,
                "category": d.get("category_name"),
                "category_group_code": d.get("category_group_code"),
                "phone": d.get("phone") or None,
                "address": d.get("address_name"),
                "road_address": d.get("road_address_name"),
                "lat": dlat,
                "lng": dlng,
                "distance_m": dist,
                "walking_minutes": walk_minutes_straight(dist),
                "place_url": d.get("place_url"),
                "hot_score": round(score, 1),
                "instagram_mentions": mentions,
                "region_label": region_label or None,
            }
        )

    scored.sort(key=lambda x: (-x["hot_score"], x["distance_m"]))
    top = scored[: max(1, min(5, limit))]
    _CACHE.set(cache_key, top)
    return top


def cache_stats() -> dict:
    return _CACHE.stats()
