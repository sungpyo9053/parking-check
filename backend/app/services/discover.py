"""현위치 + 카테고리(cafe/food/sights) 기반 '핫한' 매장 추천.

여러 외부 신호를 합쳐 매장별 hot_score 를 산출:
  - YouTube Data API v3 — 영상 제목/설명에 매장명 등장 + 조회수 가중 (강한 신호)
  - Naver 블로그/카페 — 글 본문에 매장명 등장 빈도 (한국 후기 강함)
  - Tavily 웹검색 — 인스타 추천/핫플 글 안에 매장명 등장 (보조)
  - 거리 + 카테고리 보너스

인스타 Graph API 는 비즈니스 계정 + 페북 앱 심사가 필요하고 매장명 해시태그
검색이 불가능해 사용하지 않는다.

점수식:
  hot_score = youtube_score * 40         # log10(views+1) 합산
            + naver_mentions * 15
            + tavily_mentions * 10
            + distance_score(0~25)
            + cat_bonus(5)

비용 보호:
  - in-memory TTL 캐시 30분
  - YouTube 카테고리당 1 search (100 unit) + 1 videos batch (1 unit) ≈ 101 unit/일
  - Naver 카테고리당 2 쿼리 × 2 endpoint = 4 호출 (일 25,000 한도 무위협)
  - Tavily 카테고리당 최대 2회
  - 좌표는 round(3) 해서 캐시 키 공유
"""
from __future__ import annotations

import logging
import math
import re
from typing import Literal

import httpx

from ..config import get_settings
from ..utils.cache import TTLCache
from ..utils.geo import haversine_m, walk_minutes_straight
from . import congestion as congestion_svc
from . import kakao as kakao_svc
from . import naver_search, youtube_search

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


def _youtube_score(items: list[dict], name: str) -> tuple[float, int, int]:
    """매장 이름이 들어있는 YouTube 영상들의 log10(views+1) 합산.

    Returns (score, matched_video_count, total_views).
    score 는 정규화 안 함 (대형 채널 영상 1개로도 차이 크게 벌어지게 둠).
    """
    if not items or not name:
        return 0.0, 0, 0
    nn = _norm(name)
    if len(nn) < 2:
        return 0.0, 0, 0
    score = 0.0
    matched = 0
    total_views = 0
    for it in items:
        if nn in _norm(it.get("text") or ""):
            matched += 1
            views = int(it.get("view_count") or 0)
            total_views += views
            score += math.log10(max(views, 0) + 1)
    return round(score, 2), matched, total_views


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

    # 2) 지역명 추출 (외부 검색 쿼리에 사용)
    region_doc = None
    try:
        region_doc = kakao_svc.reverse_geocode_region(lat, lng)
    except Exception as e:  # noqa: BLE001
        logger.warning("discover reverse geocode failed: %s", e)
    # region_3depth_name 이 "성수2가3동" 처럼 좁게 잡히면 "성수동" 으로 다듬는다.
    # 검색 결과가 0건이 되는 사례 다수 — "N가M동" / "N가" 접미사를 제거하고
    # 마지막 "동" 단위만 남긴다.
    raw_3 = (region_doc or {}).get("region_3depth_name") or ""
    raw_2 = (region_doc or {}).get("region_2depth_name") or ""
    cleaned_3 = re.sub(r"\d+가\d*동$", "동", raw_3)  # "성수2가3동" → "성수동"
    cleaned_3 = re.sub(r"\d+동$", "동", cleaned_3)  # "역삼1동" → "역삼동"
    region_label = cleaned_3 or raw_3 or raw_2

    # 3) 외부 신호 수집 — 조건에 맞는 API 만 호출
    tavily_snippets: list[str] = []
    naver_snippets: list[str] = []
    youtube_items: list[dict] = []  # {title, content, view_count}

    if region_label:
        cat_label = _CATEGORY_LABEL[category]
        queries: list[str] = [
            f"{region_label} {cat_label} 인스타 추천",
            f"{region_label} {cat_label} 핫플",
        ]

        # YouTube — 조회수 가중치 (가장 객관적인 신호)
        if youtube_search.is_enabled():
            try:
                yt = youtube_search.search(queries[:1])  # 카테고리당 1 쿼리만 (100 unit)
                for it in yt:
                    youtube_items.append(
                        {
                            "text": f"{it.get('title') or ''} {it.get('content') or ''}",
                            "view_count": int(it.get("view_count") or 0),
                        }
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning("discover youtube failed: %s", e)

        # Naver 블로그/카페 — 한국 후기 강함
        if naver_search.is_enabled():
            try:
                nv = naver_search.search(queries, display=8)
                for r in nv:
                    naver_snippets.append(f"{r.get('title') or ''} {r.get('content') or ''}")
            except Exception as e:  # noqa: BLE001
                logger.warning("discover naver failed: %s", e)

        # Tavily — 기존 보조 신호 (Tavily 가 꺼져있으면 skip)
        if settings.WEB_SEARCH_ENABLED and settings.TAVILY_API_KEY:
            for q in queries[:_TAVILY_MAX_QUERIES]:
                results = _tavily_search(q, settings.TAVILY_API_KEY, max_results=8)
                for r in results:
                    if not isinstance(r, dict):
                        continue
                    tavily_snippets.append(f"{r.get('title') or ''} {r.get('content') or ''}")

    # 4) 점수 산정
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
        yt_score, yt_video_count, yt_total_views = _youtube_score(youtube_items, name)
        naver_mentions = _count_mentions(naver_snippets, name)
        tavily_mentions = _count_mentions(tavily_snippets, name)
        dist_score = max(0, 25.0 * (1 - min(dist, radius_m) / radius_m))
        cat_bonus = 5 if cat_code and cat_code in (d.get("category_group_code") or "") else 0

        score = (
            yt_score * 40
            + naver_mentions * 15
            + tavily_mentions * 10
            + dist_score
            + cat_bonus
        )
        cat_name = d.get("category_name") or ""
        congestion = congestion_svc.predict(
            cat_name or d.get("category_group_code")
        ).to_dict()
        scored.append(
            {
                "name": name,
                "category": cat_name or None,
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
                "youtube_video_count": yt_video_count,
                "youtube_total_views": yt_total_views,
                "naver_mentions": naver_mentions,
                "tavily_mentions": tavily_mentions,
                "region_label": region_label or None,
                "congestion": congestion,
            }
        )

    scored.sort(key=lambda x: (-x["hot_score"], x["distance_m"]))
    top = scored[: max(1, min(5, limit))]
    _CACHE.set(cache_key, top)
    return top


def cache_stats() -> dict:
    return _CACHE.stats()
