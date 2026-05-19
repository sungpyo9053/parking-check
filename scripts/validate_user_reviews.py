"""실 사용자 후기 데이터 기반 검증.

ground truth = Naver 블로그/카페 + Tavily 에서 사람들이 실제로 "X 가서 Y 주차장에
댔다" 형태로 언급한 주차장 이름. 카카오 PK6 등록 데이터가 아닌 실 이용 후기.

평가:
  - 우리 top_recommendation 이 사용자 후기에 언급된 주차장 이름과 매칭되는가
  - 매칭 종류: exact (이름 같음) / fuzzy (4-gram 일치) / 거리 매칭 / 없음
  - "자체 주차" / "매장 주차" / "건물 주차" 같은 자체 시그널 비율
  - 사용자 데이터가 0건인 POI 비율 (Tavily/Naver 도 모르는 매장)

사용:
  NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... [TAVILY_API_KEY=...] \\
    python scripts/validate_user_reviews.py [--limit 100]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from urllib.parse import urlencode

import urllib.request

POI_FILE = "/tmp/popular_pois_100.json"
OUT_FILE = "/tmp/user_reviews_validation.json"

_TAG_RE = re.compile(r"<[^>]+>")
_NORM_RE = re.compile(r"[\s\-_·,()/\\\[\]]+")

# 주차장 이름 추출 패턴 (사용자 후기에 흔히 등장)
_PARK_NAME_RE = re.compile(
    r"([가-힣A-Za-z0-9]{2,18}(?:공영주차장|민영주차장|유료주차장|공영|주차타워|주차장|파킹|주차빌딩))"
)

# 자체 / 건물 주차 시그널
_SELF_PARKING_RE = re.compile(
    r"(전용\s*주차|매장\s*앞\s*주차|건물\s*(?:내|지하)?\s*주차|지하\s*주차장|"
    r"무료\s*주차|매장에\s*주차|가게\s*앞\s*주차|입구\s*앞\s*주차|"
    r"바로\s*앞\s*주차|타워\s*주차장|빌딩\s*주차장)"
)

# 사용자가 명확히 이용했다는 동사
_USED_RE = re.compile(r"(주차했|댔|이용했|이용\s*가능|주차\s*가능|주차 OK)")


def strip_html(s: str | None) -> str:
    if not s:
        return ""
    s = _TAG_RE.sub("", s)
    return (
        s.replace("&quot;", '"').replace("&amp;", "&")
        .replace("&lt;", "<").replace("&gt;", ">")
        .replace("&nbsp;", " ").strip()
    )


def norm(s: str) -> str:
    return _NORM_RE.sub("", (s or "")).lower()


def http_get_json(url: str, timeout: int = 30, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def naver_blog_cafe(client_id: str, client_secret: str, query: str, display: int = 10) -> list[dict]:
    items: list[dict] = []
    for url in ("https://openapi.naver.com/v1/search/blog.json", "https://openapi.naver.com/v1/search/cafearticle.json"):
        try:
            d = http_get_json(
                f"{url}?{urlencode({'query': query, 'display': display, 'sort': 'sim'})}",
                headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret},
            )
        except Exception:
            continue
        for it in d.get("items") or []:
            items.append({
                "title": strip_html(it.get("title")),
                "snippet": strip_html(it.get("description")),
                "url": (it.get("link") or "").strip(),
            })
    return items


def tavily_search(api_key: str, query: str, max_results: int = 6) -> list[dict]:
    body = {"query": query, "search_depth": "basic", "max_results": max_results, "include_answer": False}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        req = urllib.request.Request("https://api.tavily.com/search", data=json.dumps(body).encode(),
                                     headers={**headers}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception:
        return []
    out = []
    for r in d.get("results") or []:
        if isinstance(r, dict):
            out.append({"title": r.get("title") or "", "snippet": r.get("content") or "",
                        "url": (r.get("url") or "").strip()})
    return out


def extract_user_parking_mentions(text: str) -> list[str]:
    """사용자가 후기에 적은 주차장 이름들 (중복 제거, 순서 유지)."""
    found = _PARK_NAME_RE.findall(text)
    seen: set[str] = set()
    out: list[str] = []
    for f in found:
        n = norm(f)
        if not n or n in seen:
            continue
        # 매우 일반적인 단어만 (예: "주차장" 그 자체) 제외
        if len(n) < 3:
            continue
        seen.add(n)
        out.append(f)
    return out


def fuzzy_match(a: str, b: str) -> bool:
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return False
    if na in nb or nb in na:
        return True
    for i in range(len(na) - 3):
        if na[i : i + 4] in nb:
            return True
    return False


def has_self_signal(text: str) -> bool:
    return bool(_SELF_PARKING_RE.search(text or ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://reviewdr.kr")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--delay", type=float, default=0.3)
    args = ap.parse_args()

    naver_id = os.environ.get("NAVER_CLIENT_ID")
    naver_secret = os.environ.get("NAVER_CLIENT_SECRET")
    tavily_key = os.environ.get("TAVILY_API_KEY")
    if not naver_id or not naver_secret:
        print("ERROR: NAVER_CLIENT_ID/SECRET env required", file=sys.stderr)
        return 1

    try:
        with open(POI_FILE, encoding="utf-8") as f:
            pois = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {POI_FILE} not found", file=sys.stderr)
        return 1

    pois = pois[: args.limit]
    print(f"== user-reviews validating {len(pois)} POIs ==\n", flush=True)
    print(f"{'#':>3} {'POI':<26} {'reviews':<8} {'self?':<5} {'mentions':<9} {'match':<14} our_top", flush=True)
    print("-" * 130, flush=True)

    rows = []
    for i, p in enumerate(pois, 1):
        name = p["name"]
        # 1) 우리 시스템 top_rec
        try:
            sr = http_get_json(args.base + "/api/places/search?" + urlencode({"query": name, "size": 3}), timeout=15)
        except Exception:
            continue
        items = sr.get("items") or []
        if not items:
            continue
        pid = items[0]["place_id"]
        try:
            an = http_get_json(args.base + f"/api/parking/analyze?place_id={pid}&radius=500", timeout=60)
        except Exception:
            continue
        tr = an.get("top_recommendation") or {}
        tr_c = (tr or {}).get("candidate") or {}
        our_top = tr_c.get("name")
        our_self_match = any("목적지명" in r for r in (tr_c.get("usability_reasons") or []))
        sp_status = (an.get("self_parking") or {}).get("status")

        # 2) 사용자 후기 — Naver 우선, Tavily 보조 (한도 살아있으면)
        reviews = naver_blog_cafe(naver_id, naver_secret, f"{name} 주차", display=10)
        if tavily_key and len(reviews) < 5:
            reviews += tavily_search(tavily_key, f"{name} 주차", max_results=6)

        all_text = " ".join(r["title"] + " " + r["snippet"] for r in reviews)
        mentions = extract_user_parking_mentions(all_text)
        self_signal = has_self_signal(all_text)
        used_signal = bool(_USED_RE.search(all_text))

        # 3) 매칭
        match = "no_data"
        if reviews:
            if our_self_match:
                # 우리가 자체 매칭한 경우 — 후기에 self 시그널 있으면 OK
                match = "self_signal_ok" if self_signal else "self_unverified"
            elif our_top and mentions:
                # 우리 top 이름이 후기 언급 목록과 매칭되는가
                if any(fuzzy_match(our_top, m) for m in mentions):
                    match = "match"
                else:
                    match = "mismatch"
            elif our_top and not mentions:
                match = "no_mention_for_compare"
            else:
                match = "no_top"

        rows.append({
            "i": i, "name": name, "sp_status": sp_status,
            "our_top": our_top, "our_self_match": our_self_match,
            "reviews": len(reviews), "mentions": mentions[:5],
            "self_signal": self_signal, "used_signal": used_signal,
            "match": match,
        })
        ms = "✓" if match == "match" else ("✪" if match == "self_signal_ok" else ("✗" if match == "mismatch" else "·"))
        print(
            f"{i:>3} {name[:26]:<26} {len(reviews):<8} {('Y' if self_signal else '-'):<5} "
            f"{len(mentions):<9} {match[:14]:<14} {ms} {(our_top or '-')[:30]}",
            flush=True,
        )
        time.sleep(args.delay)

    # 집계
    print("\n" + "=" * 100, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 100, flush=True)
    total = len(rows)
    if total == 0:
        print("(no samples)"); return 1

    by_match = Counter(r["match"] for r in rows)
    have_data = sum(1 for r in rows if r["match"] != "no_data")
    matched = by_match.get("match", 0) + by_match.get("self_signal_ok", 0)
    self_matched = sum(1 for r in rows if r["our_self_match"])
    self_signal_pct = sum(1 for r in rows if r["self_signal"]) / total
    avg_reviews = sum(r["reviews"] for r in rows) / total
    avg_mentions = sum(len(r["mentions"]) for r in rows) / total

    print(f"total                          : {total}")
    print(f"후기 데이터 있음               : {have_data}/{total} = {have_data/total:.1%}")
    print(f"우리 추천이 후기와 일치        : {matched}/{have_data} = {(matched/have_data if have_data else 0):.1%}")
    print(f"  · 주차장명 매칭(match)        : {by_match.get('match', 0)}")
    print(f"  · 자체 시그널 일치(self_sig)  : {by_match.get('self_signal_ok', 0)}")
    print(f"  · 불일치(mismatch)            : {by_match.get('mismatch', 0)}")
    print(f"  · 우리 자체 매칭(unverified)  : {by_match.get('self_unverified', 0)}")
    print(f"  · 후기엔 주차장명 없음        : {by_match.get('no_mention_for_compare', 0)}")
    print(f"우리가 self 매칭한 POI         : {self_matched}/{total}")
    print(f"후기에 자체주차 시그널 등장률  : {self_signal_pct:.1%}")
    print(f"POI당 평균 후기수 / 언급된 주차장수 : {avg_reviews:.1f} / {avg_mentions:.1f}")

    # mismatch 예시
    mismatches = [r for r in rows if r["match"] == "mismatch"][:6]
    if mismatches:
        print("\nMISMATCH 예시 (top 6):")
        for r in mismatches:
            print(f"  - {r['name']}")
            print(f"      우리 추천   : {r['our_top']}")
            print(f"      후기 언급   : {r['mentions'][:5]}")

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"\nraw: {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
