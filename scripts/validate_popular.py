"""popular_pois_100.json 의 100개 POI 를 우리 시스템으로 돌려 분포 검증.

ground truth 라벨이 없으므로 'self-consistency / 카테고리 일치도' 만 본다:
  - 카테고리 휴리스틱 (백화점=available, 시장=unavailable 등) vs 시스템 예측 일치율
  - 자체 likely 비율, unavailable 비율, unknown 비율 분포
  - top_recommendation 채워진 비율
  - 시장 안 식당 케이스 (이름에 'OO시장' 포함 + 음식점 카테고리) 에서 top_rec 이
    'OO시장공영주차장' 형태로 잡히는지 매칭률

사용:
  python scripts/validate_popular.py --base https://reviewdr.kr [--limit 100]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter
from urllib.parse import urlencode

import urllib.request

POI_FILE = "/tmp/popular_pois_100.json"


def http_get_json(url: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def category_heuristic(name: str, category: str | None) -> str:
    """카카오 카테고리 기반 휴리스틱 ground truth.

    available  : 백화점/쇼핑몰/대형마트/복합쇼핑/아울렛/마트
    unavailable: 시장/테마거리/한옥마을/지하상가/성당/교회
    likely     : 그 외 큰 시설 (호텔/리조트/공원 등)
    unknown    : 그 외 (대부분 일반 식당/카페)
    """
    c = (category or "").lower()
    if any(k in c for k in ("백화점", "쇼핑몰", "복합쇼핑", "아울렛", "대형마트", "할인점")):
        return "available"
    if any(k in c for k in ("시장", "테마거리", "한옥거리", "한옥마을", "지하상가", "성당", "교회", "사찰")):
        return "unavailable"
    if any(k in c for k in ("리조트", "호텔", "테마파크", "놀이공원", "박물관")):
        return "likely"
    return "unknown"


_MARKET_RE = re.compile(r"^([가-힣A-Za-z0-9]+시장)")


def is_inside_market(name: str) -> str | None:
    """이름이 'OO시장XXX' 형태로 시장 안 매장처럼 보이면 시장 이름 반환."""
    m = _MARKET_RE.match(name or "")
    if not m:
        return None
    market = m.group(1)
    # '광장시장' '망원시장' 자체가 아니라 'OO시장XXX' 같이 뒤에 식당명이 붙은 것만
    if name == market:
        return None
    return market


def match_level(gt: str, pred: str) -> str:
    if gt == pred:
        return "exact"
    pos = {"available", "likely"}
    neg = {"unavailable"}
    soft = {"uncertain", "unknown"}
    if gt in pos and pred in pos:
        return "partial_pos"
    if gt in neg and pred in (neg | {"uncertain"}):
        return "partial_neg"
    if gt in pos and pred in soft:
        return "miss_low"
    if gt in neg and pred in pos:
        return "false_positive"
    if gt == "unknown":
        return "gt_unknown"  # 평가 제외
    return "other"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--delay", type=float, default=0.2)
    args = ap.parse_args()

    try:
        with open(POI_FILE, encoding="utf-8") as f:
            pois = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {POI_FILE} not found. Run scripts/collect_popular_pois.py first.", file=sys.stderr)
        return 1

    pois = pois[: args.limit]
    print(f"== validating {len(pois)} POIs ==\n")

    rows = []
    market_total = 0
    market_top_match = 0
    market_top_partial = 0
    for i, p in enumerate(pois, 1):
        name = p["name"]
        category = p.get("category")
        gt = category_heuristic(name, category)

        # places/search 로 place_id
        url = args.base + "/api/places/search?" + urlencode({"query": name, "size": 3})
        try:
            sr = http_get_json(url, timeout=15)
        except Exception as e:
            print(f"{i:>3}  search fail: {e}", file=sys.stderr)
            continue
        items = sr.get("items") or []
        if not items:
            continue
        pid = items[0]["place_id"]

        # analyze
        try:
            d = http_get_json(args.base + f"/api/parking/analyze?place_id={pid}&radius=500", timeout=60)
        except Exception as e:
            print(f"{i:>3}  analyze fail: {e}", file=sys.stderr)
            continue

        sp = d.get("self_parking") or {}
        pred = sp.get("status") or "unknown"
        tr = d.get("top_recommendation")
        top_name = (tr or {}).get("candidate", {}).get("name") if tr else None
        m = match_level(gt, pred)

        market = is_inside_market(name)
        market_match = ""
        if market:
            market_total += 1
            if top_name:
                if market in top_name and ("공영" in top_name or "주차장" in top_name):
                    market_top_match += 1
                    market_match = "✓ OO시장공영주차장"
                elif "공영주차장" in top_name:
                    market_top_partial += 1
                    market_match = "△ 다른 공영"
                else:
                    market_match = "× 공영X"

        rows.append({
            "name": name,
            "category": category,
            "gt": gt,
            "pred": pred,
            "match": m,
            "top": top_name,
            "market": market,
            "market_match": market_match,
        })
        time.sleep(args.delay)

    # 출력
    print(f"\n{'#':>3} {'POI':<28} {'CAT(short)':<22} {'GT':<11} {'PRED':<11} {'MATCH':<14} TOP/MARKET")
    print("-" * 130)
    for i, r in enumerate(rows, 1):
        cat_short = (r["category"] or "")[:22]
        top_str = r["top"] or "-"
        if r["market"]:
            top_str += f"  [{r['market_match']}]"
        print(f"{i:>3} {r['name'][:28]:<28} {cat_short:<22} {r['gt']:<11} {r['pred']:<11} {r['match']:<14} {top_str[:70]}")

    print()
    print("=" * 100)
    print("SUMMARY")
    print("=" * 100)

    total = len(rows)
    eval_rows = [r for r in rows if r["gt"] != "unknown"]
    n_eval = len(eval_rows)
    cm = Counter(r["match"] for r in eval_rows)
    pred_dist = Counter(r["pred"] for r in rows)
    print(f"total                      : {total}")
    print(f"평가 대상 (GT != unknown)   : {n_eval}")
    if n_eval:
        exact = cm.get("exact", 0)
        partial = cm.get("partial_pos", 0) + cm.get("partial_neg", 0)
        false_pos = cm.get("false_positive", 0)
        miss_low = cm.get("miss_low", 0)
        print(f"exact                      : {exact}/{n_eval} = {exact/n_eval:.1%}")
        print(f"exact+partial              : {(exact+partial)}/{n_eval} = {(exact+partial)/n_eval:.1%}")
        print(f"false_positive (오격상)    : {false_pos}")
        print(f"miss_low (격상 실패)        : {miss_low}")
    print(f"전체 예측 분포              : {dict(pred_dist)}")
    print()
    print(f"시장 안 매장 케이스          : {market_total}개")
    if market_total:
        print(f"  '같은 시장의 공영' top1   : {market_top_match}/{market_total} = {market_top_match/market_total:.1%}")
        print(f"  '다른 공영' top1          : {market_top_partial}/{market_total}")

    with open("/tmp/popular_validation.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print("\nraw: /tmp/popular_validation.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
