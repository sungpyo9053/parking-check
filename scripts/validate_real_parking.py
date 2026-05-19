"""우리 시스템 top_recommendation vs Kakao PK6 실 주차장 데이터 100 POI 검증.

평가 항목:
  - top_rec 이 PK6 (좌표 기준 거리순) top-1 / top-3 / top-5 안에 있는가
  - top_rec 거리 vs PK6 가장 가까운 거리 (얼마나 더 멀리 추천하는가)
  - 분류 정확도: PK6 카테고리(공영/전용/일반)와 우리 usability 분류 일치
  - 자체 주차장 매칭 (목적지명 일치) 케이스 비율

ground truth = Kakao Local PK6 category search (좌표 기반 정렬). 우리는 같은
데이터를 쓰지만 score/분류 룰로 1위가 달라질 수 있음 — 그 차이를 측정.

사용:
  KAKAO_REST_API_KEY=... python scripts/validate_real_parking.py [--limit 100]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import Counter
from typing import Any
from urllib.parse import urlencode

import urllib.request

POI_FILE = "/tmp/popular_pois_100.json"
OUT_FILE = "/tmp/real_parking_validation.json"


def http_get_json(url: str, timeout: int = 30, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def kakao_pk6(api_key: str, lat: float, lng: float, radius: int = 1000, size: int = 15) -> list[dict]:
    params = {
        "category_group_code": "PK6",
        "x": str(lng), "y": str(lat),
        "radius": str(radius), "size": str(size), "sort": "distance",
    }
    return http_get_json(
        f"https://dapi.kakao.com/v2/local/search/category.json?{urlencode(params)}",
        headers={"Authorization": f"KakaoAK {api_key}"},
    ).get("documents", [])


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def norm_name(s: str) -> str:
    import re
    return re.sub(r"[\s\-_·,()/\\\[\]]+", "", (s or "")).lower()


def is_same_parking(a: dict, b: dict) -> bool:
    """이름 정확/유사 또는 좌표 매우 가까이 (15m 이내)."""
    if norm_name(a.get("name") or "") == norm_name(b.get("place_name") or ""):
        return True
    try:
        d = haversine_m(a["lat"], a["lng"], float(b["y"]), float(b["x"]))
        return d < 15
    except (KeyError, ValueError):
        return False


def kakao_kind(category: str | None) -> str:
    if not category:
        return "unknown"
    if "공영주차장" in category:
        return "public"
    if "노상" in category:
        return "roadside"
    return "private_or_misc"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--delay", type=float, default=0.2)
    args = ap.parse_args()

    api_key = os.environ.get("KAKAO_REST_API_KEY")
    if not api_key:
        print("ERROR: KAKAO_REST_API_KEY env required", file=sys.stderr)
        return 1

    try:
        with open(POI_FILE, encoding="utf-8") as f:
            pois = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {POI_FILE} not found", file=sys.stderr)
        return 1

    pois = pois[: args.limit]
    print(f"== real-parking validating {len(pois)} POIs ==\n", flush=True)
    print(f"{'#':>3} {'POI':<28} {'top1?':<6} {'top3?':<6} {'top5?':<6} {'our_dist':>9} {'pk_d1':>7} {'gap':>6} {'class':<14} note", flush=True)
    print("-" * 130, flush=True)

    rows: list[dict[str, Any]] = []
    for i, p in enumerate(pois, 1):
        name = p["name"]
        try:
            sr = http_get_json(
                args.base + "/api/places/search?" + urlencode({"query": name, "size": 3}),
                timeout=15,
            )
        except Exception as e:
            print(f"{i:>3} search fail: {e}", flush=True)
            continue
        items = sr.get("items") or []
        if not items:
            continue
        pid = items[0]["place_id"]
        plat, plng = items[0]["lat"], items[0]["lng"]

        try:
            an = http_get_json(args.base + f"/api/parking/analyze?place_id={pid}&radius=500", timeout=60)
        except Exception as e:
            print(f"{i:>3} analyze fail: {e}", flush=True)
            continue

        tr = an.get("top_recommendation") or {}
        tr_c = (tr or {}).get("candidate") or {}
        top = {
            "name": tr_c.get("name"),
            "lat": tr_c.get("lat"),
            "lng": tr_c.get("lng"),
            "category": tr_c.get("category"),
            "dist_route": tr_c.get("walking_route_distance_m"),
            "dist_straight": tr_c.get("distance_m"),
            "usability": tr_c.get("usability"),
            "reasons": tr_c.get("usability_reasons") or [],
        }
        sp_status = (an.get("self_parking") or {}).get("status")

        # Kakao PK6 직접 (ground truth)
        try:
            pk6 = kakao_pk6(api_key, plat, plng, radius=1000, size=15)
        except Exception as e:
            print(f"{i:>3} kakao fail: {e}", flush=True)
            continue

        # 매칭
        top1_match = False
        top3_match = False
        top5_match = False
        if top["name"] and pk6:
            for rank, k in enumerate(pk6[:5], 1):
                if is_same_parking(top, k):
                    top5_match = True
                    if rank <= 3:
                        top3_match = True
                    if rank == 1:
                        top1_match = True
                    break

        # PK6 #1 거리 (실 거리 ground truth)
        pk1_dist = None
        if pk6:
            try:
                pk1_dist = int(haversine_m(plat, plng, float(pk6[0]["y"]), float(pk6[0]["x"])))
            except (KeyError, ValueError):
                pass

        our_dist = top["dist_route"] or top["dist_straight"]
        gap = (our_dist - pk1_dist) if (our_dist and pk1_dist) else None

        # 분류 정확도 — 우리 top usability vs Kakao kind
        kakao_k = kakao_kind(top["category"]) if top["name"] else None
        cls_ok = None
        if top["usability"] == "usable" and kakao_k in ("public", "roadside"):
            cls_ok = "usable=공영/노상 (OK)"
        elif top["usability"] == "usable" and kakao_k == "private_or_misc":
            cls_ok = "usable=비공영 (자체매칭 가능)"
        elif top["usability"] == "caution":
            cls_ok = "caution"
        else:
            cls_ok = top["usability"] or "-"

        self_match = any("목적지명" in r for r in (top["reasons"] or []))
        note = "self_매칭" if self_match else ("자체 likely" if sp_status in ("available","likely") else "")

        rows.append({
            "i": i, "name": name, "self_status": sp_status,
            "top_name": top["name"], "top_usability": top["usability"],
            "top1_match": top1_match, "top3_match": top3_match, "top5_match": top5_match,
            "our_dist_m": our_dist, "pk1_dist_m": pk1_dist, "gap_m": gap,
            "kakao_kind": kakao_k, "self_match": self_match, "pk6_count": len(pk6),
        })

        mark1 = "✓" if top1_match else ("·" if top5_match else "✗")
        print(
            f"{i:>3} {name[:28]:<28} {('✓' if top1_match else '-'):<6} {('✓' if top3_match else '-'):<6} {('✓' if top5_match else '-'):<6} "
            f"{our_dist or '-':>9} {pk1_dist or '-':>7} {gap or '-':>6} {cls_ok[:14]:<14} {note}",
            flush=True,
        )
        time.sleep(args.delay)

    # 집계
    print("\n" + "=" * 100, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 100, flush=True)
    total = len(rows)
    if total == 0:
        print("(no samples)")
        return 1

    t1 = sum(1 for r in rows if r["top1_match"])
    t3 = sum(1 for r in rows if r["top3_match"])
    t5 = sum(1 for r in rows if r["top5_match"])
    sm = sum(1 for r in rows if r["self_match"])
    have_gap = [r["gap_m"] for r in rows if r["gap_m"] is not None]
    have_gap.sort()
    gap_median = have_gap[len(have_gap) // 2] if have_gap else None
    gap_p90 = have_gap[int(len(have_gap) * 0.9)] if have_gap else None

    no_pk6 = sum(1 for r in rows if r["pk6_count"] == 0)
    no_top = sum(1 for r in rows if not r["top_name"])

    usability_dist = Counter(r["top_usability"] for r in rows)
    kakao_kind_dist = Counter(r["kakao_kind"] for r in rows if r["kakao_kind"])

    print(f"total                     : {total}")
    print(f"top_rec 노출              : {total - no_top}/{total}")
    print(f"Kakao PK6 0개 케이스      : {no_pk6}")
    print(f"PK6 top-1 매칭            : {t1}/{total} = {t1/total:.1%}  (정확히 가장 가까운 PK6 와 동일)")
    print(f"PK6 top-3 매칭            : {t3}/{total} = {t3/total:.1%}")
    print(f"PK6 top-5 매칭            : {t5}/{total} = {t5/total:.1%}  (실 주차장 중 합리적 추천)")
    print(f"자체 주차장 매칭 (브랜드)  : {sm}/{total}")
    print(f"우리 추천 - PK6#1 거리차  : 중앙값 {gap_median}m, p90 {gap_p90}m")
    print(f"우리 top usability 분포    : {dict(usability_dist)}")
    print(f"Kakao 카테고리 분포        : {dict(kakao_kind_dist)}")

    # 큰 거리 차 케이스 (우리가 더 멀리 추천한 경우)
    big_gap = sorted(
        [r for r in rows if r["gap_m"] and r["gap_m"] > 300],
        key=lambda r: -r["gap_m"]
    )[:5]
    if big_gap:
        print("\n우리가 PK6#1 보다 300m 이상 멀리 추천한 케이스 (top 5):")
        for r in big_gap:
            print(f"  - {r['name']}: 우리 {r['top_name']} ({r['our_dist_m']}m), PK6#1 {r['pk1_dist_m']}m, gap +{r['gap_m']}m")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"\nraw: {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
