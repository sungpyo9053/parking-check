"""현위치 + 카테고리(cafe/food/sights) 기반 '핫한' 매장 추천.

여러 외부 신호를 합쳐 매장별 hot_score 를 산출:
  - YouTube Data API v3 — 영상 제목/설명에 매장명 등장 + 조회수 가중 (강한 신호)
  - Naver 블로그/카페 — 글 본문에 매장명 등장 빈도 (한국 후기 강함)
  - Tavily 웹검색 — 인스타 추천/핫플 글 안에 매장명 등장 (보조)
  - 거리 + 카테고리 보너스

인스타 Graph API 는 비즈니스 계정 + 페북 앱 심사가 필요하고 매장명 해시태그
검색이 불가능해 사용하지 않는다.

점수식:
  hot_score = youtube_score * 40         # log10(views+1) 합산
            + naver_mentions * 15
            + tavily_mentions * 10
            + distance_score(0~25)
            + cat_bonus(5)

비용 보호:
  - in-memory TTL 캐시 30분
  - YouTube 카테고리당 1 search (100 unit) + 1 videos batch (1 unit) ≈ 101 unit/일
  - Naver 카테고리당 2 쿼리 × 2 endpoint = 4 호출 (일 25,000 한도 무위협)
  - Tavily 카테고리당 최대 2회
  - 좌표는 round(3) 해서 캐시 키 공유
"""
from __future__ import annotations

import logging
import math
import re
from typing import Literal

import httpx

from ..config import get_settings
from ..utils.cache import TTLCache
from ..utils.geo import haversine_m, walk_minutes_straight
from . import congestion as congestion_svc
from . import kakao as kakao_svc
from . import naver_search, youtube_search

logger = logging.getLogger(__name__)

Category = Literal["cafe", "food", "sights"]

# 카테고리별 카카오 keyword + 한국어 라벨
_KAKAO_QUERY = {
    "cafe": "카페",
    "food": "맛집",
    "sights": "가볼만한곳",
}
_CATEGORY_LABEL = {
    "cafe": "카페",
    "food": "맛집",
    "sights": "가볼곳",
}
# 카카오 category_group_code (선택적 필터)
_CATEGORY_CODE = {
    "cafe": "CE7",  # 카페
    "food": "FD6",  # 음식점
    "sights": "AT4",  # 관광명소
}

# 비용 보호 설정
_CACHE: TTLCache[tuple, list[dict]] = TTLCache(max_size=512, ttl_seconds=30 * 60)
_KAKAO_SIZE = 15
_TAVILY_MAX_QUERIES = 2
_TAVILY_TIMEOUT = 8.0
TAVILY_URL = "https://api.tavily.com/search"

# "인스타 회자" 후보에서 제외할 체인 brand — 카카오 거리순 결과를 채워서
# 진짜 인스타에서 회자되는 인디 매장이 밀리는 문제 방지.
# 음식점은 일부 체인 (예: 본죽) 그대로 두고 카페만 강하게 제외.
_CHAIN_KEYWORDS = {
    "cafe": {
        "스타벅스",
        "컴포즈커피",
        "메가커피",
        "메가mgc",
        "이디야",
        "투썸플레이스",
        "투썸",
        "빽다방",
        "할리스",
        "파스쿠찌",
        "엔젤리너스",
        "커피빈",
        "탐앤탐스",
        "폴바셋",
        "더벤티",
        "매머드커피",
        "커피에반하다",
        "공차",
        "쥬씨",
        "카페베네",
        "더본커피",
        "백다방",
        "더리터",
        "매가커피",
    },
    "food": set(),
    "sights": set(),
}

# 검색 결과(블로그/유튜브 본문)에서 매장명 후보를 자동 추출하는 패턴.
# 해시태그(#성수옹근달 → 옹근달) / 따옴표 안 단어 / "{이름} 카페" 패턴.
_HASHTAG_RE = re.compile(r"#([가-힣A-Za-z0-9]{2,18})")
_QUOTED_RE = re.compile(r"['\"‘’“”]([가-힣A-Za-z0-9 ]{2,15})['\"‘’“”]")
_NAME_BEFORE_CAFE_RE = re.compile(r"([가-힣A-Za-z0-9]{2,12})\s*(?:카페|베이커리|로스터스|로스터리)")


def _tavily_search(query: str, api_key: str, max_results: int = 10) -> list[dict]:
    body = {
        "query": query,
        "search_depth": "basic",
        "max_results": max_results,
        "include_answer": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=_TAVILY_TIMEOUT) as c:
            r = c.post(TAVILY_URL, headers=headers, json=body)
    except httpx.HTTPError as e:
        logger.warning("discover tavily HTTPError: %s", e)
        return []
    if r.status_code != 200:
        logger.warning("discover tavily status=%s body=%s", r.status_code, r.text[:150])
        return []
    return r.json().get("results") or []


_NORM_RE = re.compile(r"[\s\-_·()\[\]/\\,]+")
# 매장명에서 가지점·매장 suffix 만 잘라내고 핵심 단어를 보존
_BRANCH_SUFFIX_RE = re.compile(r"(점|지점|매장|본점|역점|분점)$")
_TOKEN_SPLIT_RE = re.compile(r"[\s\-/&·()\[\]_,\\]+")
# 토큰 자체로 의미없는 단어
_STOP_TOKENS = {"점", "지점", "매장", "동", "역", "카페", "음식점", "the"}


def _norm(s: str) -> str:
    return _NORM_RE.sub("", (s or "")).lower()


def _name_tokens(name: str) -> list[str]:
    """매장명을 핵심 토큰 리스트로 분해.

    "스타벅스 성수점" → ["스타벅스", "성수"]
    "에낭 성수점"   → ["에낭",   "성수"]
    "더홈"          → ["더홈"]

    가지점 suffix 떼고, 2글자 미만 / stop tokens 제거.
    매칭 시 모든 토큰이 텍스트(정규화) 안에 등장해야 hit.
    """
    if not name:
        return []
    raw = _TOKEN_SPLIT_RE.split(name)
    out: list[str] = []
    for p in raw:
        if not p:
            continue
        # 가지점 suffix 제거
        p = _BRANCH_SUFFIX_RE.sub("", p)
        p_lower = p.lower()
        if len(p_lower) < 2 or p_lower in _STOP_TOKENS:
            continue
        out.append(p_lower)
    # dedup, 순서 유지
    seen: set[str] = set()
    uniq: list[str] = []
    for t in out:
        if t in seen:
            continue
        seen.add(t)
        uniq.append(t)
    return uniq


def _all_tokens_in_text(tokens: list[str], normalized_text: str) -> bool:
    if not tokens or not normalized_text:
        return False
    return all(t in normalized_text for t in tokens)


def _youtube_score(items: list[dict], name: str) -> tuple[float, int, int]:
    """매장 이름의 모든 핵심 토큰이 들어있는 YouTube 영상들의 log10(views+1) 합산.

    Returns (score, matched_video_count, total_views).
    매칭 룰: 토큰 단위 (브랜드 + 지역 등 모두 등장 필요).
    """
    tokens = _name_tokens(name)
    if not tokens:
        return 0.0, 0, 0
    score = 0.0
    matched = 0
    total_views = 0
    for it in items:
        text_norm = _norm(it.get("text") or "")
        if _all_tokens_in_text(tokens, text_norm):
            matched += 1
            views = int(it.get("view_count") or 0)
            total_views += views
            score += math.log10(max(views, 0) + 1)
    return round(score, 2), matched, total_views


def _count_mentions(snippets: list[str], name: str) -> int:
    """토큰 매칭으로 snippet 내 매장 언급 카운트."""
    tokens = _name_tokens(name)
    if not tokens:
        return 0
    cnt = 0
    for s in snippets:
        if _all_tokens_in_text(tokens, _norm(s)):
            cnt += 1
    return cnt


# 추출된 매장명에서 걸러야 할 일반 단어 (지역/카테고리/형용사/일반해시태그)
_NER_STOP_WORDS = {
    # 일반 단어
    "추천", "맛집", "핫플", "카페", "디저트", "베이커리", "브런치",
    "분위기", "감성", "예쁜", "주차", "후기", "데이트", "성지", "올해",
    "최고", "오늘", "여기", "거기", "근처", "주변", "이번", "다녀온",
    "방문", "강추", "비추", "신상", "최신", "이번주", "이번달",
    "샵", "shop", "리뷰", "review", "vlog", "tour", "투어",
    # 일반 해시태그
    "카페추천", "맛집추천", "핫플레이스", "카페투어", "맛집투어",
    "인스타감성", "인스타감성카페", "인스타카페", "감성카페",
    "브런치카페", "디저트카페", "베이커리카페", "분위기좋은카페",
    "브이로그", "vlog", "shorts", "쇼츠", "유튜브", "youtube",
    "데일리", "일상", "오오티디", "오오티디룩", "ootd",
    "주말", "휴일", "공휴일", "여행",
}

# Kakao category 에서 진짜 카페가 아닌 sub-category (제외 대상)
_CAFE_SUBCAT_EXCLUDE = ("키즈카페", "스터디카페", "북카페", "보드게임카페", "pc방")


def _extract_candidate_names(
    youtube_items: list[dict],
    naver_snippets: list[str],
    tavily_snippets: list[str],
    region_label: str,
) -> list[tuple[str, int]]:
    """블로그/유튜브 본문에서 매장명 후보를 자동 추출.

    신호:
      - 해시태그 `#성수옹근달` → "성수옹근달", "옹근달" (2배 가중)
      - 따옴표 `'옹근달'` 안 단어 (1.5배)
      - "{이름} 카페" / "{이름} 베이커리" / "{이름} 로스터스" 패턴 (1배)

    노이즈 제거:
      - 일반 단어 (추천/맛집/카페 등)
      - 지역 이름 자체 (성수, 성수동)
      - 2자 미만
    """
    from collections import Counter

    parts: list[str] = []
    for it in youtube_items:
        parts.append(it.get("text") or "")
    parts.extend(naver_snippets)
    parts.extend(tavily_snippets)
    combined = "\n".join(parts)

    cands: Counter[str] = Counter()
    for m in _HASHTAG_RE.finditer(combined):
        tag = m.group(1).strip()
        if tag:
            cands[tag] += 2
    for m in _QUOTED_RE.finditer(combined):
        n = m.group(1).strip()
        if n:
            cands[n] += 1
    for m in _NAME_BEFORE_CAFE_RE.finditer(combined):
        n = m.group(1).strip()
        if n:
            cands[n] += 1

    region_norm = _norm(region_label or "")
    # region label 의 핵심 토큰 (e.g. "성수동" → "성수")
    region_core = re.sub(r"동$", "", region_norm) if region_norm else ""

    out: list[tuple[str, int]] = []
    for name, freq in cands.most_common(30):
        nl = name.lower().strip()
        if len(nl) < 2:
            continue
        if nl in _NER_STOP_WORDS:
            continue
        # 지역명 자체 또는 "성수동" / "성수동카페" 류 제외
        if region_norm and (nl == region_norm or nl == region_core):
            continue
        if region_core and nl.startswith(region_core) and len(nl) <= len(region_core) + 4:
            # "성수카페" / "성수동카페" 류 — 지역+카테고리 합성
            continue
        # 일반 합성어 — "{지역}카페추천" / "이색카페" / "신상카페" 등 generic
        if any(
            suffix in nl
            for suffix in (
                "카페추천", "맛집추천", "카페투어", "맛집투어", "감성카페",
                "이색카페", "신상카페", "감성맛집", "브이로그",
            )
        ):
            continue
        # "{prefix}카페" 인데 prefix 가 2자 이하 → 일반 합성어 가능성 ("새카페", "큰카페")
        if nl.endswith("카페") and len(nl) <= 5:
            continue
        # 영문 일반 hashtag (vlog, ootd 등 — _NER_STOP_WORDS 에 있지만 대소문자 변형 방어)
        if nl.isascii() and len(nl) <= 8:
            continue
        out.append((name, freq))
        if len(out) >= 10:
            break
    return out


def _lookup_kakao_for_names(
    names: list[tuple[str, int]],
    region_label: str,
    lat: float,
    lng: float,
    radius_m: int,
    cat_code: str | None,
) -> list[dict]:
    """추출된 매장명 후보들을 Kakao keyword search 로 검증해서 docs 형태로 반환.

    - 지역명 같이 붙여서 검색 (정확도↑)
    - radius * 1.5 까지만 허용 (인근 도보권 확장)
    - cat_code 가 있으면 카테고리 일치만 채택
    """
    extras: list[dict] = []
    for name, _freq in names:
        q = f"{name} {region_label}".strip() if region_label else name
        try:
            results = kakao_svc.search_keyword(q, size=2)
        except kakao_svc.KakaoAPIError:
            continue
        for doc in results:
            try:
                dlat = float(doc["y"])
                dlng = float(doc["x"])
            except (KeyError, ValueError):
                continue
            dist = haversine_m(lat, lng, dlat, dlng)
            if dist > radius_m * 1.5:
                continue
            if cat_code and cat_code not in (doc.get("category_group_code") or ""):
                continue
            # cafe 카테고리에서 키즈카페/스터디카페 등 sub-category 는 제외 — 인스타 핫플로는 부적합
            if cat_code == "CE7":
                cat_name = (doc.get("category_name") or "").lower()
                if any(x in cat_name for x in _CAFE_SUBCAT_EXCLUDE):
                    continue
            extras.append(doc)
            break  # 후보당 1건만
    return extras


def _filter_out_chains(docs: list[dict], category: Category) -> list[dict]:
    """카테고리별 체인 brand 매장 제거 — 인스타 회자 인디 매장 노출 우대."""
    chains = _CHAIN_KEYWORDS.get(category, set())
    if not chains:
        return docs
    out = []
    for d in docs:
        name = (d.get("place_name") or "").lower()
        name_norm = _norm(name)
        if any(c in name_norm for c in chains):
            continue
        out.append(d)
    return out


def discover_hot_places(
    lat: float, lng: float, category: Category, limit: int = 3, radius_m: int = 1500
) -> list[dict]:
    """카테고리에 맞는 인스타 추정 핫플 top N.

    캐시 히트면 즉시 반환 (Tavily 비용 0).
    """
    cache_key = (round(lat, 3), round(lng, 3), category, limit, radius_m)
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return cached

    settings = get_settings()
    kakao_q = _KAKAO_QUERY.get(category, "맛집")
    cat_code = _CATEGORY_CODE.get(category)

    # 1) 카카오 후보 (좌표 기반 keyword search) — radius 안에서 정확도순
    try:
        docs = kakao_svc.search_keyword_near(
            kakao_q, lat=lat, lng=lng, radius_m=radius_m, size=_KAKAO_SIZE
        )
    except kakao_svc.KakaoAPIError as e:
        logger.warning("discover kakao failed: %s", e)
        docs = []

    if cat_code:
        docs = [d for d in docs if cat_code in (d.get("category_group_code") or "")]

    # 체인 brand 제거 — 인스타 회자 인디 매장 우대
    docs = _filter_out_chains(docs, category)

    if not docs:
        _CACHE.set(cache_key, [])
        return []

    # 2) 지역명 추출 (외부 검색 쿼리에 사용)
    region_doc = None
    try:
        region_doc = kakao_svc.reverse_geocode_region(lat, lng)
    except Exception as e:  # noqa: BLE001
        logger.warning("discover reverse geocode failed: %s", e)
    # region_3depth_name 이 "성수2가3동" 처럼 좁게 잡히면 "성수동" 으로 다듬는다.
    # 검색 결과가 0건이 되는 사례 다수 — "N가M동" / "N가" 접미사를 제거하고
    # 마지막 "동" 단위만 남긴다.
    raw_3 = (region_doc or {}).get("region_3depth_name") or ""
    raw_2 = (region_doc or {}).get("region_2depth_name") or ""
    cleaned_3 = re.sub(r"\d+가\d*동$", "동", raw_3)  # "성수2가3동" → "성수동"
    cleaned_3 = re.sub(r"\d+동$", "동", cleaned_3)  # "역삼1동" → "역삼동"
    region_label = cleaned_3 or raw_3 or raw_2

    # 3) 외부 신호 수집 — 조건에 맞는 API 만 호출
    tavily_snippets: list[str] = []
    naver_snippets: list[str] = []
    youtube_items: list[dict] = []  # {title, content, view_count}

    if region_label:
        cat_label = _CATEGORY_LABEL[category]
        queries: list[str] = [
            f"{region_label} {cat_label} 인스타 추천",
            f"{region_label} {cat_label} 핫플",
        ]

        # YouTube — 조회수 가중치 (가장 객관적인 신호)
        if youtube_search.is_enabled():
            try:
                yt = youtube_search.search(queries[:1])  # 카테고리당 1 쿼리만 (100 unit)
                for it in yt:
                    youtube_items.append(
                        {
                            "text": f"{it.get('title') or ''} {it.get('content') or ''}",
                            "view_count": int(it.get("view_count") or 0),
                        }
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning("discover youtube failed: %s", e)

        # Naver 블로그/카페 — 한국 후기 강함
        if naver_search.is_enabled():
            try:
                nv = naver_search.search(queries, display=8)
                for r in nv:
                    naver_snippets.append(f"{r.get('title') or ''} {r.get('content') or ''}")
            except Exception as e:  # noqa: BLE001
                logger.warning("discover naver failed: %s", e)

        # Tavily — 기존 보조 신호 (Tavily 가 꺼져있으면 skip)
        if settings.WEB_SEARCH_ENABLED and settings.TAVILY_API_KEY:
            for q in queries[:_TAVILY_MAX_QUERIES]:
                results = _tavily_search(q, settings.TAVILY_API_KEY, max_results=8)
                for r in results:
                    if not isinstance(r, dict):
                        continue
                    tavily_snippets.append(f"{r.get('title') or ''} {r.get('content') or ''}")

    # 3.5) 검색 결과에서 매장명 자동 추출 → 카카오 lookup → docs pool 보강.
    #      카카오는 거리순 체인 위주를 주는데, 실제 인스타 회자 매장은 인디.
    #      해시태그 #성수옹근달 / "옹근달" / "옹근달 카페" 같은 패턴에서 매장명 추출.
    extra_docs: list[dict] = []
    if region_label:
        try:
            extracted = _extract_candidate_names(
                youtube_items, naver_snippets, tavily_snippets, region_label
            )
            if extracted:
                extra_docs = _lookup_kakao_for_names(
                    extracted, region_label, lat, lng, radius_m, cat_code
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("discover NER failed: %s", e)

    # 추출된 인디 매장을 docs 앞에 두고 (정렬 시 점수 가산 받음) dedup
    if extra_docs:
        seen_names = {_norm(d.get("place_name") or "") for d in docs}
        for d in extra_docs:
            n = _norm(d.get("place_name") or "")
            if n and n not in seen_names:
                seen_names.add(n)
                docs.append(d)
        # 추가된 매장도 체인 필터 1회 더 (Kakao lookup 결과에 체인이 섞일 수 있음)
        docs = _filter_out_chains(docs, category)

    # 4) 점수 산정
    scored: list[dict] = []
    for d in docs:
        try:
            dlat = float(d["y"])
            dlng = float(d["x"])
        except (KeyError, ValueError):
            continue
        dist = int(haversine_m(lat, lng, dlat, dlng))
        if dist > radius_m:
            continue

        name = d.get("place_name") or ""
        yt_score, yt_video_count, yt_total_views = _youtube_score(youtube_items, name)
        naver_mentions = _count_mentions(naver_snippets, name)
        tavily_mentions = _count_mentions(tavily_snippets, name)
        dist_score = max(0, 25.0 * (1 - min(dist, radius_m) / radius_m))
        cat_bonus = 5 if cat_code and cat_code in (d.get("category_group_code") or "") else 0

        score = (
            yt_score * 40
            + naver_mentions * 15
            + tavily_mentions * 10
            + dist_score
            + cat_bonus
        )
        cat_name = d.get("category_name") or ""
        congestion = congestion_svc.predict(
            cat_name or d.get("category_group_code")
        ).to_dict()
        scored.append(
            {
                "name": name,
                "category": cat_name or None,
                "category_group_code": d.get("category_group_code"),
                "phone": d.get("phone") or None,
                "address": d.get("address_name"),
                "road_address": d.get("road_address_name"),
                "lat": dlat,
                "lng": dlng,
                "distance_m": dist,
                "walking_minutes": walk_minutes_straight(dist),
                "place_url": d.get("place_url"),
                "hot_score": round(score, 1),
                "youtube_video_count": yt_video_count,
                "youtube_total_views": yt_total_views,
                "naver_mentions": naver_mentions,
                "tavily_mentions": tavily_mentions,
                "region_label": region_label or None,
                "congestion": congestion,
            }
        )

    scored.sort(key=lambda x: (-x["hot_score"], x["distance_m"]))
    top = scored[: max(1, min(5, limit))]
    _CACHE.set(cache_key, top)
    return top


def cache_stats() -> dict:
    return _CACHE.stats()
