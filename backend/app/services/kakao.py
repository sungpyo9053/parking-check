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


def reverse_geocode_region(lat: float, lng: float) -> dict | None:
    """좌표 → 행정구역 (region_1depth_name/region_2depth_name/region_3depth_name).

    '강남구', '역삼동' 같은 토큰을 얻어 Tavily 검색 쿼리에 활용한다.
    """
    params = {"x": str(lng), "y": str(lat), "input_coord": "WGS84"}
    with httpx.Client(timeout=5.0) as client:
        r = client.get(
            f"{KAKAO_BASE}/geo/coord2regioncode.json",
            headers=_headers(),
            params=params,
        )
    if r.status_code != 200:
        return None
    docs = r.json().get("documents") or []
    # 행정동 우선 (B = 법정동, H = 행정동)
    h = next((d for d in docs if d.get("region_type") == "H"), None)
    return h or (docs[0] if docs else None)


def search_keyword_near(
    query: str,
    *,
    lat: float,
    lng: float,
    radius_m: int = 1000,
    size: int = 10,
) -> list[dict]:
    """좌표 기반 키워드 검색. 'X 주차' 같은 쿼리를 목적지 근처로 한정해서 호출."""
    size = max(1, min(15, size))
    radius_m = max(1, min(20000, radius_m))
    params = {
        "query": query,
        "x": str(lng),
        "y": str(lat),
        "radius": radius_m,
        "size": size,
        "sort": "distance",
    }
    with httpx.Client(timeout=5.0) as client:
        r = client.get(
            f"{KAKAO_BASE}/search/keyword.json", headers=_headers(), params=params
        )
    if r.status_code != 200:
        raise KakaoAPIError(
            f"Kakao keyword(near) search failed: {r.status_code} {r.text}"
        )
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


def search_category_nearby(
    category_group_code: str,
    lat: float,
    lng: float,
    radius_m: int = 800,
    size: int = 10,
) -> list[dict]:
    """범용 카테고리 검색. SW8(지하철역), BUS(버스정류장 — kakao는 별도 카테고리 없음, 키워드로),
    또는 키워드 검색을 직접 쓰는 게 더 정확한 카테고리도 있음."""
    radius_m = max(1, min(20000, radius_m))
    params = {
        "category_group_code": category_group_code,
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
        raise KakaoAPIError(
            f"Kakao category search ({category_group_code}) failed: {r.status_code} {r.text}"
        )
    return r.json().get("documents", [])
