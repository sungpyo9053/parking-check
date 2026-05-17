"""evidence 묶음을 자연어 1~2문장으로 요약 (Claude Haiku 4.5).

비용 처리:
- 6시간 TTL 캐시 (key = (목적지명, evidence url+matched 조합))
- evidence 0건이면 호출 안 함
- ANTHROPIC_API_KEY 미설정이면 graceful skip → None 반환
- 호출 실패도 None 반환 (라우터는 evidence + warning 으로 폴백)
"""
from __future__ import annotations

import logging
from typing import Sequence

from ..config import get_settings
from ..schemas.parking import SelfParkingEvidence
from ..utils.cache import TTLCache

logger = logging.getLogger(__name__)

# 같은 매장 + evidence 묶음은 6시간 동안 캐시
_CACHE: TTLCache[tuple, str] = TTLCache(max_size=512, ttl_seconds=6 * 3600)

_SYSTEM_PROMPT = """너는 주차 정보 요약 도우미다.
사용자가 카페/식당/매장의 주차 정보를 조회했을 때, 웹 evidence 묶음을 보고
한국어로 정확히 1~2문장 자연스럽게 요약한다.

규칙:
- 출력은 1~2문장.
- evidence 에 근거해서만 답한다. 추측 금지.
- 인근 공영/민영 주차장 안내가 있으면 그 사실을 언급한다.
- 자체 주차장 시그널이 강하면 "가능", "있는 것으로 보임" 같은 비단정 표현 사용.
- 이모지/마크다운/리스트 금지. 평문 1~2문장만.
- "방문 전 확인이 필요합니다" 같은 일반 주의 문구는 생략한다 (별도 표시됨).
"""


def is_enabled() -> bool:
    s = get_settings()
    return bool(s.ANTHROPIC_API_KEY)


def _build_user_prompt(
    dest_name: str | None, evidences: Sequence[SelfParkingEvidence]
) -> str:
    parts: list[str] = [f"매장: {dest_name or '(이름 미상)'}"]
    parts.append("")
    parts.append("아래는 웹 검색에서 수집한 주차 관련 evidence들이다:")
    parts.append("")
    for i, e in enumerate(evidences, 1):
        snip = (e.snippet or "").replace("\n", " ")[:220]
        kws = ", ".join(e.matched_keywords) if e.matched_keywords else "(없음)"
        parts.append(f"[{i}] confidence={e.confidence} 매칭={kws}")
        parts.append(f'    제목: {e.title or "(제목 없음)"}')
        parts.append(f'    내용: "{snip}"')
    parts.append("")
    parts.append(
        "위 evidence 만으로 자연스러운 한국어 1~2문장 요약을 출력해라. "
        "다른 말, 마크다운, 이모지 없이 본문만."
    )
    return "\n".join(parts)


def summarize(
    dest_name: str | None, evidences: Sequence[SelfParkingEvidence]
) -> str | None:
    """evidence 묶음 → 자연어 요약. 키 없거나 evidence 0건이면 None.

    같은 evidence 묶음은 6시간 캐시.
    """
    if not is_enabled() or not evidences:
        return None

    key = (
        (dest_name or "").strip().lower(),
        tuple(
            sorted(
                (
                    (e.url or "")[:80],
                    e.confidence,
                    tuple(sorted(e.matched_keywords)),
                )
                for e in evidences
            )
        ),
    )
    cached = _CACHE.get(key)
    if cached is not None:
        return cached

    try:
        from anthropic import Anthropic
    except ImportError:
        logger.warning("anthropic SDK not installed — skip LLM summary")
        return None

    api_key = get_settings().ANTHROPIC_API_KEY
    try:
        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=300,
            system=_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": _build_user_prompt(dest_name, evidences),
                }
            ],
        )
    except Exception as e:  # noqa: BLE001 — 요약 실패가 라우터 전체를 죽이지 않게
        logger.warning("LLM summary call failed: %s", e)
        return None

    text_parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(getattr(block, "text", "") or "")
    summary = "".join(text_parts).strip()
    if not summary:
        return None
    _CACHE.set(key, summary)
    return summary


def cache_stats() -> dict:
    return _CACHE.stats()
