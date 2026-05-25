"""Kakao/웹 검색 기반 외부 후보 중 '최우선 1개'를 가중치로 선정.

자체 주차가 안 되는 경우 사용자가 18개씩 비교하기 어려우니, 가장 합리적인
1개를 골라 상단에 '여기 가세요' 로 강조한다.

가중치 (rule-based, LLM 미사용):
  - usability=usable  : +60
  - usability=caution : +10
  - private_restricted: 후보 자체에서 제외 (호출 측에서 거름)
  - 거리: 0m=40 점, 500m=20 점, 1000m=0 점 선형 감산
  - category 보너스
      · "공영주차장" 포함     : +18  (가장 안정적, 보통 저렴)
      · "노상공영주차장"       : +10  (24시간 가능성/접근성)
      · "공원주차장"          : +8
      · "유료" / "민영"        : +5
      · 알려진 개방 운영사 브랜드: +12
  - 출처 보너스
      · source=public_db      : +20 (요금/실시간 정보 있음)
      · source=kakao_fallback : 0
      · source=web_search     : -20 (좌표 없거나 정확도 낮음)

동점 시 거리 짧은 쪽 우선.
"""
from __future__ import annotations

from ..schemas.parking import Candidate, ExternalCandidate

_OPEN_OPERATOR_BRANDS = (
    "나이스파크",
    "AJ파크",
    "윌슨파킹",
    "GS파크24",
    "T맵주차",
    "카카오T주차",
    "하이파크",
)


def _distance_score(distance_m: int | None) -> float:
    """거리 점수 — 가까운 곳 강하게 우선, 1km 이상은 페널티.

    이전: 0~1000m 선형 0~40, 1km 넘으면 0. 멀리도 카테고리/source 보너스로
    1위 되는 케이스 多 (잠실/롯데월드 등에서 1km+ 추천).
    """
    if distance_m is None:
        return 0.0
    d = max(0, distance_m)
    if d <= 100:
        return 50.0  # 매우 가까움 — 거의 자체급
    if d <= 1000:
        # 100m → 50, 1000m → 5 선형 감산
        return 50.0 - 45.0 * (d - 100) / 900.0
    if d <= 1500:
        return -10.0  # 1km~1.5km 약한 페널티
    return -50.0  # 1.5km 이상 강한 페널티


def _category_bonus(name: str, category: str | None) -> tuple[float, list[str]]:
    """카테고리 + 비용 추정 보너스.

    공영주차장은 보통 저렴하고 누구나 이용 가능 → 가장 큰 보너스.
    노상공영은 24시간 가능성이 높고 접근성 좋음.
    민영/유료 타워는 비용은 들지만 안정적.
    """
    blob = f"{name} {category or ''}"
    bonus = 0.0
    reasons: list[str] = []
    if "공영주차장" in blob:
        bonus += 20
        reasons.append("공영주차장(저비용 추정)")
    elif "노상공영" in blob:
        bonus += 12
        reasons.append("노상공영(접근성)")
    elif "공원주차장" in blob:
        bonus += 8
        reasons.append("공원주차장")
    elif "주차타워" in blob or "주차빌딩" in blob:
        bonus += 4
        reasons.append("주차타워(진출입 복잡도 ↑)")
    elif "유료" in blob or "민영" in blob:
        bonus += 5
        reasons.append("민영/유료 일반 개방")
    for brand in _OPEN_OPERATOR_BRANDS:
        if brand in name:
            bonus += 12
            reasons.append(f"개방 운영사({brand})")
            break
    return bonus, reasons


def _complexity_penalty(name: str, category: str | None) -> tuple[float, list[str]]:
    """진출입/구조 복잡도 휴리스틱. 이름/카테고리에 단서가 있을 때만 약한 감점."""
    blob = f"{name} {category or ''}"
    penalty = 0.0
    reasons: list[str] = []
    if "타워" in blob or "빌딩" in blob or "지하" in blob:
        if "공영" not in blob:  # 공영은 보통 단순
            penalty -= 5
            reasons.append("타워/지하(진출입 복잡)")
    if "옥상" in blob:
        penalty -= 3
        reasons.append("옥상(기상 영향)")
    return penalty, reasons


def score_external(c: ExternalCandidate) -> tuple[float, list[str]]:
    if c.usability == "private_restricted":
        return -999.0, ["추천 제외 후보"]

    reasons: list[str] = []
    score = 0.0

    if c.usability == "usable":
        score += 60
        reasons.append("일반 개방 후보")
    elif c.usability == "caution":
        score += 10
        reasons.append("사용 가능 여부 확인 필요")

    # 매장 자체 주차장(목적지명 매칭) 이면 어떤 외부 공영보다도 우선되어야 함
    # (사용자 입장: 가까운 자체 두고 먼 공영 추천하지 마라)
    if any("목적지명" in r for r in c.usability_reasons):
        score += 100
        reasons.append("매장 자체 주차장 매칭 — 최우선")

    ds = _distance_score(c.distance_m)
    if c.distance_m is not None:
        score += ds
        reasons.append(f"거리 {c.distance_m}m")

    cb, cr = _category_bonus(c.name, c.category)
    score += cb
    reasons.extend(cr)

    pp, pr = _complexity_penalty(c.name, c.category)
    score += pp
    reasons.extend(pr)

    if c.source == "public_db":
        score += 20
        reasons.append("공공데이터 (요금/실시간 정보 있음)")
    elif c.source == "web_search":
        score -= 20
        reasons.append("웹 검색 기반 (좌표 정확도 낮음)")

    return round(score, 1), reasons


def score_db_candidate(c: Candidate) -> tuple[float, list[str]]:
    """공공데이터 후보. 이미 c.score 가 있지만, ExternalCandidate 와 같은
    스케일로 비교하려고 별도 산식 사용."""
    reasons: list[str] = ["공공데이터 기반"]
    score = 60.0  # usable 기본
    ds = _distance_score(c.distance_m)
    score += ds
    reasons.append(f"거리 {c.distance_m}m")
    if c.realtime and c.realtime.available_count is not None and c.realtime.total_capacity:
        ratio = c.realtime.available_count / max(1, c.realtime.total_capacity)
        if ratio >= 0.3:
            score += 15
            reasons.append("실시간 잔여 여유")
        elif ratio >= 0.1:
            score += 5
            reasons.append("실시간 잔여 보통")
        else:
            score -= 10
            reasons.append("실시간 잔여 부족")
    score += 20  # public_db 보너스
    return round(score, 1), reasons


MAX_TOP_WALK_MIN = 15  # 1순위 추천 최대 도보 분 — 그 이상은 차량 방문 의미 적음
MAX_TOP_DISTANCE_M = 1200  # 도보 분 미상 시 거리 cap


def pick_top_external(
    candidates: list[ExternalCandidate],
) -> tuple[ExternalCandidate | None, float, list[str]]:
    """후보 리스트에서 최우선 1개. private_restricted 는 자동 제외.

    동점이면 거리 짧은 쪽 우선.

    중요: [usable] 후보가 1개라도 있으면 [caution] 은 1순위 후보 풀에서 제외.
    더 멀어도 검증된 일반 개방 후보를 1순위로 — 회사 빌딩/임의 빌딩 주차장
    (caution) 이 단순 거리 우위로 1순위가 되어 "회사 건물에 주차하라" 처럼 보이는
    버그 차단. usable 이 0 개일 때만 caution 도 후보로 허용 (사용자에게 "확인 필요"
    라벨로 표시됨).
    """
    # 거리 cap — 도보 15분(약 1.2km) 초과 후보는 1순위에서 제외 (의미 없음)
    def _within_cap(c: ExternalCandidate) -> bool:
        if c.walking_minutes is not None:
            return c.walking_minutes <= MAX_TOP_WALK_MIN
        if c.distance_m is not None:
            return c.distance_m <= MAX_TOP_DISTANCE_M
        return False  # 거리 정보 없으면 1순위 후보로 부적합

    pool_usable = [
        c for c in candidates if c.usability == "usable" and _within_cap(c)
    ]
    if pool_usable:
        pool = pool_usable
    else:
        pool = [
            c for c in candidates
            if c.usability != "private_restricted" and _within_cap(c)
        ]

    best: tuple[float, int, ExternalCandidate, list[str]] | None = None
    for c in pool:
        s, rs = score_external(c)
        tie = c.distance_m if c.distance_m is not None else 99999
        key = (-s, tie)  # 점수 내림차순, 거리 오름차순
        if best is None or key < (-best[0], best[1]):
            best = (s, tie, c, rs)
    if best is None:
        return None, 0.0, []
    return best[2], best[0], best[3]
