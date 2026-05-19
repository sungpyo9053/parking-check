"""전국 100 POI end-to-end 검증.

검증 항목:
  1) 추천 주차장 vs 사용자 이용 데이터 매칭
     - Tavily 로 "{POI} 주차" 검색 → 후기 snippet 에서 등장하는 주차장 이름 추출
     - 우리 top_recommendation 이름과 normalize 매칭 (exact / fuzzy / 다른 곳)
  2) 도보 거리 합리성
     - walking_route_distance_m / distance_m(직선) 비율이 1.0~3.0 범위인지
     - source='osrm' 적용률
  3) 지도 표시 데이터 유효성
     - top_rec.lat/lng 한국 좌표 범위(33~39, 124~132)
     - destination/candidates 좌표 유효성

전제: /tmp/popular_pois_100.json 가 이미 있음 (collect_popular_pois.py 실행 후).

사용:
  KAKAO_REST_API_KEY=... TAVILY_API_KEY=... python scripts/validate_e2e.py --base https://reviewdr.kr
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from typing import Optional

import urllib.request

POI_FILE = "/tmp/popular_pois_100.json"
OUT_FILE = "/tmp/e2e_validation.json"

_NORM_RE = re.compile(r"[\s\-_·()\[\]/\\,]+")
_PARK_KW = re.compile(r"([가-힣A-Za-z0-9]{2,15}(?:공영|민영|유료|주차장|주차타워|파킹|park|parking))", re.I)


def http_get_json(url: str, timeout: int = 60, headers: Optional[dict] = None) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def http_post_json(url: str, body: dict, headers: dict, timeout: int = 30) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(s: str) -> str:
    return _NORM_RE.sub("", (s or "")).lower()


def tavily_query_parking_names(api_key: str, place_name: str) -> list[str]:
    """블로그 후기에서 등장하는 주차장 이름들."""
    try:
        d = http_post_json(
            "https://api.tavily.com/search",
            {
                "query": f"{place_name} 주차",
                "search_depth": "basic",
                "max_results": 6,
                "include_answer": False,
            },
            {"Authorization": f"Bearer {api_key}"},
        )
    except Exception:
        return []
    raw = " ".join(
        f"{r.get('title','')} {r.get('content','')}"
        for r in d.get("results") or []
        if isinstance(r, dict)
    )
    found = _PARK_KW.findall(raw)
    # dedup, normalize
    seen: set[str] = set()
    out: list[str] = []
    for f in found:
        n = norm(f)
        if not n or n in seen:
            continue
        seen.add(n)
        out.append(f)
    return out[:10]


def fuzzy_contains(a: str, b: str) -> bool:
    """a 또는 b 가 다른 쪽의 4글자 이상 부분문자열을 포함."""
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return False
    if na in nb or nb in na:
        return True
    # 슬라이딩 4-gram 일치 확인
    for i in range(len(na) - 3):
        chunk = na[i : i + 4]
        if chunk in nb:
            return True
    return False


def in_korea(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return False
    return 33.0 <= lat <= 39.0 and 124.0 <= lng <= 132.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--delay", type=float, default=0.15)
    args = ap.parse_args()

    tavily_key = os.environ.get("TAVILY_API_KEY")
    if not tavily_key:
        print("WARN: TAVILY_API_KEY not set — 사용자 이용 데이터 매칭 비활성", file=sys.stderr)

    try:
        with open(POI_FILE, encoding="utf-8") as f:
            pois = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {POI_FILE} not found. run collect_popular_pois.py first.", file=sys.stderr)
        return 1

    pois = pois[: args.limit]
    print(f"== e2e validating {len(pois)} POIs against {args.base} ==\n", flush=True)

    rows = []
    for i, p in enumerate(pois, 1):
        name = p["name"]
        region_seed = p.get("seed")
        # places/search → place_id
        try:
            sr = http_get_json(
                args.base + "/api/places/search?" + f"query={urllib.parse.quote(name)}&size=3",
                timeout=20,
            )
        except Exception as e:
            print(f"{i:>3} search fail: {name} — {e}", flush=True)
            continue
        items = sr.get("items") or []
        if not items:
            continue
        pid = items[0]["place_id"]

        try:
            an = http_get_json(
                args.base + f"/api/parking/analyze?place_id={pid}&radius=500", timeout=70
            )
        except Exception as e:
            print(f"{i:>3} analyze fail: {name} — {e}", flush=True)
            continue

        tr = an.get("top_recommendation") or {}
        tr_cand = (tr or {}).get("candidate") or {}
        top_name = tr_cand.get("name") if tr else None
        top_lat = tr_cand.get("lat")
        top_lng = tr_cand.get("lng")
        top_dist_straight = tr_cand.get("distance_m")
        top_dist_route = tr_cand.get("walking_route_distance_m")
        top_walk = tr_cand.get("walking_minutes")
        top_src = tr_cand.get("walking_route_source")

        # 1) 사용자 이용 데이터 매칭
        user_names: list[str] = []
        match_kind = "no_user_data"
        if tavily_key:
            user_names = tavily_query_parking_names(tavily_key, name)
            if user_names and top_name:
                if any(fuzzy_contains(top_name, u) for u in user_names):
                    match_kind = "match"
                else:
                    match_kind = "mismatch"
            elif top_name:
                match_kind = "no_user_data"
            else:
                match_kind = "no_top"

        # 2) 도보 거리 합리성
        route_ratio = None
        if top_dist_route and top_dist_straight:
            route_ratio = round(top_dist_route / max(1, top_dist_straight), 2)
        route_reasonable = route_ratio is None or 0.95 <= route_ratio <= 3.0

        # 3) 좌표 유효성
        coords_ok = in_korea(top_lat, top_lng) if top_name else None

        rows.append(
            {
                "i": i,
                "name": name,
                "seed": region_seed,
                "self_parking": (an.get("self_parking") or {}).get("status"),
                "top": top_name,
                "top_dist_straight": top_dist_straight,
                "top_dist_route": top_dist_route,
                "top_walk": top_walk,
                "top_src": top_src,
                "route_ratio": route_ratio,
                "route_reasonable": route_reasonable,
                "coords_ok": coords_ok,
                "user_names": user_names,
                "match": match_kind,
            }
        )
        bar = ("✓" if match_kind == "match" else "·" if match_kind == "no_user_data" else "✗" if match_kind == "mismatch" else "-")
        print(
            f"{i:>3} {bar} {name[:24]:<24} | top={(top_name or '-')[:24]:<24} "
            f"| route={top_dist_route}/{top_dist_straight}m walk={top_walk}분 src={top_src} "
            f"| usr={len(user_names)}",
            flush=True,
        )
        time.sleep(args.delay)

    # 집계
    print("\n" + "=" * 100, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 100, flush=True)
    total = len(rows)
    has_top = sum(1 for r in rows if r["top"])
    coords_ok = sum(1 for r in rows if r["coords_ok"])
    osrm_applied = sum(1 for r in rows if r["top_src"] == "osrm")
    route_reasonable = sum(1 for r in rows if r["route_reasonable"])
    user_matches = Counter(r["match"] for r in rows)
    eval_with_user = [r for r in rows if r["match"] in ("match", "mismatch")]
    match_n = sum(1 for r in eval_with_user if r["match"] == "match")

    print(f"total                 : {total}")
    print(f"top_recommendation 있음: {has_top}/{total}")
    print(f"좌표 유효 (한국 범위) : {coords_ok}/{has_top}")
    print(f"실 도보 경로(OSRM) 적용: {osrm_applied}/{has_top}")
    print(f"도보 거리 합리성 (0.95~3.0배): {route_reasonable}/{has_top}")
    if eval_with_user:
        print(f"사용자 이용 데이터 매칭: {match_n}/{len(eval_with_user)} = {match_n/len(eval_with_user):.1%}")
    print(f"매칭 분포             : {dict(user_matches)}")

    # 매칭 안 된 케이스 sample
    mismatches = [r for r in rows if r["match"] == "mismatch"][:5]
    if mismatches:
        print("\nMISMATCH 예시 (top 5):")
        for r in mismatches:
            print(f"  - {r['name']}")
            print(f"      우리 top : {r['top']}")
            print(f"      유저언급 : {r['user_names'][:5]}")

    # 도보 비율 이상 케이스
    odd = [r for r in rows if r["route_ratio"] and not r["route_reasonable"]][:5]
    if odd:
        print("\n도보거리 이상 비율 (>3.0 또는 <0.95):")
        for r in odd:
            print(f"  - {r['name']}: 직선={r['top_dist_straight']}m 실경로={r['top_dist_route']}m 비율={r['route_ratio']}")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"\nraw: {OUT_FILE}")
    return 0


if __name__ == "__main__":
    import urllib.parse  # noqa: PLC0415
    raise SystemExit(main())
