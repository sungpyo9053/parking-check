"""시장 안 식당 케이스 검증.

가설: 시장 안에 위치한 식당은 자체 주차가 없고, 그 시장의 공영주차장이
top_recommendation 으로 추천돼야 한다.

수집:
  5대 시장 × 각 좌표에서 카카오 keyword search "{시장이름} 음식점" 으로
  시장 내 매장 후보를 가져옴.

평가:
  - self_parking.status 가 unavailable / uncertain / unknown 이어야 (자체 없음)
  - top_recommendation.candidate.name 에 "{시장이름 핵심토큰}" + "공영" 또는 "주차장" → exact
  - 다른 공영주차장 → other_public
  - 비공영 → non_public
  - 추천 없음 → no_top

사용:
  KAKAO_REST_API_KEY=... python scripts/validate_market_food.py --base https://reviewdr.kr
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from urllib.parse import urlencode

import urllib.request

MARKETS: list[tuple[str, float, float, str]] = [
    ("광장시장", 37.5704, 126.9997, "광장"),
    ("망원시장", 37.5559, 126.9009, "망원"),
    ("통인시장", 37.5800, 126.9696, "통인"),
    ("부평시장", 37.4900, 126.7234, "부평"),
    ("서문시장", 35.8709, 128.5860, "서문"),
]


def http_get_json(url: str, timeout: int = 60, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def kakao_keyword(api_key: str, query: str, lat: float, lng: float, radius: int = 300, size: int = 15) -> list[dict]:
    params = {
        "query": query, "x": str(lng), "y": str(lat),
        "radius": str(radius), "size": str(size), "sort": "accuracy",
    }
    return http_get_json(
        f"https://dapi.kakao.com/v2/local/search/keyword.json?{urlencode(params)}",
        headers={"Authorization": f"KakaoAK {api_key}"},
    ).get("documents", [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--per-market", type=int, default=10)
    ap.add_argument("--delay", type=float, default=0.2)
    args = ap.parse_args()

    api_key = os.environ.get("KAKAO_REST_API_KEY")
    if not api_key:
        print("ERROR: KAKAO_REST_API_KEY env required", file=sys.stderr)
        return 1

    all_results = []
    for market_name, lat, lng, market_token in MARKETS:
        print(f"\n=== {market_name} ({lat}, {lng}) ===")
        try:
            docs = kakao_keyword(api_key, f"{market_name} 음식점", lat, lng, radius=300, size=15)
        except Exception as e:
            print(f"  ! kakao failed: {e}")
            continue
        # 음식점만, market 토큰이 이름 OR 주소 OR 좌표 200m 이내
        def _within(d: dict) -> bool:
            try:
                dlat, dlng = float(d["y"]), float(d["x"])
            except (KeyError, ValueError):
                return False
            # 단순 lat/lng 직선거리 (대략, ~111km/°)
            dist_deg = ((dlat - lat) ** 2 + (dlng - lng) ** 2) ** 0.5
            return dist_deg < 0.003  # 약 300m
        food_docs = [
            d for d in docs
            if "음식점" in (d.get("category_name") or "")
            and (
                market_token in (d.get("address_name") or "")
                or market_token in (d.get("place_name") or "")
                or _within(d)
            )
        ][: args.per_market]
        print(f"  found {len(food_docs)} food places in {market_name}")

        for d in food_docs:
            name = d.get("place_name")
            try:
                sr = http_get_json(args.base + "/api/places/search?" + urlencode({"query": name, "size": 3}), timeout=15)
            except Exception as e:
                print(f"  ! search fail {name}: {e}")
                continue
            items = sr.get("items") or []
            if not items:
                continue
            pid = items[0]["place_id"]

            try:
                an = http_get_json(args.base + f"/api/parking/analyze?place_id={pid}&radius=500", timeout=60)
            except Exception as e:
                print(f"  ! analyze fail {name}: {e}")
                continue

            sp_status = (an.get("self_parking") or {}).get("status")
            tr = an.get("top_recommendation")
            top_name = (tr or {}).get("candidate", {}).get("name") if tr else None
            top_dist = (tr or {}).get("candidate", {}).get("distance_m") if tr else None

            if top_name and market_token in top_name and ("공영" in top_name or "주차장" in top_name):
                match = "exact"
            elif top_name and "공영주차장" in top_name:
                match = "other_public"
            elif top_name:
                match = "non_public"
            else:
                match = "no_top"

            self_ok = sp_status in ("unavailable", "uncertain", "unknown")
            row = {"market": market_name, "poi": name, "sp": sp_status,
                   "self_ok": self_ok, "top": top_name, "top_dist": top_dist, "match": match}
            all_results.append(row)
            mark = "✓" if (self_ok and match in ("exact", "other_public")) else ("△" if self_ok else "✗")
            print(f"  {mark} {name:30s}  sp={sp_status or 'NA':11s}  top={top_name}  [{match}]")
            time.sleep(args.delay)

    print()
    print("=" * 100)
    print("SUMMARY")
    print("=" * 100)
    total = len(all_results)
    if total == 0:
        print("(no samples)")
        return 1
    self_ok = sum(1 for r in all_results if r["self_ok"])
    exact = sum(1 for r in all_results if r["match"] == "exact")
    other_public = sum(1 for r in all_results if r["match"] == "other_public")
    non_public = sum(1 for r in all_results if r["match"] == "non_public")
    no_top = sum(1 for r in all_results if r["match"] == "no_top")
    full_ok = sum(1 for r in all_results if r["self_ok"] and r["match"] in ("exact", "other_public"))
    print(f"total samples              : {total}")
    print(f"self_parking 'not available': {self_ok}/{total} = {self_ok/total:.1%}")
    print(f"top1 = 같은 시장 공영       : {exact}/{total} = {exact/total:.1%}")
    print(f"top1 = 다른 공영주차장      : {other_public}/{total}")
    print(f"top1 = 비공영               : {non_public}/{total}")
    print(f"top1 없음                   : {no_top}/{total}")
    print(f"전체 OK (자체X + 공영 추천): {full_ok}/{total} = {full_ok/total:.1%}")

    with open("/tmp/market_food_validation.json", "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print("\nraw: /tmp/market_food_validation.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
