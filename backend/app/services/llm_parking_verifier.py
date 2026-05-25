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

_SYSTEM_PROMPT = """너는 한국 주차장의 일반인 이용 가능 여부를 판단하는 보수적 분류기다.
주차장 이름, 카테고리, 주소를 받고 다음 JSON 으로만 답한다 (설명 텍스트 금지):

{"verdict": "open_to_public" | "restricted" | "uncertain", "reason": "한 줄 한국어 설명", "confidence": "high" | "medium" | "low"}

판단 기준 (반드시 엄격하게):

[open_to_public — 일반인 자유 이용]
- "공영주차장" / "노상공영" 명시
- 운영사 브랜드명: **"카카오T"** (T 가 반드시 포함) / 나이스파크 / AJ파크 / 윌슨파킹 / GS파크24 / 하이파크 / 티맵주차 (이름에 정확히 포함될 때만)
  ⚠️ "카카오" 단독은 회사명. "카카오T" 만 주차 운영사. 둘은 다른 것.
  ⚠️ "카카오 판교 아지트", "카카오 본사" 등 "카카오" 만 있는 것은 회사 사옥 → restricted
- "민영주차장" / "유료주차장" / "주차타워" + 일반 개방 가능 신호

[restricted — 외부인 이용 불가]
- 관공서: 시청/구청/세무서/기상청/우체국/경찰서/소방서/검찰청/법원/공단/공사
- 회사: ○○사옥/본사/지식산업센터/오피스텔/주식회사
- 주거: 아파트/빌라/주상복합/오피스텔/원룸
- 의료·교육·종교: 병원/의원/학교/대학/교회/성당/사찰
- 매장 전용: "○○ 전용주차장" 명시
- 군 시설

[uncertain — 모호]
- "○○빌딩 / ○○타워 / ○○센터 / ○○플라자" 처럼 회사 빌딩일 가능성 + 일반 개방 신호 없음
- 이름만 "주차장" 등 정보 부족
- 카테고리만 "주차장" 이고 다른 단서 없음

⚠️ 절대 규칙:
1. **이름 suffix 가 같다고 "동일 브랜드"로 판단하지 마라.** 예: "티원타워"와 "직지스마트타워"는 다른 건물 (둘 다 "타워"로 끝날 뿐). 정확한 고유명 토큰 (예: "스타벅스" / "올리브영" 처럼 명확한 매장 브랜드명) 이 일치할 때만 매장 자체 주차장으로 인정.
2. **목적지명과 주차장명이 다르면 무조건 "근처 다른 시설의 주차장"으로 본다.** 회사 빌딩 주차장은 restricted/uncertain.
3. confidence "high" 는 명확한 단서가 이름/카테고리에 있을 때만. 추측은 "low".
"""


def _cache_key(name: str, address: str | None) -> str:
    return f"{name.strip()}|{(address or '').strip()}"


def is_enabled() -> bool:
    s = get_settings()
    return bool(s.LLM_VERIFY_ENABLED and s.GROQ_API_KEY)


def _model_classify() -> str:
    s = get_settings()
    return s.GROQ_MODEL_CLASSIFY or s.GROQ_MODEL


def _model_generate() -> str:
    s = get_settings()
    return s.GROQ_MODEL_GENERATE or s.GROQ_MODEL


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
        "model": _model_classify(),
        "temperature": 0.0,
        "max_tokens": 100,
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
    # Groq 무료 TPM 6000 보호 — 동시 worker 3, 최대 8건만 (그 이상은 cache 일치 시
    # 다음 분석에서 자연 보강됨)
    with ThreadPoolExecutor(max_workers=3) as pool:
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


_INTENT_CACHE: TTLCache[str, dict] = TTLCache(max_size=512, ttl_seconds=24 * 3600)
_REASONS_CACHE: TTLCache[str, str] = TTLCache(max_size=512, ttl_seconds=6 * 3600)
_SHARE_CACHE: TTLCache[str, str] = TTLCache(max_size=512, ttl_seconds=24 * 3600)


_INTENT_SYSTEM = """너는 사용자 검색어와 카카오 장소 후보 목록을 받고, 사용자가
실제로 찾고 있을 가능성이 가장 높은 후보를 한 개 고르는 분류기다.
다음 JSON 으로만 답한다:

{"best_index": <number>, "reason": "한 줄 한국어 이유"}

기준:
- 사용자 검색어가 줄임말/오타인 경우 정식 명칭으로 매핑 (예: "스벅"→스타벅스)
- 동일 이름이 여러 개 있으면(예: 역 호선 차이) 일반적으로 가장 통용되는 것 선택
  - "강남역" 단독 → 2호선이 가장 일반
  - "선릉역" 단독 → 2호선
- 매장명 + 지역명 조합이면 그 지역의 매장 우선 (예: "더홈 안양" → 안양 매장)
- 검색어와 무관한 후보는 절대 선택하지 마라. 분명히 매칭되는 것 없으면 best_index=-1
"""


def pick_search_intent(query: str, candidates: list[dict]) -> dict | None:
    """카카오 검색 결과 중 사용자 의도에 가장 가까운 후보 1개 선정.
    candidates: [{name, category, road_address|address}, ...]
    리턴: {"best_index": int, "reason": str} 또는 None.
    """
    if not is_enabled() or not query.strip() or not candidates:
        return None
    # 캐시 키
    sig = f"{query}|{len(candidates)}|" + "|".join(
        (c.get("name") or "")[:20] for c in candidates[:6]
    )
    cached = _INTENT_CACHE.get(sig)
    if cached is not None:
        return cached

    cand_text = "\n".join(
        f"[{i}] {c.get('name','')} | {c.get('category','') or ''} | {c.get('road_address') or c.get('address') or ''}"
        for i, c in enumerate(candidates[:10])
    )
    user_msg = f"검색어: {query}\n\n후보:\n{cand_text}"
    s = get_settings()
    payload = {
        "model": _model_classify(),
        "temperature": 0.0,
        "max_tokens": 160,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _INTENT_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        return None
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None
    import json as _json

    s_str = content.strip()
    if s_str.startswith("```"):
        s_str = s_str.strip("`")
        if s_str.lower().startswith("json"):
            s_str = s_str[4:].lstrip()
    a = s_str.find("{")
    b = s_str.rfind("}")
    if a == -1 or b == -1:
        return None
    try:
        obj = _json.loads(s_str[a : b + 1])
    except _json.JSONDecodeError:
        return None
    idx = obj.get("best_index")
    if not isinstance(idx, int) or idx < -1 or idx >= len(candidates):
        return None
    result = {"best_index": idx, "reason": str(obj.get("reason") or "")[:140]}
    _INTENT_CACHE.set(sig, result)
    return result


def generate_share_text(place_name: str, visit_label: str, score: int) -> str | None:
    """공유용 한 줄 카피 동적 생성 (자연어 모델 사용)."""
    if not is_enabled():
        return None
    key = f"{place_name}|{visit_label}|{score}"
    cached = _SHARE_CACHE.get(key)
    if cached is not None:
        return cached
    s = get_settings()
    user_msg = (
        f"장소: {place_name}\n차량 방문 판단: {visit_label}\n주차 가능성 점수: {score}/100\n\n"
        "카카오톡/SNS 공유용 한국어 한 줄 카피 (60자 이내, 따옴표/이모지 X)."
    )
    payload = {
        "model": _model_generate(),
        "temperature": 0.5,
        "max_tokens": 140,
        "messages": [
            {
                "role": "system",
                "content": (
                    "너는 한국 사용자에게 공유될 한 줄 카피를 만든다. '주차 가능' 단정 X, "
                    "'주차 가능성' / '주차 난이도' / '방문 전 확인' 표현 사용. 한 줄만, "
                    "60자 이내, 자연스럽게."
                ),
            },
            {"role": "user", "content": user_msg},
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        return None
    try:
        content = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        return None
    content = content.split("\n")[0].strip().strip('"').strip("「").strip("」")
    if len(content) > 90:
        content = content[:88] + "…"
    if not content:
        return None
    _SHARE_CACHE.set(key, content)
    return content


_QA_SYSTEM = """너는 한국 운전자에게 주차/방문 조언을 한국어로 해주는 비서다.
사용자가 특정 장소에 대해 질문하면, 제공된 분석 정보를 바탕으로 간결하게 답한다.
규칙:
- "주차 가능"이라고 단정하지 말고 "주차 가능성/난이도/방문 전 확인" 표현
- 사용자가 모르는 정보는 솔직히 "현재 데이터로는 알 수 없습니다" 라고 답
- 2~3 문장, 60~120자, 평서문
- 따옴표/이모지/JSON 금지
"""


def answer_question(question: str, context: dict) -> str | None:
    """사용자 자유 질문 답변. context = {place_name, visit_label, dedicated,
    nearby_count, top_rec_name, top_walk_min, top_fee_text}.
    """
    if not is_enabled() or not question.strip():
        return None
    ctx_lines = [
        f"장소: {context.get('place_name','미상')}",
        f"차량 방문 판단: {context.get('visit_label','정보 부족')}",
        f"자체 주차장: {context.get('dedicated','확인 필요')}",
        f"근처 일반 개방 주차장: {context.get('nearby_count',0)}곳",
    ]
    if context.get("top_rec_name"):
        ctx_lines.append(
            f"1순위 주차장: {context['top_rec_name']} (도보 {context.get('top_walk_min','?')}분)"
        )
    if context.get("top_fee_text"):
        ctx_lines.append(f"1순위 요금: {context['top_fee_text']}")
    ctx = "\n".join(ctx_lines)
    s = get_settings()
    payload = {
        "model": _model_generate(),
        "temperature": 0.5,
        "max_tokens": 280,
        "messages": [
            {"role": "system", "content": _QA_SYSTEM},
            {
                "role": "user",
                "content": f"분석 정보:\n{ctx}\n\n사용자 질문: {question.strip()}",
            },
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        return None
    try:
        content = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        return None
    if len(content) > 320:
        content = content[:318] + "…"
    return content or None


_REVIEW_SUMMARY_SYSTEM = """너는 한국 카카오맵 주차장 페이지의 후기/블로그
스니펫을 받아서 사용자에게 주차 관련 핵심을 한 줄로 요약해준다.
60자 이내 한국어 평서문. "주차장 협소", "발렛 가능", "출입 까다로움", "야간 만차"
같이 의사결정에 도움될 한 문장만. 따옴표/이모지 X. 후기에 주차 관련 정보 없으면
빈 문자열 반환.
"""


def summarize_reviews(snippets: list[str]) -> str | None:
    if not is_enabled() or not snippets:
        return None
    joined = "\n---\n".join(s[:240] for s in snippets[:5])
    s = get_settings()
    payload = {
        "model": _model_generate(),
        "temperature": 0.3,
        "max_tokens": 140,
        "messages": [
            {"role": "system", "content": _REVIEW_SUMMARY_SYSTEM},
            {"role": "user", "content": joined},
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        return None
    try:
        content = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        return None
    content = content.split("\n")[0].strip().strip('"').strip("「").strip("」")
    return content or None


def cache_stats() -> dict:
    return {"hit": _CACHE.stats(), "neg": _NEGATIVE_CACHE.stats()}


_SUMMARY_CACHE: TTLCache[str, str] = TTLCache(max_size=512, ttl_seconds=6 * 3600)
_SELF_CACHE: TTLCache[str, "VerifierResult"] = TTLCache(max_size=512, ttl_seconds=24 * 3600)


_SELF_SYSTEM = """너는 한국 매장의 '자체 주차장' 가능 여부를 블로그/리뷰 snippet
으로부터 판단하는 분류기다. 다음 JSON 으로만 답한다:

{"verdict": "available" | "unavailable" | "uncertain", "reason": "한 줄 한국어 근거 인용 또는 요약", "confidence": "high" | "medium" | "low"}

기준:
- "available": snippet 에 "전용주차장 있어요", "주차장 ○대", "지하주차 가능" 등 매장
  자체 주차 명확히 가능 표현이 있는 경우. confidence high.
- "unavailable": "주차장 없음", "근처 공영주차장 이용", "주차 어려워요" 등
  매장 자체 주차 어렵다는 명시.
- "uncertain": 정보 엇갈리거나 부족.

⚠️ 절대 규칙:
1. snippet 이 매장과 무관한 다른 장소의 주차 정보일 수 있다. 매장명이 직접 언급되지 않은
   snippet 은 신뢰도 낮춤 (low).
2. "주변 주차장" "근처 주차장"은 매장 자체 주차장이 아님. 자체 주차 정보로 인정 X.
3. 한국에서 "자체주차/전용주차/매장 주차"는 매장이 운영, "공영주차장/노상"은 외부.
"""


def classify_self_parking_from_evidence(
    dest_name: str,
    dest_addr: str | None,
    evidence_snippets: list[str],
) -> VerifierResult | None:
    """블로그/리뷰 snippet 들을 LLM 으로 분류해서 자체 주차 가능 여부 판단."""
    if not is_enabled() or not evidence_snippets:
        return None
    # cache key: dest + 처음 snippet 들 hash
    sig = f"{dest_name}|{(dest_addr or '')[:40]}|{len(evidence_snippets)}|{evidence_snippets[0][:60] if evidence_snippets else ''}"
    cached = _SELF_CACHE.get(sig)
    if cached is not None:
        return cached

    joined = "\n---\n".join(s[:280] for s in evidence_snippets[:6])
    user_msg = (
        f"매장명: {dest_name}\n"
        f"매장 주소: {dest_addr or '미상'}\n\n"
        f"블로그/리뷰 snippet:\n{joined}\n\n"
        "위 snippet 으로부터 이 매장의 자체 주차 가능 여부를 분류해줘."
    )
    s = get_settings()
    payload = {
        "model": _model_classify(),
        "temperature": 0.0,
        "max_tokens": 220,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SELF_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        return None
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None
    # _parse_content 는 verdict 가 open_to_public/restricted/uncertain 기대 — 별도 파싱
    import json as _json

    s_str = content.strip()
    if s_str.startswith("```"):
        s_str = s_str.strip("`")
        if s_str.lower().startswith("json"):
            s_str = s_str[4:].lstrip()
    a = s_str.find("{")
    b = s_str.rfind("}")
    if a == -1 or b == -1:
        return None
    try:
        obj = _json.loads(s_str[a : b + 1])
    except _json.JSONDecodeError:
        return None
    v = obj.get("verdict")
    if v not in ("available", "unavailable", "uncertain"):
        return None
    result = VerifierResult(
        verdict=v,  # type: ignore[arg-type]
        reason=str(obj.get("reason") or "")[:160],
        confidence=str(obj.get("confidence") or "medium"),
    )
    _SELF_CACHE.set(sig, result)
    return result

_SUMMARY_SYSTEM = """너는 한국 주차 가능성 판단 결과를 한 줄로 자연스럽게 요약하는
어시스턴트다. 사용자가 차량 방문 결정에 도움될 한국어 한 문장(최대 80자)으로만 답한다.
설명 텍스트나 인사말, JSON 등 X. 표현 규칙:
- "주차 가능"이라고 단정하지 말고 "가능성", "추천", "확인 필요", "어려울 수 있음" 사용
- 사용자에게 명확한 다음 행동(예: 도보 분 거리 추천, 대중교통 권유)을 한 문장에 녹임
- 따옴표나 콜론 없이 평서문으로
"""


def generate_summary(
    place_name: str,
    visit_recommendation: str,
    has_dedicated: str,
    nearby_usable_count: int,
    top_walk_min: int | None,
    top_rec_name: str | None,
) -> str | None:
    """분석 결과 한 줄 자연어 요약 생성. 키 없으면 None.
    캐시 키: (place_name, visit_rec, has_dedicated, nearby_count, walk) — 6h.
    """
    if not is_enabled():
        return None
    key = (
        f"{place_name}|{visit_recommendation}|{has_dedicated}|"
        f"{nearby_usable_count}|{top_walk_min}|{top_rec_name}"
    )
    cached = _SUMMARY_CACHE.get(key)
    if cached is not None:
        return cached

    user_msg = (
        f"장소: {place_name}\n"
        f"차량 방문 판단: {visit_recommendation}\n"
        f"자체 주차장: {has_dedicated}\n"
        f"근처 일반 개방 주차장: {nearby_usable_count}곳\n"
    )
    if top_rec_name and top_walk_min is not None:
        user_msg += f"1순위 추천: {top_rec_name} (도보 {top_walk_min}분)\n"
    user_msg += "위 정보로 사용자에게 줄 한국어 한 줄 결론을 만들어줘 (80자 이내)."

    s = get_settings()
    payload = {
        "model": _model_generate(),
        "temperature": 0.4,
        "max_tokens": 180,
        "messages": [
            {"role": "system", "content": _SUMMARY_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    }
    data = _call_groq(payload, s.GROQ_API_KEY)
    if not data:
        return None
    try:
        content = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        return None
    # 한 줄로 정리, 따옴표 제거
    content = content.split("\n")[0].strip().strip('"').strip("「").strip("」")
    if len(content) > 140:
        content = content[:138] + "…"
    if not content:
        return None
    _SUMMARY_CACHE.set(key, content)
    return content
