"""웹 후기에서 식당/카페의 시그니처/추천 메뉴 추출.

LLM 미사용 (Anthropic credit 0). Naver 블로그/카페 검색 + 휴리스틱 regex.

규칙:
1. POI 카테고리에 '음식점' / '카페' 등 식음료 힌트 → 활성, 그 외 → 빈 결과
2. Naver 검색: "{POI명} 시그니처 메뉴" / "{POI명} 추천 메뉴" / "{POI명} 맛있는"
3. 후기 텍스트에서 메뉴 후보 추출
   - 헤드라인 패턴 ("시그니처는 X", "대표 메뉴 X") +3
   - 컨텍스트 패턴 ("X 맛있", "X 주문", "X 시켰") +1
4. POI명/불용어 필터
5. 빈도 ≥ 2 인 상위 5개 반환

캐시 6h (in-memory).
"""
from __future__ import annotations

import re
import time
from collections import Counter

from . import naver_search

_CACHE: dict[str, tuple[float, list[dict]]] = {}
_TTL_SEC = 6 * 3600

_FOOD_CATEGORY_HINTS = (
    "음식점",
    "카페",
    "디저트",
    "베이커리",
    "주점",
    "레스토랑",
    "분식",
    "패스트푸드",
    "술집",
    "와인바",
)

# 메뉴로 오인되기 쉬운 일반 단어
_STOPWORDS = {
    "메뉴", "주차", "주문", "맛집", "후기", "리뷰", "방문", "오늘", "어제",
    "친구", "사장", "사장님", "주차장", "가게", "매장", "건물", "지하",
    "옥상", "공영", "공간", "추천", "시그니처", "베스트", "대표", "이용",
    "있음", "없음", "가능", "주차가능", "사용", "이번", "다음", "다른",
    "처음", "여기", "거기", "저희", "사람", "이곳", "그곳", "오빠", "언니",
    "엄마", "아빠", "동생", "선배", "후배", "직원", "기본", "구성", "조합",
    "위치", "분위기", "느낌", "느낌이", "느낌은", "사진", "가격", "양은",
    "맛집은", "매장은", "정말", "진짜", "역시", "추천드",
    "주문해", "주문한", "맛있게", "맛있는", "맛있어",
    # 빈출 부사/형용사/접속어 (실 데이터에서 잡힌 노이즈)
    "너무", "이유", "제공", "놀랍게", "꼽히", "관련", "정도", "처럼",
    "라고", "라는", "라며", "라요", "다양", "다양한", "여러", "조금",
    "엄청", "역시나", "물론", "특히", "보통", "조차", "한번", "이런",
    "그런", "저런", "그리고", "그래서", "그래도", "하지만", "또한",
    "운영", "영업", "전화", "주소", "도착", "예약", "할인", "쿠폰",
}

# 토큰 prefix 가 이걸로 시작하면 무조건 메뉴 X
# (예: "메뉴는/메뉴인/메뉴들/메뉴도/메뉴죠" → 모두 "메뉴" prefix 로 일괄 차단)
_BAD_PREFIX = ("메뉴", "주차", "운영", "영업", "위치", "전화", "주소")

# 헤드라인: "시그니처/대표/베스트/추천 메뉴(는|은|인) X"
# group(1) 은 단일 어절 (공백 없음, 2~11자). 다중 어절 메뉴는 컨텍스트 패턴으로 흡수.
_HEADLINE_RE = re.compile(
    r"(?:시그니처(?:\s*메뉴)?|대표\s*메뉴|베스트(?:\s*메뉴)?|추천\s*메뉴)"
    r"\s*(?:는|은|로(?:는)?|로서|:|=|인)?\s*"
    r"['\"「『]?\s*([가-힣A-Za-z][가-힣A-Za-z0-9]{1,10})\s*['\"」』]?"
    r"\s*(?:이에요|예요|입니다|이고|이며|이라|이라고|이라는|등|\.|,|!|\?|<|>|\(|\)|/|·|\n|을|를|이|가|은|는|와|과|랑|도)"
)

# 컨텍스트: "X 맛있", "X 주문", "X 시켰" 등
_CONTEXT_RE = re.compile(
    r"([가-힣A-Za-z][가-힣A-Za-z0-9]{1,10})"
    r"\s*(?:이|가|을|를|은|는|도|랑|와|과)?\s*"
    r"(?:맛있|주문(?:했|함|하니)|시켰|시킴|먹었|먹어\s*보|먹어\s*봤|골랐|선택했)"
)

# 토큰 끝이 동사/조사 어미면 메뉴가 아닐 가능성 ↑
_BAD_SUFFIX_RE = re.compile(
    r"(어요|예요|이에요|거래요|네요|데요|려요|구요|시켰|시키|시켜|보았|보면|보니|"
    r"보겠|겠습니다|습니다|입니다|이라|이라고|이라는|드세요|드려요|좋아요|싫어요|"
    r"하면|하니|하고|이고|이며|되어|되는|같은|같아|같다|이라는|라는|라며|라고|"
    r"으로|로요|는요|네용|는데|는지|에서|에게|에도|에는|이라며|로서|로써|마저|"
    r"마치|마저|에서는|에서도|들과|들이|들도|들은|들을|들의|것이|것을|것은|"
    r"것도|것의|만의|만큼|보다|부터|까지|하는|되는|이라는|이라며|이라고|"
    r"이라서|이라면|이라도|이라네|이라니|이라기|에다가|일까|일까요|일지|"
    r"인지|이라거나|라거나)$"
)

_WS_RE = re.compile(r"\s+")
_NORM_RE = re.compile(r"[\s\-_·,()/\\\[\]]+")


def _norm_token(s: str) -> str:
    return _WS_RE.sub(" ", s).strip()


def _norm_compact(s: str) -> str:
    return _NORM_RE.sub("", s or "").lower()


def is_food_place(category: str | None) -> bool:
    if not category:
        return False
    return any(h in category for h in _FOOD_CATEGORY_HINTS)


def _looks_like_menu(token: str, poi_norm: str) -> bool:
    t = _norm_token(token)
    if not t or len(t) < 2 or len(t) > 18:
        return False
    if t in _STOPWORDS:
        return False
    tc = _norm_compact(t)
    if not tc or tc == poi_norm or tc in poi_norm or (len(poi_norm) >= 3 and poi_norm in tc):
        return False
    if t.isdigit():
        return False
    if _BAD_SUFFIX_RE.search(t):
        return False
    if any(t.startswith(p) for p in _BAD_PREFIX):
        return False
    # 토큰에 공백이 끼면 multi-word — 보통 동사구. 단일 어절만 메뉴로 인정.
    if " " in t:
        return False
    return True


def extract_menus(poi_name: str | None, category: str | None) -> list[dict]:
    """식당/카페면 메뉴 후보 추출. 아니면 빈 리스트.

    반환: [{"name": str, "mentions": int, "evidence": str}]
    """
    if not poi_name or not is_food_place(category):
        return []

    key = f"{poi_name}|{category or ''}"
    now = time.time()
    cached = _CACHE.get(key)
    if cached and (now - cached[0] < _TTL_SEC):
        return cached[1]

    if not naver_search.is_enabled():
        return []

    items = naver_search.search(
        [
            f"{poi_name} 시그니처 메뉴",
            f"{poi_name} 추천 메뉴",
            f"{poi_name} 맛있는",
        ],
        display=8,
    )
    if not items:
        _CACHE[key] = (now, [])
        return []

    text = " ".join(((it.get("title") or "") + " " + (it.get("content") or "")) for it in items)
    poi_norm = _norm_compact(poi_name)

    counter: Counter[str] = Counter()
    evidence: dict[str, str] = {}

    for m in _HEADLINE_RE.finditer(text):
        name = _norm_token(m.group(1))
        if _looks_like_menu(name, poi_norm):
            counter[name] += 3
            evidence.setdefault(name, text[max(0, m.start() - 15) : m.end() + 15].strip())

    for m in _CONTEXT_RE.finditer(text):
        name = _norm_token(m.group(1))
        if _looks_like_menu(name, poi_norm):
            counter[name] += 1
            evidence.setdefault(name, text[max(0, m.start() - 15) : m.end() + 15].strip())

    top = [(n, c) for n, c in counter.most_common(20) if c >= 2][:5]
    out = [
        {"name": n, "mentions": c, "evidence": (evidence.get(n) or "")[:80]}
        for n, c in top
    ]
    _CACHE[key] = (now, out)
    return out
