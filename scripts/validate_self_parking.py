"""self_parking + top_recommendation 정확도 검증 스크립트.

20개 POI 에 대해:
  1) /api/places/search 로 place_id 찾기
  2) /api/parking/analyze 로 self_parking.status, top_recommendation 가져오기
  3) 큐레이션된 ground truth 와 비교
  4) confusion matrix + 일치율 + 케이스별 진단 출력

ground truth status 카테고리:
  available    : 자체 주차 명확 (백화점/쇼핑몰/스타필드 등)
  likely       : 자체 주차 추정 (자체 주차장 있는 카페/식당)
  unavailable  : 자체 없음 (시장/번화가/관광지, 인근 공영 이용)
  unknown      : 정보 부족 (이론적 카테고리; 데이터엔 없을 수 있음)

사용:
  python scripts/validate_self_parking.py [--base URL]

기본 base URL: https://reviewdr.kr
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from urllib.parse import urlencode

import urllib.request

# (이름, 검색쿼리, ground_truth_status, 비고)
DATASET: list[tuple[str, str, str, str]] = [
    # 자체 주차 명확 — 백화점/쇼핑몰/대형 시설
    ("더현대 서울", "더현대 서울 여의도", "available", "쇼핑몰 자체 지하주차장"),
    ("스타필드 하남", "스타필드 하남", "available", "쇼핑몰 자체 주차"),
    ("롯데월드몰 잠실", "롯데월드몰 잠실", "available", "쇼핑몰 자체 주차"),
    ("코엑스몰", "코엑스몰 삼성동", "available", "지하 대형 주차장"),
    ("롯데백화점 본점", "롯데백화점 본점 명동", "available", "백화점 자체 주차"),
    ("DDP 동대문디자인플라자", "DDP 동대문디자인플라자", "available", "자체 주차장"),

    # 자체 주차 가능성 — 큰 카페/리조트
    ("더홈 안양", "더홈 안양 삼막로", "likely", "사용자 확인 카페 자체 주차"),
    ("어글리스토브 망원", "어글리스토브 망원", "likely", "카페 자체 주차 일부"),

    # 자체 없음 — 시장/번화가/도심 핫스팟
    ("수유전통시장", "수유전통시장", "unavailable", "전통시장 자체 X"),
    ("광장시장", "광장시장 종로", "unavailable", "전통시장 자체 X"),
    ("이재모피자 본점", "이재모피자 본점 부산", "unavailable", "사용자 확인 인근 공영"),
    ("명동성당", "명동성당", "unavailable", "도심 자체 거의 없음"),
    ("인사동", "인사동", "unavailable", "관광지 인근 공영"),
    ("익선동 한옥거리", "익선동", "unavailable", "골목 인근 공영"),
    ("가로수길", "신사 가로수길", "unavailable", "거리 자체 X"),
    ("망원시장", "망원시장", "unavailable", "전통시장"),

    # 관광지 — 자체 주차장 있는 경우
    ("경복궁", "경복궁", "likely", "주차장 별도 운영"),
    ("해운대해수욕장", "해운대해수욕장", "likely", "공영 주차장 인접"),
    ("광안리해수욕장", "광안리해수욕장", "likely", "공영 주차장 인접"),
    ("부평지하상가", "부평지하상가", "unavailable", "지하상가 자체 X"),
]


def http_get_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def search_place_id(base: str, query: str) -> tuple[int | None, dict | None]:
    url = base + "/api/places/search?" + urlencode({"query": query, "size": 5})
    try:
        d = http_get_json(url, timeout=15)
    except Exception as e:
        print(f"   ! search failed: {e}", file=sys.stderr)
        return None, None
    items = d.get("items") or []
    if not items:
        return None, None
    return items[0].get("place_id"), items[0]


def analyze(base: str, place_id: int, radius: int = 500) -> dict | None:
    url = base + f"/api/parking/analyze?place_id={place_id}&radius={radius}"
    try:
        return http_get_json(url, timeout=60)
    except Exception as e:
        print(f"   ! analyze failed: {e}", file=sys.stderr)
        return None


# 예측-실측 일치 기준:
#   완전 일치: status 같음
#   부분 일치(긍정): GT 가 available/likely 인데 pred 도 둘 중 하나
#   부분 일치(부정): GT 가 unavailable 인데 pred 가 unavailable/uncertain
#   불일치: 그 외 (특히 GT=unavailable 인데 pred=likely 같은 오격상)
def match_level(gt: str, pred: str) -> str:
    if pred == gt:
        return "exact"
    pos = {"available", "likely"}
    neg = {"unavailable"}
    soft = {"uncertain", "unknown"}
    if gt in pos and pred in pos:
        return "partial_pos"
    if gt in neg and pred in (neg | {"uncertain"}):
        return "partial_neg"
    if gt in pos and pred in soft:
        return "miss_low"  # 자체 있는데 우리가 모름 (격상 실패)
    if gt in neg and pred in pos:
        return "false_positive"  # 자체 없는데 likely/available 로 잘못 격상
    return "other"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--radius", type=int, default=500)
    ap.add_argument("--delay", type=float, default=0.5, help="POI 간 sleep (sec)")
    args = ap.parse_args()

    print(f"== validating against {args.base} (radius={args.radius}m) ==\n")
    print(f"{'#':>2}  {'POI':<25} {'GT':<12} {'PRED':<12} {'CONF':>4} {'MATCH':<14} TOP_REC")
    print("-" * 100)

    results: list[dict] = []
    for i, (poi, query, gt, note) in enumerate(DATASET, 1):
        pid, place = search_place_id(args.base, query)
        if not pid:
            print(f"{i:>2}  {poi:<25} {gt:<12} {'NO_PLACE':<12} {'-':>4} {'-':<14} -")
            results.append({"poi": poi, "gt": gt, "pred": None, "match": "no_place"})
            time.sleep(args.delay)
            continue

        d = analyze(args.base, pid, args.radius)
        if not d:
            print(f"{i:>2}  {poi:<25} {gt:<12} {'API_ERR':<12} {'-':>4} {'-':<14} -")
            results.append({"poi": poi, "gt": gt, "pred": None, "match": "api_err"})
            time.sleep(args.delay)
            continue

        sp = d.get("self_parking") or {}
        pred = sp.get("status") or "unknown"
        conf = sp.get("confidence") or 0
        tr = d.get("top_recommendation")
        top_name = (tr or {}).get("candidate", {}).get("name") if tr else None
        top_score = (tr or {}).get("score")
        m = match_level(gt, pred)

        top_str = f"{top_name} (s={top_score})" if top_name else "-"
        print(f"{i:>2}  {poi:<25} {gt:<12} {pred:<12} {conf:>4} {m:<14} {top_str}")
        results.append(
            {
                "poi": poi,
                "gt": gt,
                "pred": pred,
                "conf": conf,
                "match": m,
                "top": top_name,
                "evidence_count": len(sp.get("evidence") or []),
                "note": note,
            }
        )
        time.sleep(args.delay)

    print()
    print("=" * 100)
    print("SUMMARY")
    print("=" * 100)

    valid = [r for r in results if r.get("pred") is not None]
    total = len(valid)
    if total == 0:
        print("no valid samples")
        return 1

    cm = Counter(r["match"] for r in valid)
    pos_ok = sum(1 for r in valid if r["match"] in ("exact", "partial_pos") and r["gt"] in ("available", "likely"))
    pos_total = sum(1 for r in valid if r["gt"] in ("available", "likely"))
    neg_ok = sum(1 for r in valid if r["match"] in ("exact", "partial_neg") and r["gt"] == "unavailable")
    neg_total = sum(1 for r in valid if r["gt"] == "unavailable")
    false_pos = cm.get("false_positive", 0)
    miss_low = cm.get("miss_low", 0)

    exact = cm.get("exact", 0)
    partial = cm.get("partial_pos", 0) + cm.get("partial_neg", 0)

    print(f"total samples           : {total}")
    print(f"exact match             : {exact}/{total} = {exact/total:.1%}")
    print(f"exact + partial         : {(exact+partial)}/{total} = {(exact+partial)/total:.1%}")
    print(f"자체 있음 recall (GT pos): {pos_ok}/{pos_total} = {(pos_ok/pos_total if pos_total else 0):.1%}")
    print(f"자체 없음 recall (GT neg): {neg_ok}/{neg_total} = {(neg_ok/neg_total if neg_total else 0):.1%}")
    print(f"오격상 (GT=neg → pred=pos) false_positive: {false_pos}")
    print(f"누락 (GT=pos → pred=unknown/uncertain) miss_low: {miss_low}")
    print()
    print("breakdown:", dict(cm))

    # 케이스별 문제 진단
    problems = [r for r in valid if r["match"] in ("false_positive", "miss_low", "other")]
    if problems:
        print()
        print("PROBLEMS:")
        for r in problems:
            print(f"  [{r['match']}] {r['poi']}  GT={r['gt']}  pred={r['pred']}  evidence={r['evidence_count']}  note={r['note']}")

    # raw json 저장
    with open("/tmp/parking_validation.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print()
    print("raw: /tmp/parking_validation.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
