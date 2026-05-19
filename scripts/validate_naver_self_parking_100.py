"""네이버 검색에서 '자체주차 가능' 키워드로 매장 100개 자동 수집 → 우리 시스템 분류 정확도 측정.

GT 가정: 모두 자체주차 가능 후보 → "available" 또는 "likely" 로 잡혀야 함.
잡히지 않은 경우를 "miss" 로 집계.

수집 전략:
  Naver Local Search API (display 5 max) 로 다양한 지역 × 카테고리 쿼리.
  쿼리: "{지역} 주차 카페", "{지역} 주차 음식점", "{지역} 자체주차" 등.

각 후보:
  Kakao keyword search 로 정확 좌표 + place_url 확인
  /api/parking/analyze 호출 → self_parking.status, confidence

리포트:
  - status 분포 (목표: available+likely 가 다수)
  - 평균 confidence
  - miss 케이스 (uncertain/unknown/unavailable) 샘플 10개 출력

사용:
  python scripts/validate_naver_self_parking_100.py [--base URL] [--n 100]

환경변수:
  NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, KAKAO_REST_API_KEY
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

NAVER_LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_TAG_RE = re.compile(r"<[^>]+>")


def http_get_json(url: str, headers: dict | None = None, timeout: int = 12) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def strip_tags(s: str | None) -> str:
    if not s:
        return ""
    return _TAG_RE.sub("", s).strip()


def naver_local(query: str, client_id: str, client_secret: str) -> list[dict]:
    params = urllib.parse.urlencode({"query": query, "display": 5, "sort": "comment"})
    url = f"{NAVER_LOCAL_URL}?{params}"
    headers = {"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret}
    try:
        d = http_get_json(url, headers=headers, timeout=8)
    except Exception as e:
        print(f"   ! naver local err for '{query}': {e}", file=sys.stderr)
        return []
    return d.get("items") or []


def kakao_keyword(query: str, kakao_key: str) -> dict | None:
    params = urllib.parse.urlencode({"query": query, "size": 1})
    url = f"{KAKAO_URL}?{params}"
    try:
        d = http_get_json(
            url, headers={"Authorization": f"KakaoAK {kakao_key}"}, timeout=8
        )
    except Exception as e:
        print(f"   ! kakao err for '{query}': {e}", file=sys.stderr)
        return None
    docs = d.get("documents") or []
    return docs[0] if docs else None


REGIONS = [
    "강남",
    "홍대",
    "성수",
    "한남",
    "이태원",
    "연남",
    "익선동",
    "잠실",
    "여의도",
    "압구정",
    "신사",
    "삼청동",
    "북촌",
    "서촌",
    "을지로",
    "용산",
    "신촌",
    "건대",
    "교대",
    "강서",
    "안양",
    "수원",
    "성남",
    "분당",
    "판교",
    "광교",
]
QUERY_TEMPLATES = [
    "{r} 주차 카페",
    "{r} 주차 가능 카페",
    "{r} 자체주차 카페",
    "{r} 주차 음식점",
]


def collect_candidates(client_id: str, client_secret: str, kakao_key: str, n: int):
    seen_titles: set[str] = set()
    out = []
    for tpl in QUERY_TEMPLATES:
        for r in REGIONS:
            if len(out) >= n:
                return out
            q = tpl.format(r=r)
            items = naver_local(q, client_id, client_secret)
            for it in items:
                title = strip_tags(it.get("title"))
                if not title or title in seen_titles:
                    continue
                addr = strip_tags(it.get("roadAddress")) or strip_tags(it.get("address"))
                # naver mapx/mapy 는 KATEC. 우리 분석엔 카카오로 다시 검색해서 정확 좌표.
                kakao_doc = kakao_keyword(f"{title} {r}", kakao_key)
                if not kakao_doc:
                    continue
                try:
                    lat = float(kakao_doc["y"])
                    lng = float(kakao_doc["x"])
                except (KeyError, ValueError):
                    continue
                seen_titles.add(title)
                out.append(
                    {
                        "name": title,
                        "addr": addr,
                        "lat": lat,
                        "lng": lng,
                        "category": kakao_doc.get("category_name"),
                        "kakao_place_url": kakao_doc.get("place_url"),
                        "query": q,
                    }
                )
                if len(out) >= n:
                    return out
                time.sleep(0.12)
            time.sleep(0.2)
    return out


def analyze(base: str, lat: float, lng: float, name: str) -> dict | None:
    params = urllib.parse.urlencode(
        {"lat": lat, "lng": lng, "name": name, "radius": 500}
    )
    url = f"{base}/api/parking/analyze?{params}"
    try:
        return http_get_json(url, timeout=30)
    except Exception as e:
        print(f"   ! analyze err for {name}: {e}", file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--delay", type=float, default=0.25)
    args = ap.parse_args()

    cid = os.environ.get("NAVER_CLIENT_ID")
    csec = os.environ.get("NAVER_CLIENT_SECRET")
    kkey = os.environ.get("KAKAO_REST_API_KEY")
    if not (cid and csec and kkey):
        print(
            "ERROR: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, KAKAO_REST_API_KEY required",
            file=sys.stderr,
        )
        return 2

    print(f"== collect {args.n} '자체주차 가능' 후보 from Naver Local ==")
    cands = collect_candidates(cid, csec, kkey, args.n)
    print(f"   collected {len(cands)}\n")

    if not cands:
        print("no candidates", file=sys.stderr)
        return 1

    print(f"== analyze against {args.base} ==")
    print(
        f"{'#':>3} {'STATUS':<12} {'CONF':>4} {'EV':>3} {'NAME':<30} {'CATEGORY':<28}"
    )
    print("-" * 100)
    results = []
    for i, c in enumerate(cands, 1):
        d = analyze(args.base, c["lat"], c["lng"], c["name"])
        if not d:
            results.append({**c, "status": "ERR", "confidence": 0, "evidence_n": 0})
            time.sleep(args.delay)
            continue
        sp = d.get("self_parking") or {}
        s = sp.get("status") or "unknown"
        conf = sp.get("confidence") or 0
        evn = len(sp.get("evidence") or [])
        cat_short = (c.get("category") or "")[:28]
        name_short = (c["name"] or "")[:30]
        print(f"{i:>3} {s:<12} {conf:>4} {evn:>3} {name_short:<30} {cat_short:<28}")
        results.append(
            {
                **c,
                "status": s,
                "confidence": conf,
                "evidence_n": evn,
                "top_rec_name": (
                    (d.get("top_recommendation") or {}).get("candidate", {}).get("name")
                ),
            }
        )
        time.sleep(args.delay)

    n = len(results)
    counts = Counter(r["status"] for r in results)
    pos = counts.get("available", 0) + counts.get("likely", 0)
    avg_conf = sum(r["confidence"] for r in results) / n if n else 0

    print("\n" + "=" * 50)
    print(f"분포 ({n}건):")
    for k in ["available", "likely", "uncertain", "unavailable", "unknown", "ERR"]:
        v = counts.get(k, 0)
        pct = 100 * v / n if n else 0
        print(f"  {k:<14} {v:>4}  ({pct:5.1f}%)")
    print(f"\nGT=자체주차 가능 후보 기준 적중률 (available+likely): {pos}/{n} = {100*pos/n:.1f}%")
    print(f"평균 confidence: {avg_conf:.1f}")

    # miss 케이스 10개 샘플 (uncertain/unknown)
    misses = [r for r in results if r["status"] in ("uncertain", "unknown", "unavailable")]
    print(f"\n[Miss 샘플 ({len(misses)}건 중 최대 10개)]")
    for r in misses[:10]:
        print(
            f"  - {r['status']:<11} conf={r['confidence']:>3} ev={r['evidence_n']} | {r['name']} | {r.get('category','')}"
        )

    # 결과 JSON 덤프
    out_path = "/tmp/naver_self_parking_100_result.json"
    with open(out_path, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n결과 JSON: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
