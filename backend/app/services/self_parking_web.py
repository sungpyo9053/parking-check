"""목적지 '자체 주차' 가능성을 웹 검색 evidence 로 보강.

룰 기반 매칭만 사용 (LLM 미사용). Tavily 결과의 title/content/url 안에
- positive 키워드 (주차가능, 무료 주차, 바로앞 주차 등) 가 등장하고
- 목적지 이름 또는 주소 토큰이 같은 문장/스니펫에 등장하면
점수를 올려 'likely' 로 격상. negative 키워드 (주차 불가, 주차장 없음) 가
등장하면 점수를 내린다.

설계 원칙:
- 실시간/현장은 절대 단정하지 않는다. 항상 warning 부착.
- 키 없으면 evidence 비어있고 status 변경 없음.
- LLM 요약은 추후 단계 — 지금은 evidence 의 snippet 만 그대로 보여준다.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable

from ..schemas.parking import SelfParking, SelfParkingEvidence
from . import llm_summary, web_parking_search

logger = logging.getLogger(__name__)


# --- 가중치 룰 ---
#
# 단순 "주차 가능" 은 매장 자체 주차일 수도 있고 인근 공영 안내일 수도 있어서
# 약한 시그널로만 본다. '자체' 주차임을 강하게 시사하는 표현 (전용주차장,
# 매장 앞 주차, 건물 주차장 등) 만 강한 가중치를 준다. 반대로 '인근/근처 공영
# 주차장 이용 가능' 류는 자체 주차 부재의 명확한 시그널이라 강한 negative.
POSITIVE_KEYWORDS: dict[str, int] = {
    # 강한 자체 주차 시그널
    "전용주차장": 40,
    "전용 주차": 40,
    "건물 주차장": 35,
    "건물에도 주차": 30,
    "타워 주차장": 35,        # XX타워 주차장 — 빌딩 주차장
    "빌딩 주차장": 35,        # XX빌딩 주차장
    "타워 지하 주차": 35,     # XX타워 지하 주차
    "지하 주차장": 35,        # 25 → 35 (자체 시그널 강화)
    "지하주차장": 35,
    "매장 앞 주차": 30,
    "매장앞 주차": 30,
    "바로앞 주차": 30,
    "주차장 이용 가능": 30,   # '~ 주차장 이용 가능' 빌딩 주차장 시그널
    "주차장 이용가능": 30,
    "주차장 이용": 25,        # '~ 주차장 이용' (빌딩명 동반)
    "옥상 주차": 20,
    # 중간
    "무료 주차": 25,
    "무료주차": 25,
    "주차 이용 가능": 25,
    "주차이용 가능": 25,
    "주차 여러대": 20,
    "주차공간 있음": 20,
    "주차공간 많": 20,
    "주차장 있": 15,
    # 약함 — '주차 가능' 단독은 인근 공영 안내와 구분 안 됨
    "주차 가능": 8,
    "주차가능": 8,
    "주차공간": 8,
    "주차장 있나": 3,
}

# 일반 negative 키워드 (개별 표현이 아니라 보편 시그널만)
NEGATIVE_KEYWORDS: dict[str, int] = {
    "주차 불가": -50,
    "주차불가": -50,
    "주차장 없음": -45,
    "주차 안 됨": -35,
    "주차안됨": -35,
    "주차 어려": -30,
    "주차 힘들": -30,
    "주차 힘듦": -30,
    "주차장 추천": -25,  # 매장 외 다른 주차장을 추천하는 표현
}


# --- 일반 regex 패턴 (건바이건 키워드 추가 대신 패턴 인식) ---
import re as _re

# === NEGATIVE 패턴 ===

# (N1) 자체 주차 부재 선언: "전용/매장/건물/자체 + 주차장 + (따로) 없|불가|어렵"
_SELF_NEGATION_RE = _re.compile(
    r"(?:전용\s*주차장?|매장\s*주차장?|건물\s*주차장?|자체\s*주차장?|"
    r"별도\s*주차장?|개별\s*주차장?)"
    r"[은는이가]?\s*(?:따로\s*)?"
    r"(?:없|불가|안\s*됨|안\s*돼|어렵|힘들)"
)
_SELF_NEGATION_WEIGHT = -50

# (N2) 인근/도보 거리 주차장 안내
_NEARBY_PARKING_RE = _re.compile(
    r"(?:인근|근처|주변|맞은편|"
    r"도보\s*\d+\s*분(?:\s*거리)?|"
    r"[\d.]+\s*m\s*(?:거리|떨어진)?)"
    r"[^.!?\n]{0,15}?"
    r"(?:공영|민영|유료|노상|공용|공원)?\s*주차장?\s*(?:이용|있|추천)"
)
_NEARBY_PARKING_WEIGHT = -50  # 이재모피자 회귀 보강 (-45 → -50)

# (N3) 외부 주차장명 + 추천: "용두산공영주차장 추천", "OO유료주차장 추천"
_EXTERNAL_RECOMMEND_RE = _re.compile(
    r"[가-힣A-Za-z0-9]{2,15}(?:공영|민영|유료|노상)\s*주차장?\s*(?:추천|이용)"
)
_EXTERNAL_RECOMMEND_WEIGHT = -35


# === POSITIVE 패턴 (자체 시그널 일반화) ===

# (P1) 시간 단위 무료 주차 제공 ("2시간 무료 주차" 등) — 자체/제휴 시그널
_FREE_PARKING_RE = _re.compile(
    r"\d+\s*시간(?:\s*\d+\s*분)?\s*(?:무료|지원)\s*주차"
)
_FREE_PARKING_WEIGHT = 30

# (P2) 건물/매장/지하/옥상 + 주차: 매장 입점 건물 자체 주차 시그널
# 예: "건물에 주차", "건물 내 주차", "건물 지하 주차", "지하에 주차", "매장에 주차"
_BUILDING_PARKING_RE = _re.compile(
    r"(?:건물\s*(?:내|지하|에서?|에도)|건물지하|"
    r"매장\s*(?:내|에서?|에도)|매장내|"
    r"지하(?:\s*\d+층)?\s*(?:에서?|주차장)|"
    r"옥상\s*(?:에서?|주차장))\s*(?:주차|주차장)"
)
_BUILDING_PARKING_WEIGHT = 30

# (P3) 발렛/발레 파킹: 매장 발레 서비스
_VALET_RE = _re.compile(r"발(?:렛|레)\s*파킹")
_VALET_WEIGHT = 30


# positive 키워드 직후 12자 이내에 부정 패턴이 오면 그 매칭을 무효화
_NEGATION_AFTER = _re.compile(
    r"(없었|없습|없어|없고|안\s*돼|안\s*됨|불가능|불가|어렵|힘들|힘듭|어려워|불가합)"
)


def _apply_regex(pattern: _re.Pattern, text: str, weight: int, label: str) -> tuple[int, list[str]]:
    """패턴 매칭 누적 — 같은 패턴 여러 번 잡히면 누적."""
    score = 0
    matched: list[str] = []
    for m in pattern.finditer(text):
        score += weight
        matched.append(f"[{label}] {m.group(0)[:25]}")
    return score, matched

# 'likely' / 'uncertain' 격상 임계
THRESHOLD_LIKELY = 55
THRESHOLD_UNCERTAIN = 25


# --- 카테고리 prior ---
#
# 카카오 places category 에는 백화점/쇼핑몰/시장/관광명소/거리 같은 분류가
# 들어있다. 자체 주차 보유 사전 확률이 카테고리만으로도 강하게 갈리므로
# (백화점/쇼핑몰은 거의 100% 자체 보유, 전통시장/거리는 거의 자체 없음)
# evidence 점수와 합산하기 전에 prior 를 부여한다.
_POS_CATEGORY_HINTS: dict[str, int] = {
    "백화점": 60,
    "쇼핑몰": 60,
    "복합쇼핑": 60,
    "아울렛": 55,
    "할인점": 50,
    "대형마트": 50,
    "대형슈퍼": 40,
    "슈퍼마켓": 25,
    "슈퍼": 15,
    "마트": 30,   # 일반 마트 (이마트/홈플러스/롯데마트 등)
    "편의점": 0,  # 명시적으로 0 — 매칭 시 prior 안 줌
    "리조트": 45,
    "호텔": 40,
    "휴양림": 40,
    "테마파크": 50,
    "놀이공원": 50,
    "수족관": 45,
    "박물관": 30,
    "전시관": 25,
}

_NEG_CATEGORY_HINTS: dict[str, int] = {
    "전통시장": -40,
    "재래시장": -40,
    "골목시장": -35,
    "시장": -35,           # 일반 '시장' 카테고리 (가정,생활 > 시장)
    "관광명소": -25,
    "테마거리": -35,        # 익선동 한옥거리, 인사동 문화의거리
    "거리": -25,            # XX거리 일반
    "한옥마을": -30,
    "한옥거리": -35,
    "도예촌": -25,
    "유적지": -20,
    "사적지": -20,
    "교회": -35,
    "성당": -35,
    "사찰": -30,
    "지하상가": -35,
    "공원": -15,            # 공원 자체는 주차장 있지만 부분적
}


def category_prior(category: str | None) -> tuple[int, str | None]:
    """카카오 places category 로 자체 주차 사전 점수 산정."""
    if not category:
        return 0, None
    for kw, w in _POS_CATEGORY_HINTS.items():
        if kw in category:
            return w, f"카테고리({kw}) — 자체 주차 보유 가능성 매우 높음"
    for kw, w in _NEG_CATEGORY_HINTS.items():
        if kw in category:
            return w, f"카테고리({kw}) — 매장 자체 주차 보통 없음/제한"
    return 0, None


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return s.replace(" ", "").lower()


def _name_or_addr_in_text(text: str, dest_name: str | None, dest_addr: str | None) -> bool:
    """목적지 이름 또는 주소 동/단지 토큰이 텍스트에 포함되는지."""
    if not text:
        return False
    t = text.lower()
    t_norm = _norm(text)
    if dest_name:
        n = dest_name.strip().lower()
        if n and n in t:
            return True
        if _norm(dest_name) in t_norm:
            return True
    if dest_addr:
        # 동/읍/면 단위와 도로명만 추출해서 부분 매칭
        for tok in dest_addr.split():
            if len(tok) >= 2 and (
                tok.endswith(("동", "읍", "면", "리", "가"))
                or tok.endswith("로")
                or "로" in tok and tok[0].isdigit() is False
            ):
                if tok.lower() in t:
                    return True
    return False


def _score_text(text: str) -> tuple[int, list[str]]:
    """텍스트에 등장한 키워드 가중치 합계와 매칭된 키워드 목록.

    부정 처리:
      1) positive 키워드 직후 12자 안에 부정 패턴('없', '안 됨', '불가' 등)이
         오면 그 positive 매칭은 무효 ("전용 주차장은 따로 없었지만" 같은 케이스)
      2) 같은 텍스트에 negative ≤ -25 가 있으면 남은 positive 도 완전 무효화
         (인근 안내 문맥에 묻힌 거짓 positive 차단)
    """
    if not text:
        return 0, []
    pos_score = 0
    neg_score = 0
    matched: list[str] = []
    t = text.lower()

    for kw, weight in POSITIVE_KEYWORDS.items():
        kw_lower = kw.lower()
        idx = t.find(kw_lower)
        if idx < 0:
            continue
        # 키워드 직후 12자 윈도우에 부정 단어가 있으면 무효
        tail = t[idx + len(kw_lower) : idx + len(kw_lower) + 12]
        if _NEGATION_AFTER.search(tail):
            matched.append(f"{kw}(부정문 무효)")
            continue
        pos_score += weight
        matched.append(kw)

    for kw, weight in NEGATIVE_KEYWORDS.items():
        if kw.lower() in t:
            neg_score += weight
            matched.append(kw)

    # regex 패턴 — negative (일반화)
    for pat, w, label in [
        (_SELF_NEGATION_RE, _SELF_NEGATION_WEIGHT, "자체부재"),
        (_NEARBY_PARKING_RE, _NEARBY_PARKING_WEIGHT, "인근안내"),
        (_EXTERNAL_RECOMMEND_RE, _EXTERNAL_RECOMMEND_WEIGHT, "외부추천"),
    ]:
        s, m = _apply_regex(pat, text, w, label)
        neg_score += s
        matched.extend(m)

    # regex 패턴 — positive (자체 시그널 일반화)
    for pat, w, label in [
        (_FREE_PARKING_RE, _FREE_PARKING_WEIGHT, "무료주차제공"),
        (_BUILDING_PARKING_RE, _BUILDING_PARKING_WEIGHT, "건물/매장 주차"),
        (_VALET_RE, _VALET_WEIGHT, "발렛파킹"),
    ]:
        s, m = _apply_regex(pat, text, w, label)
        pos_score += s
        matched.extend(m)

    if neg_score <= -25 and pos_score > 0:
        pos_score = 0

    return pos_score + neg_score, matched


def _evidence_confidence(score: int) -> str:
    if score >= 40:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def collect_web_self_parking_evidence(
    dest_name: str | None,
    dest_addr: str | None,
) -> tuple[int, list[SelfParkingEvidence]]:
    """Tavily 결과를 받아 self_parking evidence + 점수 합계를 돌려준다.

    웹 검색 비활성/실패 시 (0, []) 반환.
    """
    if not web_parking_search.any_provider_enabled():
        return 0, []
    if not (dest_name or dest_addr):
        return 0, []

    try:
        items = web_parking_search.search_web_parking(
            destination_name=dest_name, destination_address=dest_addr
        )
    except Exception as e:  # noqa: BLE001 - evidence 수집은 절대 라우터 죽이지 않음
        logger.warning("self_parking web evidence fetch failed: %s", e)
        return 0, []

    total_score = 0
    evidences: list[SelfParkingEvidence] = []
    for it in items:
        title = (it.get("title") or "").strip()
        snippet = (it.get("snippet") or "").strip()
        url = (it.get("url") or "").strip() or None
        combined = f"{title}\n{snippet}"

        # 목적지 관련성 1차 필터: 이름/주소 토큰 매칭 없으면 건너뜀 (노이즈 차단)
        if not _name_or_addr_in_text(combined, dest_name, dest_addr):
            continue

        score, matched = _score_text(combined)
        if not matched:
            continue

        # 너무 긴 snippet 은 200자로 자름 (UI 표시용)
        snip_short = snippet[:200] + ("…" if len(snippet) > 200 else "") if snippet else None

        evidences.append(
            SelfParkingEvidence(
                source="web_search",
                title=title or None,
                url=url,
                snippet=snip_short,
                matched_keywords=matched,
                confidence=_evidence_confidence(abs(score)),
            )
        )
        total_score += score

    # evidence 가 너무 많으면 confidence 높은 순으로 5개만
    if len(evidences) > 5:
        order = {"high": 0, "medium": 1, "low": 2}
        evidences.sort(key=lambda e: order.get(e.confidence, 3))
        evidences = evidences[:5]

    return total_score, evidences


_DEFAULT_WARNING = (
    "방문 전 매장에 주차 가능 여부 또는 운영 정책을 직접 확인하는 것을 권장합니다."
)


def enrich_self_parking(
    base: dict,
    dest_name: str | None,
    dest_addr: str | None,
    dest_category: str | None = None,
    has_kakao_self_parking: bool = False,
) -> SelfParking:
    """estimate_self_parking() 의 dict 결과에 웹 evidence + 카테고리 prior 를 합쳐
    SelfParking 으로 반환.

    base 가 이미 'available' (DB 부설주차장 강매칭) 이면 evidence 만 첨부하고
    status/confidence 는 유지한다. base 가 'unknown'/'uncertain' 일 때만 격상 후보.
    """
    base_status: str = base.get("status") or "unknown"
    base_confidence: int = int(base.get("confidence") or 0)
    base_reason: str | None = base.get("reason")
    matched_lot_id = base.get("matched_lot_id")

    web_score, evidences = collect_web_self_parking_evidence(dest_name, dest_addr)
    prior_score, prior_reason = category_prior(dest_category)
    combined_score = web_score + prior_score

    # 카카오에 '{목적지명} 주차장' 같은 자체 주차장 POI 가 분류기에서 잡혔다면
    # web evidence / 카테고리 prior 와 무관하게 likely 로 격상.
    # (예: '아리차이 신림점' → 카카오에 '아리차이 신림점 주차장' 별도 등록.
    # Tavily 가 evidence 0 건이어도 카카오 매칭만으로 충분히 강함.)
    if (
        has_kakao_self_parking
        and (base.get("status") or "unknown") not in ("available", "unavailable")
    ):
        return SelfParking(
            status="likely",
            confidence=85,
            label="자체 주차 가능성 높음 (지도 POI)",
            reason=(
                "카카오 지도에 매장 자체 주차장이 별도 POI 로 등록되어 있습니다. "
                "추천 카드의 ⭐ 자체 주차장을 이용하세요."
            ),
            summary_natural=None,
            matched_lot_id=base.get("matched_lot_id"),
            evidence=evidences,
            warning=_DEFAULT_WARNING,
        )

    final_status: str = base_status
    final_confidence = base_confidence
    final_reason = base_reason

    # 격상/하향 판단은 evidence 가 없어도 prior 만으로 가능하게.
    has_signal = bool(evidences) or prior_score != 0
    used_score = combined_score
    if base_status not in ("available", "unavailable") and has_signal:
        # 카테고리 prior 가 양수일 때만 reason 에 첨부 (음수 prior + likely 격상
        # 시 모순된 reason 이 보이던 버그 — '카테고리(시장) 자체 주차 없음/제한' 이
        # likely 카드에 따라붙던 문제)
        prior_note = (
            f" 카테고리 prior: {prior_reason}." if prior_reason and prior_score > 0 else ""
        )
        # 카테고리가 명백히 자체 주차 부재 시그널이면 (시장/거리/종교 -25 이하)
        # web evidence 만으로 likely 까지 격상하지 않고 uncertain 으로 캡.
        cap_at_uncertain = prior_score <= -25
        # 격상/하향 결정 (combined score 기준)
        if used_score >= THRESHOLD_LIKELY and not cap_at_uncertain:
            final_status = "likely"
            final_confidence = max(final_confidence, min(95, 55 + used_score // 5))
            final_reason = (
                "웹 검색/카테고리 근거로 매장 자체 주차 가능성이 높게 추정됩니다. "
                "실시간/현장 상황은 확인이 필요합니다." + prior_note
            )
        elif cap_at_uncertain and used_score >= THRESHOLD_UNCERTAIN:
            final_status = "uncertain"
            final_confidence = max(final_confidence, 45)
            final_reason = (
                "웹 검색에서 일부 긍정 신호가 있지만 카테고리상 "
                f"({(prior_reason or '').split('—')[0].strip() or '해당 카테고리'}) "
                "매장 자체 주차장은 보통 없거나 매우 제한적입니다. "
                "인근 추천 주차장을 우선 검토하세요."
            )
        elif used_score >= THRESHOLD_UNCERTAIN:
            final_status = "uncertain"
            final_confidence = max(final_confidence, 35)
            final_reason = (
                "주차 관련 약한 긍정 신호가 확인됩니다. "
                "정확한 가능 여부는 매장 확인이 필요합니다." + prior_note
            )
        elif used_score <= -THRESHOLD_LIKELY:
            final_status = "unavailable"
            final_confidence = max(final_confidence, 60)
            final_reason = (
                "웹 검색/카테고리 근거로 인근 주차장 이용 안내가 일관되게 확인됩니다. "
                "매장 자체 주차장은 없거나 매우 제한적인 것으로 보입니다. "
                "아래 추천된 외부 주차장 후보를 확인해 주세요." + prior_note
            )
        elif used_score <= -THRESHOLD_UNCERTAIN:
            final_status = "uncertain"
            final_confidence = max(final_confidence, 30)
            final_reason = (
                "주차 관련 약한 부정 신호가 확인됩니다. "
                "매장 자체 주차 가능 여부는 방문 전 확인이 필요합니다." + prior_note
            )

    label_map = {
        "available": "자체 주차 가능 (DB 매칭)",
        "likely": "자체 주차 가능성 높음 (웹 근거)",
        "uncertain": "자체 주차 가능성 불확실",
        "unavailable": "자체 주차 어려움",
        "unknown": "자체 주차 정보 부족",
    }

    warning = _DEFAULT_WARNING if final_status in ("likely", "uncertain", "available") else None

    # LLM 자연어 요약 (ANTHROPIC_API_KEY 있을 때만, evidence 1건 이상)
    summary_natural = llm_summary.summarize(dest_name, evidences) if evidences else None

    return SelfParking(
        status=final_status,  # type: ignore[arg-type]
        confidence=int(final_confidence),
        label=label_map.get(final_status),
        reason=final_reason,
        summary_natural=summary_natural,
        matched_lot_id=matched_lot_id,
        evidence=evidences,
        warning=warning,
    )
