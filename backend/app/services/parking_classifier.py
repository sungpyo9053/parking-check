"""Kakao Local API 로 잡힌 '주차장' POI 의 실제 사용 가능성을 분류한다.

분류:
  - usable             : 공영/노상공영/민영 유료/공영 노외 등 일반 개방 주차장
  - caution            : 민영/건물/상가 등 일반 개방 여부 불확실
  - private_restricted : 타 매장 전용/기관(교회·사찰·아파트·학교·병원 등) 전용

판단 우선순위:
  1. 목적지명과 주차장명이 강하게 매칭되면 'usable' (목적지 자체 주차장 후보)
  2. category_name 에 '공영주차장' 포함 → usable
  3. 이름/카테고리에 private_restricted 키워드 → private_restricted
  4. 이름/카테고리에 caution 패턴 → caution
  5. 그 외 → caution (보수적)
"""
from __future__ import annotations

import re
from typing import Literal

UsabilityTier = Literal["usable", "caution", "private_restricted"]


# --- 룰 정의 ---

# private_restricted: 강한 시그널. 이름/카테고리 어디든 등장하면 제외.
# 단 (1) 목적지명과 일치하거나 (2) "공영" 이라는 단어가 함께 등장하면 무효화.
PRIVATE_RESTRICTED_KEYWORDS: tuple[str, ...] = (
    "전용주차장",
    "전용 주차장",
    "전용주차",
    "고객전용",
    "고객 전용",
    "직원전용",
    "입주민전용",
    "입주자전용",
    "교회",
    "성당",
    "사찰",
    "선원",  # 불교 선원
    "사원",
    "아파트",
    "빌라",
    "오피스텔",
    "마트 전용",
    "상가전용",
    "상가 전용",
    "병원",
    "학교",
    "초등학교",
    "중학교",
    "고등학교",
    "대학교",
    "어린이집",
    "유치원",
    "관공서 전용",
)

# 식당/카페 같은 일반 업종은 단독으로는 약한 시그널. "전용주차장" 등과 결합될 때만
# 강하게 본다.
WEAK_BRAND_HINTS: tuple[str, ...] = (
    "식당",
    "카페",
    "음식점",
    "분식",
    "치킨",
    "한식",
    "중식",
    "일식",
    "양식",
    "추어탕",
    "갈비",
    "삼겹살",
    "곱창",
)

# usable: 강한 시그널
USABLE_CATEGORY_HINTS: tuple[str, ...] = (
    "공영주차장",
    "노상공영주차장",
    "공영 노외",
    "공공주차장",
)

# 민영 일반 개방 주차장 키워드 (보통 시간당 요금으로 누구나 이용)
PAID_OPEN_HINTS: tuple[str, ...] = (
    "주차타워",
    "주차장(유료)",
    "유료주차장",
    "민영주차장",
    "공용주차장",
    "공원주차장",
    "주차빌딩",
)

# 잘 알려진 브랜드 주차 운영사 (보통 누구나 이용)
OPEN_OPERATOR_BRANDS: tuple[str, ...] = (
    "나이스파크",
    "AJ파크",
    "윌슨파킹",
    "GS파크24",
    "T맵주차",
    "카카오T주차",
    "하이파크",
    "현대오일뱅크 주차",
)


# --- helper ---

_PUNCT_RE = re.compile(r"[\s\-_·,()\[\]/\\]+")


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return _PUNCT_RE.sub("", s).lower()


def _contains_any(text: str, kws: tuple[str, ...]) -> str | None:
    for kw in kws:
        if kw in text:
            return kw
    return None


def _destination_match(name: str, destination_name: str | None) -> bool:
    """주차장명에 목적지의 브랜드 토큰이 강하게 포함되는지.

    예:
      목적지='더홈',                주차장='더홈 전용주차장'       → True
      목적지='세이브마트 신림본점',  주차장='세이브마트 주차장'     → True (브랜드 토큰 일치)
      목적지='나이스파크 어반빌리움', 주차장='나이스파크 강남'       → True

    매칭 규칙:
      1) 정규화된 destination_name 이 park_name 에 완전 포함 (기존)
      2) 또는 destination 의 토큰 중 길이 >=3 이고 일반어가 아닌 토큰 (보통 첫 토큰=브랜드)
         이 park_name 정규화된 형태에 포함
    """
    if not destination_name:
        return False
    n_norm = _norm(name)
    d_norm = _norm(destination_name)
    if not n_norm or not d_norm or len(d_norm) < 2:
        return False
    if d_norm in n_norm:
        return True

    # 토큰 단위 매칭. 한국어/영문/숫자 토큰 분리.
    import re as _re
    tokens = _re.findall(r"[가-힣A-Za-z0-9]+", destination_name)
    GENERIC = {
        "주차장", "주차", "본점", "지점", "점", "센터", "타워", "빌딩",
        "상가", "마트", "약국", "병원", "근처", "옆", "앞", "뒤", "역",
        "맞은편",
    }
    # 'X점' 형식 지점 접미사 (도곡점/강남점/신림점/안국점 등) — 단독 매칭은 FP.
    # 같은 지명의 다른 매장 주차장이 모두 selfMatch 되는 버그 (이병태/브라운핸즈/
    # 플레어비/평양면옥이 전부 '도곡점' 으로 일치 잡힘) 차단.
    _BRANCH_SUFFIX_RE = _re.compile(r"^[가-힣]{1,4}점$")
    for tok in tokens:
        if len(tok) < 3:
            continue
        if tok in GENERIC:
            continue
        if _BRANCH_SUFFIX_RE.match(tok):
            continue
        if _norm(tok) in n_norm:
            return True
    return False


def classify_kakao_parking(
    name: str | None,
    category: str | None,
    destination_name: str | None = None,
) -> tuple[UsabilityTier, list[str]]:
    """이름/카테고리 기반 분류 + 매칭 사유 반환.

    사유는 사용자에게 보여줄 짧은 한국어 문구들.
    """
    name = (name or "").strip()
    cat = (category or "").strip()
    blob = f"{name} {cat}"
    reasons: list[str] = []

    # 1) 목적지와 같은 이름이면 무조건 usable — 매장 자체 주차장 후보
    if _destination_match(name, destination_name):
        reasons.append("목적지명 일치 — 매장 자체 주차 후보")
        return "usable", reasons

    # 2) 공영주차장 / 공공
    hit = _contains_any(cat, USABLE_CATEGORY_HINTS) or _contains_any(name, USABLE_CATEGORY_HINTS)
    if hit:
        reasons.append(f"공영/공공 분류({hit})")
        return "usable", reasons

    # 3) 알려진 개방 운영사 브랜드
    hit = _contains_any(name, OPEN_OPERATOR_BRANDS)
    if hit:
        reasons.append(f"개방 운영사({hit})")
        return "usable", reasons

    # 4) private_restricted 키워드
    hit = _contains_any(blob, PRIVATE_RESTRICTED_KEYWORDS)
    if hit:
        # 단, 같은 텍스트에 "공영" 이 함께 있으면 공영 표시로 재분류
        if "공영" in blob:
            reasons.append("공영 표시 동반 — 개방 추정")
            return "usable", reasons
        # 식당/카페 브랜드 + 전용주차장 패턴은 매우 강한 private
        weak = _contains_any(blob, WEAK_BRAND_HINTS)
        if weak and ("전용" in blob):
            reasons.append(f"타 매장 전용({weak} 브랜드 + 전용주차)")
        else:
            reasons.append(f"제한 키워드({hit})")
        return "private_restricted", reasons

    # 5) 식당/카페 브랜드만 단독으로 — 보통 손님 우선 일반 출입 불가
    weak = _contains_any(name, WEAK_BRAND_HINTS)
    if weak:
        reasons.append(f"타 업종 브랜드명 포함({weak}) — 임의 이용 어려울 가능성")
        return "private_restricted", reasons

    # 6) 민영/유료 일반 개방 시그널
    hit = _contains_any(blob, PAID_OPEN_HINTS)
    if hit:
        reasons.append(f"민영/유료 일반 개방({hit})")
        return "usable", reasons

    # 7) 그 외 — 일반 '주차장' 카테고리 (구분 불가). 보수적으로 caution.
    reasons.append("일반 개방 여부 불확실")
    return "caution", reasons
