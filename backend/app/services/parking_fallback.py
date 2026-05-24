"""DB → Kakao(PK6) → Kakao(keyword) → Web Search 순으로 보조 후보를 모은다.

원칙:
- DB 후보가 충분하면 (>= MIN_DB) 폴백 호출하지 않는다.
- Kakao 결과는 카테고리(PK6) → 키워드 순으로 시도하고, 둘 다 합쳐서 dedup.
- 위 모두 합쳐도 0 이면 Web Search 폴백을 시도 (WEB_SEARCH_ENABLED 일 때만).
- 어떤 단계 결과에도 "실시간/운영 여부"를 단정하지 않는다.
- summary 는 rule-based 한 줄 — 추후 LLM 요약으로 교체할 자리.
"""
from __future__ import annotations

import logging
import math
import re

from ..schemas.parking import ExternalCandidate, FallbackInfo
from ..utils.geo import walk_minutes_straight
from . import kakao as kakao_svc
from . import web_parking_search
from .parking_classifier import classify_kakao_parking
from .walking_route import batch_compute as walking_batch_compute

_USABILITY_LABEL = {
    "usable": "추천 가능",
    "caution": "확인 필요",
    "private_restricted": "추천 제외",
}

_RESTRICTED_WARNING = (
    "타 매장/기관 전용 주차장으로 보여 추천에서 제외했습니다. "
    "방문 목적지와 무관한 전용주차장은 임의 이용이 어려울 수 있습니다."
)

_CAUTION_WARNING = (
    "사용 가능 여부 확인 필요. 유료 또는 일반 개방 주차장인지 현장/지도에서 한 번 더 확인해 주세요."
)

logger = logging.getLogger(__name__)

# DB 후보가 이 미만이면 Kakao 폴백을 합친다.
MIN_DB = 3
# Kakao 두 단계 합산이 이 미만이고 DB 도 0 이면 웹 검색 폴백 시도.
WEB_FALLBACK_THRESHOLD = 1


# --------------- helpers ---------------

_PUNCT_RE = re.compile(r"[\s\-_·,()\[\]/\\]+")


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return _PUNCT_RE.sub("", s).lower()


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return int(R * c)


def _kakao_doc_to_external(
    doc: dict,
    source: str,
    source_label: str,
    origin_lat: float,
    origin_lng: float,
    destination_name: str | None = None,
) -> ExternalCandidate | None:
    try:
        lat = float(doc["y"])
        lng = float(doc["x"])
    except (KeyError, TypeError, ValueError):
        return None
    dist = _haversine_m(origin_lat, origin_lng, lat, lng)
    name = (doc.get("place_name") or "이름 미상").strip() or "이름 미상"
    category = doc.get("category_name")

    tier, reasons = classify_kakao_parking(name, category, destination_name)

    if tier == "private_restricted":
        warning = _RESTRICTED_WARNING
    elif tier == "caution":
        warning = _CAUTION_WARNING
    else:
        warning = "지도 기반 정보입니다. 운영시간/요금은 방문 전 확인이 필요합니다."

    return ExternalCandidate(
        source=source,  # type: ignore[arg-type]
        source_label=source_label,
        name=name,
        title=doc.get("place_name"),
        url=doc.get("place_url"),
        snippet=category or doc.get("address_name"),
        distance_m=dist,
        walking_minutes=walk_minutes_straight(dist),
        lat=lat,
        lng=lng,
        address=doc.get("address_name"),
        road_address=doc.get("road_address_name"),
        category=category,
        usability=tier,  # type: ignore[arg-type]
        usability_label=_USABILITY_LABEL[tier],
        usability_reasons=reasons,
        warning=warning,
    )


# 부동산/매물/광고 등 명백히 주차장이 아닌 웹검색 결과 제외용 키워드.
# title/snippet 에 한 번이라도 등장하면 후보에서 떨어뜨림.
_WEB_NEGATIVE_KEYWORDS: tuple[str, ...] = (
    "경매", "타경", "급매", "매물", "매매", "전세", "월세", "분양",
    "아파트", "오피스텔", "빌라", "원룸", "투룸", "재개발", "재건축",
    "부동산", "공인중개사", "중개사", "시세", "호가", "평수", "전용면적",
    "맛집", "메뉴", "리뷰",  # 식당 블로그 — 자체주차 evidence 는 self_parking_web 에서 따로 처리
    "상가거리", "쇼핑몰",
    "채용", "공고", "구인",
)
# 진짜 주차장 정보일 가능성을 끌어올리는 긍정 키워드. title/snippet 중 어디에도
# 한 번도 등장하지 않으면 confidence 낮다고 보고 제외.
_WEB_POSITIVE_KEYWORDS: tuple[str, ...] = (
    "주차장", "공영주차장", "노상주차", "주차 가능", "주차 요금",
    "주차료", "유료주차", "무료주차",
)


def _is_web_result_relevant(item: dict) -> bool:
    """웹 검색 결과가 실제 '주차' 정보일 가능성이 있는지 휴리스틱 필터."""
    title = (item.get("title") or "").strip()
    snippet = (item.get("snippet") or "").strip()
    blob = f"{title} {snippet}"
    if not blob.strip():
        return False
    for neg in _WEB_NEGATIVE_KEYWORDS:
        if neg in blob:
            return False
    for pos in _WEB_POSITIVE_KEYWORDS:
        if pos in blob:
            return True
    return False


def _web_result_to_external(item: dict) -> ExternalCandidate:
    title = item.get("title") or "웹 검색 결과"
    # 웹 검색 결과는 좌표/운영 여부 검증이 안 되므로 항상 caution.
    # (기본값 usable 로 두면 부동산 매물/블로그까지 "추천 가능" 으로 표시되는 버그)
    return ExternalCandidate(
        source="web_search",
        source_label="웹 검색 기반",
        name=title,
        title=title,
        url=item.get("url"),
        snippet=item.get("snippet"),
        usability="caution",
        usability_label=_USABILITY_LABEL["caution"],
        usability_reasons=["웹 검색 결과 — 실제 주차장 여부 미검증"],
        warning="웹 검색 기반 정보입니다. 실제 주차 가능 여부는 방문 전 확인이 필요합니다.",
    )


def _dedup(existing: list[ExternalCandidate], new: list[ExternalCandidate]) -> list[ExternalCandidate]:
    """기존 DB candidates 와 외부 후보 사이의 중복도 일부 거른다.

    중복 기준:
      - URL 동일
      - 같은 좌표 (5m 이내) 추정
      - 정규화 이름 동일
      - 정규화 주소 동일
    """
    seen_urls: set[str] = {e.url for e in existing if e.url}
    seen_names: set[str] = {_norm(e.name) for e in existing if e.name}
    seen_addrs: set[str] = {_norm(e.address or e.road_address) for e in existing if (e.address or e.road_address)}
    coords: list[tuple[float, float]] = [
        (e.lat, e.lng) for e in existing if e.lat is not None and e.lng is not None
    ]

    out: list[ExternalCandidate] = []
    for c in new:
        if c.url and c.url in seen_urls:
            continue
        norm_name = _norm(c.name)
        if norm_name and norm_name in seen_names:
            continue
        addr_key = _norm(c.address or c.road_address)
        if addr_key and addr_key in seen_addrs:
            continue
        if c.lat is not None and c.lng is not None:
            too_close = any(
                _haversine_m(c.lat, c.lng, la, ln) <= 5 for la, ln in coords
            )
            if too_close:
                continue
            coords.append((c.lat, c.lng))
        if c.url:
            seen_urls.add(c.url)
        if norm_name:
            seen_names.add(norm_name)
        if addr_key:
            seen_addrs.add(addr_key)
        out.append(c)
    return out


def _build_summary(
    db_count: int,
    kakao_total: int,
    web_count: int,
    web_enabled: bool,
    web_executed: bool,
    excluded_count: int = 0,
) -> tuple[str, list[str]]:
    parts: list[str] = []
    warnings: list[str] = []

    if db_count == 0:
        parts.append("공공데이터(parking_lots) 에는 등록된 후보가 없습니다.")
    elif db_count < MIN_DB:
        parts.append(f"공공데이터 후보 {db_count}개를 찾았습니다.")
    else:
        parts.append(f"공공데이터 후보 {db_count}개를 찾았습니다.")

    if kakao_total > 0:
        if excluded_count > 0:
            parts.append(
                f"카카오 지도 검색에서 보조 후보 {kakao_total}개 — 그 중 {excluded_count}개는 "
                "타 매장/기관 전용 주차장으로 보여 추천에서 제외했습니다."
            )
        else:
            parts.append(f"카카오 지도 검색에서 보조 후보 {kakao_total}개를 추가했습니다.")
        warnings.append("카카오 지도 결과는 실시간 잔여/요금/운영 여부 정보가 없습니다.")

    if web_executed:
        if web_count > 0:
            parts.append(
                f"웹 검색에서 주차 관련 정보 {web_count}건이 확인되었습니다."
            )
            warnings.append(
                "웹 검색 결과는 운영 여부와 위치 모두 부정확할 수 있어 방문 전 확인이 필요합니다."
            )
        else:
            parts.append("웹 검색에서도 관련 정보를 찾지 못했습니다.")
    elif db_count + kakao_total == 0 and not web_enabled:
        parts.append("(웹 검색 폴백은 비활성화 상태입니다.)")

    if db_count + kakao_total + web_count == 0:
        parts.append(
            "현재 연결된 데이터 소스에서는 반경 내 주차장 후보를 찾지 못했습니다. "
            "카카오맵/현장 확인이 필요합니다."
        )
    elif db_count == 0 and kakao_total > 0 and not web_executed and not web_enabled:
        # 사용자가 가장 헷갈려하는 케이스: 주변 공영주차장은 있지만 목적지 자체
        # 주차장 여부는 모름. 웹 검색을 켜야 그 답을 받을 수 있다는 힌트.
        parts.append(
            "(목적지 자체 주차장 여부는 웹 검색 폴백을 켜야 확인됩니다 — "
            "서버 .env 의 TAVILY_API_KEY 와 WEB_SEARCH_ENABLED=true 를 설정.)"
        )

    return " ".join(parts), warnings


# --------------- main ---------------

def collect_external_candidates(
    db_count: int,
    db_existing: list[ExternalCandidate],
    *,
    destination_name: str | None,
    destination_address: str | None,
    lat: float,
    lng: float,
    radius_m: int,
    self_parking_unknown: bool = False,
) -> FallbackInfo:
    """DB 결과를 받아 외부 폴백 후보를 수집해서 FallbackInfo 로 돌려준다.

    db_existing 은 DB 후보를 외부 후보 형태로 가벼이 표현한 리스트로,
    dedup 비교에만 사용된다.

    self_parking_unknown 이 True 면 '주변에 공영주차장이 몇 개 보여도 목적지 자체
    주차 가능성을 알 수 없다' 는 뜻이라 웹 검색까지 발화시킨다 (e.g. 카페/식당/매장
    자체 주차장 정보는 보통 블로그/리뷰에만 있음).
    """
    info = FallbackInfo(
        db_count=db_count,
        web_search_enabled=web_parking_search.any_provider_enabled(),
        sources_tried=["public_db"],
    )

    external: list[ExternalCandidate] = []

    if db_count < MIN_DB:
        # Kakao PK6 (주차장 카테고리)
        try:
            pk6 = kakao_svc.search_parking_nearby(lat=lat, lng=lng, radius_m=radius_m)
        except kakao_svc.KakaoAPIError as e:
            logger.warning("kakao PK6 fallback failed: %s", e)
            pk6 = []
        info.sources_tried.append("kakao_pk6")
        pk6_ext = [
            ec
            for d in pk6
            if (ec := _kakao_doc_to_external(d, "kakao_fallback", "카카오 지도 검색 기반", lat, lng, destination_name))
            is not None
        ]
        pk6_ext = _dedup(db_existing + external, pk6_ext)
        info.kakao_pk6_count = len(pk6_ext)
        external.extend(pk6_ext)

        # 추가로 keyword 검색까지 — 좌표 기반, 목적지명 + "주차" 로 destination 자체
        # 주차 관련 entry 를 우선 찾는다. destination_name 이 없거나 결과가 적으면
        # 일반 "주차장" 으로 한 번 더 확장.
        if db_count + len(external) < MIN_DB:
            kw_docs: list[dict] = []
            queries: list[str] = []
            if destination_name:
                queries.append(f"{destination_name} 주차")
            queries.append("주차장")
            for q in queries:
                try:
                    docs = kakao_svc.search_keyword_near(
                        q, lat=lat, lng=lng, radius_m=max(radius_m, 1000), size=10
                    )
                except kakao_svc.KakaoAPIError as e:
                    logger.warning("kakao keyword fallback failed q=%r: %s", q, e)
                    docs = []
                kw_docs.extend(docs)
                if len(kw_docs) >= 10:
                    break
            info.sources_tried.append("kakao_keyword")
            kw_ext = [
                ec
                for d in kw_docs
                if (
                    ec := _kakao_doc_to_external(
                        d, "kakao_fallback", "카카오 지도 검색 기반", lat, lng, destination_name
                    )
                )
                is not None
                and (ec.distance_m or 0) <= max(radius_m * 2, 2000)
            ]
            kw_ext = _dedup(db_existing + external, kw_ext)
            info.kakao_keyword_count = len(kw_ext)
            external.extend(kw_ext)

    kakao_total = info.kakao_pk6_count + info.kakao_keyword_count

    # 웹 검색 폴백 트리거:
    #   (a) DB + Kakao 합산이 임계 미만이거나
    #   (b) 자체 주차 상태가 'unknown' (Kakao 가 PK6 로 인접 공영주차장만 잡고
    #       정작 목적지 자체 주차 정보는 없는 흔한 케이스)
    web_should_run = (
        info.web_search_enabled
        and (
            db_count + kakao_total < WEB_FALLBACK_THRESHOLD
            or self_parking_unknown
        )
    )
    if web_should_run:
        info.sources_tried.append("web_search")
        info.web_search_executed = True
        try:
            web_items = web_parking_search.search_web_parking(
                destination_name=destination_name,
                destination_address=destination_address,
            )
        except Exception as e:  # noqa: BLE001 — 폴백은 절대 라우터 전체를 죽이지 않는다
            logger.warning("web search fallback failed: %s", e)
            web_items = []
        web_ext = [_web_result_to_external(i) for i in web_items]
        web_ext = _dedup(db_existing + external, web_ext)
        info.web_search_count = len(web_ext)
        external.extend(web_ext)

    # 좌표 있는 후보에 한해 실 도보 경로(OSRM) 일괄 계산 — 30분 캐시 적중률 높음
    routable = [c for c in external if c.lat is not None and c.lng is not None]
    if routable:
        pairs = [(c.lat, c.lng, lat, lng) for c in routable]  # type: ignore[arg-type]
        routes = walking_batch_compute(pairs)
        for c, r in zip(routable, routes):
            c.walking_route_distance_m = r["distance_m"]
            c.walking_minutes = r["walking_minutes"]
            c.walking_route_source = r["source"]  # type: ignore[assignment]

    # usability 기준으로 표출/제외 분리.
    shown: list[ExternalCandidate] = []
    excluded: list[ExternalCandidate] = []
    for c in external:
        if c.usability == "private_restricted":
            excluded.append(c)
        else:
            shown.append(c)

    info.evidence_items = shown
    info.excluded_items = excluded
    info.usable_count = sum(1 for c in shown if c.usability == "usable")
    info.caution_count = sum(1 for c in shown if c.usability == "caution")
    info.excluded_count = len(excluded)

    info.summary, info.warnings = _build_summary(
        db_count=db_count,
        kakao_total=kakao_total,
        web_count=info.web_search_count,
        web_enabled=info.web_search_enabled,
        web_executed=info.web_search_executed,
        excluded_count=info.excluded_count,
    )
    return info
