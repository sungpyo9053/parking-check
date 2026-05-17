"""서울시 실시간 주차정보 OpenAPI.

데이터셋: data.seoul.go.kr → "서울시 주차장 정보 OpenAPI" (GetParkInfo / GetParkingInfo)
TODO: 사용자가 받은 인증키 종류(API 이름)에 따라 URL/필드명이 살짝 다르다.
가장 흔히 쓰는 GetParkInfo 기준으로 작성. 필요시 service 이름만 바꿔라.

URL 패턴 (json):
  http://openapi.seoul.go.kr:8088/{KEY}/json/{SERVICE}/{START}/{END}/

응답 필드(서비스별 상이):
  PKLT_NM (주차장명), ADDR (주소), LAT, LOT (위/경도),
  TPKCT (총 주차면), NOW_PRK_VHCL_CNT (현재 주차 차량 수), CAPACITY ...
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import get_settings

SEOUL_BASE = "http://openapi.seoul.go.kr:8088"
SERVICE = "GetParkInfo"  # TODO: 실제 신청한 서비스명으로 교체


def fetch_page(start: int, end: int) -> dict[str, Any]:
    key = get_settings().SEOUL_OPENAPI_KEY
    if not key:
        raise RuntimeError("SEOUL_OPENAPI_KEY 가 비어있습니다.")
    url = f"{SEOUL_BASE}/{key}/json/{SERVICE}/{start}/{end}/"
    with httpx.Client(timeout=10.0) as client:
        r = client.get(url)
    r.raise_for_status()
    return r.json()


def iter_all(page_size: int = 1000, max_pages: int = 20) -> list[dict]:
    """전 페이지 수집. 한 번에 1000건씩 끊어서 가져옴."""
    rows: list[dict] = []
    for i in range(max_pages):
        start = i * page_size + 1
        end = (i + 1) * page_size
        payload = fetch_page(start, end)
        # 서비스명 기준으로 동적 키 접근
        block = payload.get(SERVICE) or next(iter(payload.values()), {})
        page_rows = block.get("row") or []
        if not page_rows:
            break
        rows.extend(page_rows)
        if len(page_rows) < page_size:
            break
    return rows


def normalize_row(row: dict) -> dict:
    """서울 응답 → 우리 parking_realtime_status 컬럼 형태로 정규화.
    필드명은 서비스에 따라 달라질 수 있어 가능한 후보를 모두 시도한다.
    """
    def pick(*keys: str) -> Any:
        for k in keys:
            if k in row and row[k] not in (None, "", "null"):
                return row[k]
        return None

    def as_int(v: Any) -> int | None:
        try:
            return int(str(v).strip()) if v is not None else None
        except (TypeError, ValueError):
            return None

    name = pick("PKLT_NM", "PARKING_NAME", "PRK_NM")
    addr = pick("ADDR", "PARKING_ADDR")
    lat = pick("LAT")
    lng = pick("LOT", "LNG", "LON")
    total = as_int(pick("TPKCT", "CAPACITY", "PRK_STTS_YN_FREE"))
    now_used = as_int(pick("NOW_PRK_VHCL_CNT", "PRK_CMPRT_USE_CO"))
    available = None
    if total is not None and now_used is not None:
        available = max(0, total - now_used)

    return {
        "source_lot_key": str(pick("PKLT_CD", "PRK_CMPRT_NO", name) or ""),
        "source_name": name,
        "source_addr": addr,
        "source_lat": float(lat) if lat else None,
        "source_lng": float(lng) if lng else None,
        "total_capacity": total,
        "available_count": available,
        "occupied_count": now_used,
        "observed_at": datetime.now(tz=timezone.utc),
        "raw_payload": row,
    }
