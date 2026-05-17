"""Naver Search API 어댑터.

Tavily 무료 한도(월 1k) 초과 시 fallback 으로 사용. Naver 는 블로그/카페
검색 각각 일 25,000건 무료라 사실상 우리 사용량은 한도 0 위협 없음.

키 발급:
  https://developers.naver.com/apps/#/register
  - 사용 API: '검색' 체크
  - WEB 환경 + 사이트: https://reviewdr.kr
  - 발급 즉시 Client ID, Client Secret 받음 → 서버 .env 에 두 줄 추가

응답 매핑은 Tavily 형식 (title, url, content) 으로 통일해서 호출 측 변경 최소화.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

NAVER_BLOG_URL = "https://openapi.naver.com/v1/search/blog.json"
NAVER_CAFE_URL = "https://openapi.naver.com/v1/search/cafearticle.json"
_TIMEOUT = 5.0
_TAG_RE = re.compile(r"<[^>]+>")


def is_enabled() -> bool:
    s = get_settings()
    return bool(s.NAVER_CLIENT_ID and s.NAVER_CLIENT_SECRET)


def _strip_html(s: str | None) -> str:
    if not s:
        return ""
    return _TAG_RE.sub("", s).replace("&quot;", '"').replace("&amp;", "&").replace(
        "&lt;", "<"
    ).replace("&gt;", ">").replace("&nbsp;", " ").strip()


def _naver_search_one(
    url: str, query: str, client_id: str, client_secret: str, display: int = 10
) -> list[dict]:
    params = {"query": query, "display": min(display, 20), "sort": "sim"}
    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret,
    }
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.get(url, params=params, headers=headers)
    except httpx.HTTPError as e:
        logger.warning("naver http: %s", e)
        return []
    if r.status_code != 200:
        logger.warning("naver status=%s body=%s", r.status_code, r.text[:200])
        return []
    return r.json().get("items") or []


def search(queries: Iterable[str], display: int = 8) -> list[dict]:
    """여러 쿼리를 블로그 + 카페에서 검색 후 Tavily 형식으로 정규화한 dict 리스트 반환.

    같은 url 은 dedup. 빈 결과는 [] 반환.
    """
    if not is_enabled():
        return []
    s = get_settings()
    out: list[dict] = []
    seen_urls: set[str] = set()
    for q in queries:
        if not q:
            continue
        for url in (NAVER_BLOG_URL, NAVER_CAFE_URL):
            items = _naver_search_one(url, q, s.NAVER_CLIENT_ID, s.NAVER_CLIENT_SECRET, display=display)
            for it in items:
                link = (it.get("link") or "").strip()
                if not link or link in seen_urls:
                    continue
                seen_urls.add(link)
                out.append(
                    {
                        "title": _strip_html(it.get("title")),
                        "url": link,
                        "content": _strip_html(it.get("description")),
                        "score": None,
                        "source": "naver",
                    }
                )
    return out
