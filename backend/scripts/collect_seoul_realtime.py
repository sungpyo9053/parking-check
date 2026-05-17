"""서울시 실시간 주차정보 수집기.

cron 예 (5분마다):
  */5 * * * * cd /path/to/parking/backend && /usr/bin/python scripts/collect_seoul_realtime.py >> /tmp/parking_rt.log 2>&1

매칭 룰:
  1순위: source_lot_key + 직전 매칭 캐시 (parking_realtime_status.parking_lot_id 가 이미 채워졌던 적이 있으면 재사용)
  2순위: 이름 정확 일치 + 좌표 100m 이내
  3순위: 좌표 50m 이내 가장 가까운 lot
매칭 실패면 parking_lot_id=NULL 로 적재 (raw_payload 유지).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.services.seoul_realtime import iter_all, normalize_row  # noqa: E402


def find_matching_lot(conn, n: dict) -> int | None:
    # 1) 과거에 같은 source_lot_key 로 매칭됐던 적
    if n.get("source_lot_key"):
        row = conn.execute(
            text(
                """
                SELECT parking_lot_id FROM parking_realtime_status
                WHERE source='seoul_opendata' AND source_lot_key=:k
                  AND parking_lot_id IS NOT NULL
                ORDER BY observed_at DESC
                LIMIT 1
                """
            ),
            {"k": n["source_lot_key"]},
        ).first()
        if row and row[0]:
            return row[0]

    if n.get("source_lat") is None or n.get("source_lng") is None:
        return None

    # 2) 이름 일치 + 100m 이내
    if n.get("source_name"):
        row = conn.execute(
            text(
                """
                SELECT id FROM parking_lots
                WHERE name = :name
                  AND ST_DWithin(
                      geom::geography,
                      ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                      100
                  )
                ORDER BY ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                )
                LIMIT 1
                """
            ),
            {"name": n["source_name"], "lat": n["source_lat"], "lng": n["source_lng"]},
        ).first()
        if row:
            return row[0]

    # 3) 50m 이내 최근접
    row = conn.execute(
        text(
            """
            SELECT id FROM parking_lots
            WHERE ST_DWithin(
                geom::geography,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                50
            )
            ORDER BY ST_Distance(
                geom::geography,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
            )
            LIMIT 1
            """
        ),
        {"lat": n["source_lat"], "lng": n["source_lng"]},
    ).first()
    return row[0] if row else None


def main():
    rows = iter_all()
    print(f"fetched {len(rows)} rows from Seoul OpenAPI")
    inserted = 0
    matched = 0
    with engine.begin() as conn:
        for r in rows:
            n = normalize_row(r)
            if n["available_count"] is None and n["total_capacity"] is None:
                continue
            lot_id = find_matching_lot(conn, n)
            if lot_id:
                matched += 1
            conn.execute(
                text(
                    """
                    INSERT INTO parking_realtime_status
                      (parking_lot_id, source, source_lot_key, observed_at,
                       total_capacity, available_count, occupied_count, raw_payload)
                    VALUES
                      (:lot, 'seoul_opendata', :key, :ts, :total, :avail, :occ, :raw)
                    """
                ),
                {
                    "lot": lot_id,
                    "key": n["source_lot_key"],
                    "ts": n["observed_at"],
                    "total": n["total_capacity"],
                    "avail": n["available_count"],
                    "occ": n["occupied_count"],
                    "raw": json.dumps(n["raw_payload"], ensure_ascii=False),
                },
            )
            inserted += 1
    print(f"inserted {inserted} rows, matched_to_lot={matched}")


if __name__ == "__main__":
    main()
