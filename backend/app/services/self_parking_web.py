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
from . import web_parking_search

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
    "매장 앞 주차": 30,
    "매장앞 주차": 30,
    "바로앞 주차": 30,
    "지하 주차장": 25,
    "지하주차장": 25,
    "옥상 주차": 20,
    # 중간
    "무료 주차": 25,
    "무료주차": 25,
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

NEGATIVE_KEYWORDS: dict[str, int] = {
    # 명확한 자체 부재 시그널
    "주차 불가": -50,
    "주차불가": -50,
    "주차장 없음": -45,
    "주차장이 없": -40,
    "주차 안 됨": -35,
    "주차안됨": -35,
    "주차 어려": -30,
    "주차 힘들": -30,
    "주차 힘듦": -30,
    # 인근 ~ 이용 = 자체 X (사용자 요구)
    "인근 공영주차장 이용": -45,
    "인근 공영주차장": -35,
    "근처 공영주차장 이용": -45,
    "근처 공영주차장": -35,
    "주변 공영주차장": -30,
    "인근 민영주차장": -35,
    "인근 유료주차장": -30,
    "인근 주차장 이용": -40,
    "근처 주차장 이용": -40,
    # 외부 주차장 추천 표현
    "공영주차장 추천": -40,
    "주차장 추천": -25,
    "주차장 이용 권장": -35,
    # 정량적인 외부 주차 안내 (예: "1시간 1,000원 할인" 같이 인근 제휴)
    "공영 이용": -25,
    "민영 이용": -25,
}

# 'likely' / 'uncertain' 격상 임계
THRESHOLD_LIKELY = 55
THRESHOLD_UNCERTAIN = 25


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

    같은 텍스트에 negative 시그널이 있으면 positive 의 기여를 절반으로 깎는다.
    (예: "인근 공영주차장 이용 가능 ... 건물에도 주차 가능" 같이 인근 안내
    문맥이 있으면 '주차 가능' 같은 약한 positive 는 자체 주차 근거로 보기 어려움.)
    """
    if not text:
        return 0, []
    pos_score = 0
    neg_score = 0
    matched: list[str] = []
    t = text.lower()
    for kw, weight in POSITIVE_KEYWORDS.items():
        if kw.lower() in t:
            pos_score += weight
            matched.append(kw)
    for kw, weight in NEGATIVE_KEYWORDS.items():
        if kw.lower() in t:
            neg_score += weight  # weight is negative
            matched.append(kw)

    if neg_score <= -25 and pos_score > 0:
        # 인근 안내가 동반된 경우 positive 는 절반만 인정
        pos_score = pos_score // 2

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
    if not web_parking_search.is_enabled():
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
) -> SelfParking:
    """estimate_self_parking() 의 dict 결과에 웹 evidence 를 합쳐 SelfParking 으로 반환.

    base 가 이미 'available' (DB 부설주차장 강매칭) 이면 evidence 만 첨부하고
    status/confidence 는 유지한다. base 가 'unknown'/'uncertain' 일 때만 격상 후보.
    """
    base_status: str = base.get("status") or "unknown"
    base_confidence: int = int(base.get("confidence") or 0)
    base_reason: str | None = base.get("reason")
    matched_lot_id = base.get("matched_lot_id")

    web_score, evidences = collect_web_self_parking_evidence(dest_name, dest_addr)

    final_status: str = base_status
    final_confidence = base_confidence
    final_reason = base_reason

    if base_status not in ("available", "unavailable") and evidences:
        # 격상/하향 결정
        if web_score >= THRESHOLD_LIKELY:
            final_status = "likely"
            final_confidence = max(final_confidence, min(95, 60 + web_score // 5))
            final_reason = (
                "웹 검색 결과에서 매장 자체 주차 가능 정보가 확인되었습니다. "
                "실시간/현장 상황은 확인이 필요합니다."
            )
        elif web_score >= THRESHOLD_UNCERTAIN:
            final_status = "uncertain"
            final_confidence = max(final_confidence, 35)
            final_reason = (
                "웹 검색에서 주차 관련 단편 정보가 일부 확인되었습니다. "
                "정확한 가능 여부는 매장 확인이 필요합니다."
            )
        elif web_score <= -THRESHOLD_LIKELY:
            final_status = "unavailable"
            final_confidence = max(final_confidence, 60)
            # 인근 공영/민영 안내가 강하게 등장한 경우. '주차 못 한다' 가 아니라
            # '매장 자체 주차는 없고 인근 이용 안내가 일관' 임을 명확히.
            final_reason = (
                "웹 검색에서 인근 공영/민영 주차장 이용 안내가 일관되게 확인되었습니다. "
                "매장 자체 주차장은 없거나 매우 제한적인 것으로 보입니다. "
                "아래 추천된 외부 주차장 후보를 확인해 주세요."
            )
        elif web_score <= -THRESHOLD_UNCERTAIN:
            final_status = "uncertain"
            final_confidence = max(final_confidence, 30)
            final_reason = (
                "웹 검색에서 인근 주차장 이용 안내가 일부 등장합니다. "
                "매장 자체 주차 가능 여부는 방문 전 확인이 필요합니다."
            )

    label_map = {
        "available": "자체 주차 가능 (DB 매칭)",
        "likely": "자체 주차 가능성 높음 (웹 근거)",
        "uncertain": "자체 주차 가능성 불확실",
        "unavailable": "자체 주차 어려움",
        "unknown": "자체 주차 정보 부족",
    }

    warning = _DEFAULT_WARNING if final_status in ("likely", "uncertain", "available") else None

    return SelfParking(
        status=final_status,  # type: ignore[arg-type]
        confidence=int(final_confidence),
        label=label_map.get(final_status),
        reason=final_reason,
        matched_lot_id=matched_lot_id,
        evidence=evidences,
        warning=warning,
    )
