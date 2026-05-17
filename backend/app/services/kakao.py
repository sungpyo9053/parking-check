"""Kakao Local REST API 프록시.

문서: https://developers.kakao.com/docs/latest/ko/local/dev-guide
- 키워드 검색: GET https://dapi.kakao.com/v2/local/search/keyword.json
- 카테고리 검색(주차장 PK6): GET https://dapi.kakao.com/v2/local/search/category.json
"""
from __future__ import annotations

import httpx

from ..config import get_settings

KAKAO_BASE = "https://dapi.kakao.com/v2/local"


class KakaoAPIError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    key = get_settings().KAKAO_REST_API_KEY
    if not key:
        raise KakaoAPIError("KAKAO_REST_API_KEY 가 비어있습니다. .env 를 확인하세요.")
    return {"Authorization": f"KakaoAK {key}"}


def search_keyword(query: str, size: int = 10) -> list[dict]:
    size = max(1, min(15, size))
    params = {"query": query, "size": size}
    with httpx.Client(timeout=5.0) as client:
        r = client.get(
            f"{KAKAO_BASE}/search/keyword.json", headers=_headers(), params=params
        )
    if r.status_code != 200:
        raise KakaoAPIError(f"Kakao keyword search failed: {r.status_code} {r.text}")
    return r.json().get("documents", [])


def search_parking_nearby(lat: float, lng: float, radius_m: int = 500, size: int = 15) -> list[dict]:
    """category_group_code=PK6 으로 주차장 카테고리 후보 검색 (보조용)."""
    radius_m = max(1, min(20000, radius_m))
    params = {
        "category_group_code": "PK6",
        "x": str(lng),
        "y": str(lat),
        "radius": radius_m,
        "size": size,
        "sort": "distance",
    }
    with httpx.Client(timeout=5.0) as client:
        r = client.get(
            f"{KAKAO_BASE}/search/category.json", headers=_headers(), params=params
        )
    if r.status_code != 200:
        raise KakaoAPIError(f"Kakao category search failed: {r.status_code} {r.text}")
    return r.json().get("documents", [])
