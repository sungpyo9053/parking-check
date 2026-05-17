"""TMAP 추천 맛집 100개 대신 카카오 keyword '맛집' 좌표 다양화 검증용 POI 수집.

TMAP 공식 맛집 추천 API 는 일반 공개되어 있지 않다 (SK Open API 의 POI 검색은
가능하지만 '추천 맛집' 큐레이션은 제공 안 함). 대안으로 다음을 수행:

  1) 전국 주요 좌표 14개 (대도시 + 관광지) 를 시드로
  2) 각 좌표에서 카카오 keyword search "맛집" sort=accuracy 로 size=15 가져옴
  3) dedup 후 상위 100개를 JSON 으로 저장

출력: /tmp/popular_pois_100.json
포맷:
  [
    {"name": "...", "address": "...", "category": "...", "lat": .., "lng": .., "place_url": "..."},
    ...
  ]
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Iterable

import urllib.request
from urllib.parse import urlencode

# 전국 주요 시드 좌표 (대도시 + 관광지)
SEEDS: list[tuple[str, float, float]] = [
    ("서울 강남", 37.4979, 127.0276),
    ("서울 종로", 37.5704, 126.9786),
    ("서울 홍대", 37.5563, 126.9226),
    ("서울 잠실", 37.5133, 127.1000),
    ("서울 여의도", 37.5215, 126.9244),
    ("부산 서면", 35.1577, 129.0596),
    ("부산 해운대", 35.1631, 129.1635),
    ("부산 광안리", 35.1531, 129.1188),
    ("대구 동성로", 35.8696, 128.5926),
    ("인천 송도", 37.3894, 126.6531),
    ("대전 둔산", 36.3504, 127.3845),
    ("광주 충장로", 35.1469, 126.9176),
    ("수원 행궁", 37.2843, 127.0143),
    ("제주 시내", 33.4996, 126.5312),
]


def kakao_keyword_search(api_key: str, query: str, lat: float, lng: float, size: int = 15, radius: int = 3000) -> list[dict]:
    params = {
        "query": query,
        "x": str(lng),
        "y": str(lat),
        "radius": str(radius),
        "size": str(size),
        "sort": "accuracy",
    }
    req = urllib.request.Request(
        f"https://dapi.kakao.com/v2/local/search/keyword.json?{urlencode(params)}",
        headers={"Authorization": f"KakaoAK {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d.get("documents", [])


def main() -> int:
    api_key = os.environ.get("KAKAO_REST_API_KEY")
    if not api_key:
        print("ERROR: KAKAO_REST_API_KEY env not set", file=sys.stderr)
        return 1

    all_items: dict[str, dict] = {}
    for label, lat, lng in SEEDS:
        try:
            docs = kakao_keyword_search(api_key, "맛집", lat, lng)
        except Exception as e:
            print(f"  ! {label} fail: {e}", file=sys.stderr)
            continue
        added = 0
        for d in docs:
            pid = d.get("id")
            if not pid or pid in all_items:
                continue
            all_items[pid] = {
                "name": d.get("place_name"),
                "address": d.get("address_name"),
                "road_address": d.get("road_address_name"),
                "category": d.get("category_name"),
                "lat": float(d["y"]),
                "lng": float(d["x"]),
                "place_url": d.get("place_url"),
                "seed": label,
            }
            added += 1
        print(f"  {label}: +{added}  (total {len(all_items)})", file=sys.stderr)
        time.sleep(0.3)

    items = list(all_items.values())[:100]
    out = "/tmp/popular_pois_100.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\nwrote {len(items)} POIs to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
