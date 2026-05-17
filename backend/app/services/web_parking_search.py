"""Web Search 기반 주차장 fallback.

DB/Kakao 둘 다 비어있을 때만 호출되는 마지막 폴백.
Tavily Search API (https://api.tavily.com/search) 를 단순 HTTP 로 호출한다.

설계 원칙:
- 실시간 가용 여부나 운영 여부는 단정하지 않는다.
- 결과에는 source="web_search", confidence="low", warning 문구를 항상 붙인다.
- 키가 없거나 비활성화면 빈 리스트를 반환 (예외 던지지 않음).
"""
from __future__ import annotations

import logging
from typing import Iterable

import httpx

from ..config import get_settings

TAVILY_URL = "https://api.tavily.com/search"
_DEFAULT_TIMEOUT = 8.0
_MAX_QUERIES = 3
_MAX_RESULTS_PER_QUERY = 5
_MAX_TOTAL_RESULTS = 8

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    s = get_settings()
    return bool(s.WEB_SEARCH_ENABLED and s.TAVILY_API_KEY)


def _short_addr_token(address: str | None) -> str | None:
    """'서울 강북구 수유동 ...' → '수유동' 같은 동/읍/면 토큰을 추출."""
    if not address:
        return None
    for tok in address.split():
        if tok.endswith(("동", "읍", "면", "가", "리")) and len(tok) >= 2:
            return tok
    return None


def build_queries(
    destination_name: str | None,
    destination_address: str | None,
) -> list[str]:
    name = (destination_name or "").strip()
    addr = (destination_address or "").strip()
    queries: list[str] = []
    if name:
        queries.append(f"{name} 주차장")
        queries.append(f"{name} 근처 주차")
    if addr:
        # 너무 긴 주소는 그대로는 노이즈가 됨 → 상위 4토큰만
        addr_short = " ".join(addr.split()[:4])
        queries.append(f"{addr_short} 주차장")
        local = _short_addr_token(addr)
        if local and name:
            queries.append(f"{local} {name} 공영주차장")
    # dedup, 우선순위 유지
    seen: set[str] = set()
    uniq: list[str] = []
    for q in queries:
        if q and q not in seen:
            seen.add(q)
            uniq.append(q)
    return uniq[:_MAX_QUERIES]


def _tavily_search_one(query: str, api_key: str, max_results: int) -> list[dict]:
    body = {
        "query": query,
        "search_depth": "basic",
        "max_results": max_results,
        "include_answer": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=_DEFAULT_TIMEOUT) as client:
        r = client.post(TAVILY_URL, headers=headers, json=body)
    if r.status_code != 200:
        # 키 출력 금지. 상태코드와 본문 앞부분만 로그.
        logger.warning(
            "tavily search failed: status=%s body=%s",
            r.status_code,
            r.text[:200],
        )
        return []
    data = r.json()
    results = data.get("results") or []
    return [r for r in results if isinstance(r, dict)]


def search_web_parking(
    destination_name: str | None,
    destination_address: str | None,
) -> list[dict]:
    """웹 검색을 통해 주차 관련 후보 정보를 수집한다.

    반환 항목은 라우터에서 ExternalCandidate 로 매핑된다.
    Tavily 결과 원본 키: title, url, content, score.
    """
    if not is_enabled():
        return []
    api_key = get_settings().TAVILY_API_KEY
    queries = build_queries(destination_name, destination_address)
    if not queries:
        return []

    aggregated: list[dict] = []
    seen_urls: set[str] = set()
    for q in queries:
        try:
            results = _tavily_search_one(q, api_key, _MAX_RESULTS_PER_QUERY)
        except httpx.HTTPError as e:
            logger.warning("tavily HTTPError on query=%r: %s", q, e)
            continue
        for r in results:
            url = (r.get("url") or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            aggregated.append(
                {
                    "query": q,
                    "title": (r.get("title") or "").strip() or None,
                    "url": url,
                    "snippet": (r.get("content") or "").strip() or None,
                    "score": r.get("score"),
                }
            )
            if len(aggregated) >= _MAX_TOTAL_RESULTS:
                return aggregated
    return aggregated
