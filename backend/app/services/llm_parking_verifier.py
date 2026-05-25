"""LLM 기반 주차장 일반 개방 여부 검증 (Groq).

목적: 룰베이스 classifier 가 놓치는 회사/오피스텔/관공서 자체 주차장이 추천에
끼는 거위 버그 차단. 1순위 추천 후보만 LLM 한 번 호출해서 보수적으로 재검증.

원칙:
- 키 없거나 비활성이면 graceful skip — 분석 흐름 영향 0.
- 호출 1건당 최대 3초, 실패 시 silent fallback.
- 24h 캐시 (같은 (name, address) 조합 reuse).
- LLM 이 'restricted' 라 판단하면 우리 결정 위에 덮어쓰기 (보수적).
- 'uncertain' 도 caution 으로 강등.
"""
from __future__ import annotations

import json
import logging
from typing import Literal

import httpx

from ..config import get_settings
from ..utils.cache import TTLCache

logger = logging.getLogger(__name__)

LlmVerdict = Literal["open_to_public", "restricted", "uncertain"]


class VerifierResult:
    __slots__ = ("verdict", "reason", "confidence")

    def __init__(self, verdict: LlmVerdict, reason: str, confidence: str):
        self.verdict = verdict
        self.reason = reason
        self.confidence = confidence

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "reason": self.reason,
            "confidence": self.confidence,
        }


_CACHE: TTLCache[str, VerifierResult] = TTLCache(max_size=512, ttl_seconds=24 * 3600)
_NEGATIVE_CACHE: TTLCache[str, bool] = TTLCache(max_size=256, ttl_seconds=15 * 60)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_TIMEOUT = 3.0

_SYSTEM_PROMPT = """너는 한국 주차장의 일반인 이용 가능 여부를 판단하는 분류기다.
주차장 이름, 카테고리, 주소를 받고 다음 JSON 으로만 답한다 (설명 텍스트 금지):

{"verdict": "open_to_public" | "restricted" | "uncertain", "reason": "한 줄 한국어 설명", "confidence": "high" | "medium" | "low"}

기준:
- "open_to_public": 공영주차장, 노상공영, 민영 유료 일반 개방(시간제 요금), 카카오T·나이스파크·AJ파크 같은 운영사 주차장
- "restricted": 외부인 이용 어려운 곳 — 회사 사옥/지식산업센터/오피스텔/아파트/빌라/관공서(시청·세무서·기상청·우체국 등)/병원/학교/교회/군부대/특정 매장 전용
- "uncertain": ○○빌딩/○○타워 같이 일반 개방인지 회사 전용인지 명확하지 않은 경우

목적지 이름이 주차장과 동일 브랜드면 매장 자체 주차장으로 보고 open_to_public.
"""


def _cache_key(name: str, address: str | None) -> str:
    return f"{name.strip()}|{(address or '').strip()}"


def is_enabled() -> bool:
    s = get_settings()
    return bool(s.LLM_VERIFY_ENABLED and s.GROQ_API_KEY)


def _call_groq(payload: dict, api_key: str) -> dict | None:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            r = client.post(GROQ_URL, headers=headers, json=payload)
    except httpx.HTTPError as e:
        logger.warning("groq HTTP error: %s", e)
        return None
    if r.status_code != 200:
        # 키 노출 방지 — 본문 200자만, 헤더 제외
        logger.warning("groq status=%s body=%s", r.status_code, r.text[:200])
        return None
    try:
        return r.json()
    except ValueError:
        return None


def _parse_content(content: str) -> VerifierResult | None:
    """LLM 응답 text → JSON 파싱. 모델이 가끔 ```json fence 를 붙이거나 앞뒤 텍스트 섞음."""
    if not content:
        return None
    s = content.strip()
    # remove markdown fence
    if s.startswith("```"):
        s = s.strip("`")
        # remove leading "json\n"
        if s.lower().startswith("json"):
            s = s[4:].lstrip()
    # 첫 { 부터 마지막 } 까지만 추출
    a = s.find("{")
    b = s.rfind("}")
    if a == -1 or b == -1 or b <= a:
        return None
    try:
        obj = json.loads(s[a : b + 1])
    except json.JSONDecodeError:
        return None
    v = obj.get("verdict")
    if v not in ("open_to_public", "restricted", "uncertain"):
        return None
    return VerifierResult(
        verdict=v,
        reason=str(obj.get("reason") or "")[:160],
        confidence=str(obj.get("confidence") or "medium"),
    )


def verify(
    name: str,
    category: str | None,
    address: str | None,
    destination_name: str | None = None,
) -> VerifierResult | None:
    """1순위 주차장의 일반 개방 여부 LLM 재검증.

    캐시 hit 즉시 반환, miss 시 Groq 1회 호출 (~0.5~2s). 실패 시 None.
    """
    if not is_enabled():
        return None
    name = (name or "").strip()
    if not name:
        return None
    key = _cache_key(name, address)
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    if _NEGATIVE_CACHE.get(key):
        return None

    s = get_settings()
    user_msg = (
        f"주차장 이름: {name}\n"
        f"카테고리: {category or '미상'}\n"
        f"주소: {address or '미상'}\n"
        f"방문 목적지: {destination_name or '미상'}"
    )
    payload = {
        "model": s.GROQ_MODEL,
        "temperature": 0.0,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        _NEGATIVE_CACHE.set(key, True)
        return None
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        _NEGATIVE_CACHE.set(key, True)
        return None
    result = _parse_content(content)
    if result is None:
        _NEGATIVE_CACHE.set(key, True)
        return None
    _CACHE.set(key, result)
    return result


def verify_batch(items: list[dict]) -> list[VerifierResult | None]:
    """items: [{name, category, address, destination_name}, ...]

    병렬로 한 번에 검증 (최대 6 worker). 모든 후보 검증 + 순위 조절용.
    캐시 hit 은 즉시 반환되므로 같은 주차장은 0ms.
    """
    if not is_enabled() or not items:
        return [None] * len(items)

    from concurrent.futures import ThreadPoolExecutor, as_completed

    results: list[VerifierResult | None] = [None] * len(items)
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {}
        for i, it in enumerate(items):
            f = pool.submit(
                verify,
                it.get("name", ""),
                it.get("category"),
                it.get("address"),
                it.get("destination_name"),
            )
            futures[f] = i
        for f in as_completed(futures, timeout=8.0):
            i = futures[f]
            try:
                results[i] = f.result(timeout=0.1)
            except Exception:  # noqa: BLE001
                results[i] = None
    return results


def cache_stats() -> dict:
    return {"hit": _CACHE.stats(), "neg": _NEGATIVE_CACHE.stats()}
