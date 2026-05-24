"""카카오맵 place 페이지에서 요금/운영시간/면수/결제방식 추출.

원칙:
- 1순위 추천 후보 1건만 호출 (서버 부담 최소).
- 6시간 TTL 캐시 — 요금/시간 같은 정보는 잘 안 바뀜.
- 실패 시 silent fallback — 분석 응답 자체에 영향 X.
- Playwright async API + Chromium headless. 한 번에 1 browser instance.

향후:
- 혼잡도 그래프(시간별 방문자) 는 SVG/Canvas 로 렌더되어 innerText 추출 불가.
  network intercept 로 카카오 내부 API 응답을 가로채는 방식이 필요. 추후 작업.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

from pydantic import BaseModel

from ..utils.cache import TTLCache

logger = logging.getLogger(__name__)

_CACHE: TTLCache[str, "KakaoPlaceDetail"] = TTLCache(max_size=512, ttl_seconds=6 * 3600)
_NEGATIVE_CACHE: TTLCache[str, bool] = TTLCache(max_size=512, ttl_seconds=30 * 60)
_GOTO_TIMEOUT_MS = 12000
_EXTRA_WAIT_MS = 1500
_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)


class KakaoPlaceDetail(BaseModel):
    place_id: str
    open_status: Optional[str] = None   # "영업 중" / "영업 종료" / "24시간 영업"
    hours: Optional[str] = None         # 예: "매일 00:00 ~ 24:00"
    capacity: Optional[str] = None      # 예: "30면"
    base_fee_text: Optional[str] = None # 예: "30분 800원"
    extra_fee_text: Optional[str] = None
    daily_max_text: Optional[str] = None  # 예: "10,000원"
    payment_methods: Optional[str] = None
    phone: Optional[str] = None
    fetched_at_iso: Optional[str] = None


def _extract_place_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"place\.map\.kakao\.com/(\d+)", url)
    return m.group(1) if m else None


_RE_HOURS = re.compile(r"운영시간\s*\n+([^\n]+)")
_RE_CAPACITY = re.compile(r"주차면수\s*\n+(\d+\s*면)")
_RE_BASE_FEE = re.compile(r"기본\s*(\d+)\s*분\s+([\d,]+\s*원)")
_RE_EXTRA_FEE = re.compile(r"추가\s*(\d+)\s*분\s+([\d,]+\s*원)")
_RE_DAILY_MAX = re.compile(r"일\s*최대\s+([\d,]+\s*원)")
_RE_PAYMENT = re.compile(r"결제방식\s*\n+([^\n]+)")
_RE_PHONE = re.compile(r"전화\s*\n+([0-9\-\+\(\)\s]+)")


def parse_kakao_place_text(text: str, place_id: str) -> KakaoPlaceDetail:
    """innerText 기반 휴리스틱 파서."""
    d = KakaoPlaceDetail(place_id=place_id)

    if "24시간 영업" in text:
        d.open_status = "24시간 영업"
    elif re.search(r"영업\s*중", text):
        d.open_status = "영업 중"
    elif re.search(r"영업\s*종료", text):
        d.open_status = "영업 종료"

    m = _RE_HOURS.search(text)
    if m:
        d.hours = m.group(1).strip()

    m = _RE_CAPACITY.search(text)
    if m:
        d.capacity = m.group(1).replace(" ", "").strip()

    m = _RE_BASE_FEE.search(text)
    if m:
        d.base_fee_text = f"{m.group(1)}분 {m.group(2)}".strip()

    m = _RE_EXTRA_FEE.search(text)
    if m:
        d.extra_fee_text = f"{m.group(1)}분 {m.group(2)}".strip()

    m = _RE_DAILY_MAX.search(text)
    if m:
        d.daily_max_text = m.group(1).strip()

    m = _RE_PAYMENT.search(text)
    if m:
        d.payment_methods = m.group(1).strip()

    m = _RE_PHONE.search(text)
    if m:
        d.phone = m.group(1).strip()

    return d


def _has_any_data(d: KakaoPlaceDetail) -> bool:
    return any(
        [
            d.open_status,
            d.hours,
            d.capacity,
            d.base_fee_text,
            d.daily_max_text,
            d.payment_methods,
        ]
    )


async def _fetch_detail_async(place_id: str) -> KakaoPlaceDetail | None:
    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError:
        logger.warning("playwright not installed — kakao detail skipped")
        return None

    url = f"https://place.map.kakao.com/{place_id}"
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--single-process",  # 메모리 절약 — Lightsail 447MB 환경
                ],
            )
            try:
                ctx = await browser.new_context(
                    viewport={"width": 412, "height": 900},
                    user_agent=_MOBILE_UA,
                )
                page = await ctx.new_page()
                # 광고/이미지/폰트 차단 — 메모리/시간 절약
                await page.route(
                    "**/*",
                    lambda route: (
                        route.abort()
                        if route.request.resource_type in {"image", "font", "media"}
                        else route.continue_()
                    ),
                )
                await page.goto(url, wait_until="domcontentloaded", timeout=_GOTO_TIMEOUT_MS)
                # 주차 정보 영역 로드까지 약간 대기
                await page.wait_for_timeout(_EXTRA_WAIT_MS)
                text = await page.evaluate("() => document.body.innerText || ''")
            finally:
                await browser.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("kakao detail fetch failed pid=%s err=%s", place_id, e)
        return None

    if not text:
        return None
    from datetime import datetime, timezone

    d = parse_kakao_place_text(text, place_id)
    if not _has_any_data(d):
        return None
    d.fetched_at_iso = datetime.now(timezone.utc).isoformat()
    return d


def fetch_detail_sync(place_id: str) -> KakaoPlaceDetail | None:
    """라우터(sync FastAPI handler)에서 호출되는 진입점.

    - 캐시 hit → 즉시 반환 (0ms)
    - 캐시 miss → Playwright 호출 (~3~5초). 실패 시 negative cache 30분 (재시도 폭주 차단).
    """
    cached = _CACHE.get(place_id)
    if cached is not None:
        return cached
    if _NEGATIVE_CACHE.get(place_id):
        return None
    try:
        loop = asyncio.new_event_loop()
        try:
            d = loop.run_until_complete(_fetch_detail_async(place_id))
        finally:
            loop.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("kakao detail sync wrapper failed pid=%s err=%s", place_id, e)
        d = None

    if d is None:
        _NEGATIVE_CACHE.set(place_id, True)
        return None
    _CACHE.set(place_id, d)
    return d


def extract_place_id(url: str | None) -> str | None:
    return _extract_place_id_from_url(url)


def cache_stats() -> dict:
    return {
        "hit_cache": _CACHE.stats(),
        "negative_cache": _NEGATIVE_CACHE.stats(),
    }
