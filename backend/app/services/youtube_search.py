"""YouTube Data API v3 어댑터 — 핫플 추천에 조회수 가중치를 제공.

발급:
  https://console.cloud.google.com → APIs & Services → Credentials
  - YouTube Data API v3 enable
  - API key (Restrict to YouTube Data API v3 권장)

쿼터:
  - 무료 10,000 unit / day
  - search.list = 100 unit / call
  - videos.list (statistics) = 1 unit / call
  - 카테고리당 1 search + 1 videos batch ≈ 101 unit
  - 30분 캐시로 같은 좌표/카테고리 재호출 막음

응답 매핑은 Tavily/Naver 와 동일한 형태(title/url/content)로 통일하고
view_count 만 추가로 실어준다.
"""
from __future__ import annotations

import logging
from typing import Iterable

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
_TIMEOUT = 6.0
_MAX_RESULTS = 25


def is_enabled() -> bool:
    return bool(get_settings().YOUTUBE_API_KEY)


def _search_videos(query: str, api_key: str) -> list[dict]:
    params = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": _MAX_RESULTS,
        "regionCode": "KR",
        "relevanceLanguage": "ko",
        "order": "relevance",
        "key": api_key,
    }
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.get(SEARCH_URL, params=params)
    except httpx.HTTPError as e:
        logger.warning("youtube search http: %s", e)
        return []
    if r.status_code != 200:
        logger.warning("youtube search status=%s body=%s", r.status_code, r.text[:200])
        return []
    return r.json().get("items") or []


def _fetch_view_counts(video_ids: list[str], api_key: str) -> dict[str, int]:
    if not video_ids:
        return {}
    params = {
        "part": "statistics",
        "id": ",".join(video_ids[:50]),
        "key": api_key,
    }
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.get(VIDEOS_URL, params=params)
    except httpx.HTTPError as e:
        logger.warning("youtube videos http: %s", e)
        return {}
    if r.status_code != 200:
        logger.warning("youtube videos status=%s body=%s", r.status_code, r.text[:200])
        return {}
    out: dict[str, int] = {}
    for item in r.json().get("items") or []:
        vid = item.get("id")
        stats = item.get("statistics") or {}
        try:
            out[vid] = int(stats.get("viewCount") or 0)
        except (TypeError, ValueError):
            continue
    return out


def search(queries: Iterable[str]) -> list[dict]:
    """여러 쿼리에 대해 YouTube 검색 + 조회수 조회.

    반환 dict 형식 (Tavily/Naver 와 호환 + view_count 추가):
        {title, url, content, view_count, source="youtube"}
    같은 videoId 는 dedup.
    """
    if not is_enabled():
        return []
    api_key = get_settings().YOUTUBE_API_KEY

    out: list[dict] = []
    seen_ids: set[str] = set()
    pending_ids: list[str] = []
    pending_items: list[dict] = []

    for q in queries:
        if not q:
            continue
        items = _search_videos(q, api_key)
        for it in items:
            vid = (it.get("id") or {}).get("videoId")
            if not vid or vid in seen_ids:
                continue
            seen_ids.add(vid)
            sn = it.get("snippet") or {}
            pending_ids.append(vid)
            pending_items.append(
                {
                    "video_id": vid,
                    "title": sn.get("title") or "",
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "content": sn.get("description") or "",
                    "channel": sn.get("channelTitle") or "",
                    "published_at": sn.get("publishedAt"),
                    "source": "youtube",
                }
            )

    views = _fetch_view_counts(pending_ids, api_key)
    for it in pending_items:
        it["view_count"] = views.get(it["video_id"], 0)
        out.append(it)
    return out
