from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def nearby_parking_lots(
    db: Session, lat: float, lng: float, radius_m: int = 500, limit: int = 30
) -> list[dict]:
    """PostGIS ST_DWithin 으로 반경 검색, 거리순 정렬.
    geography 캐스팅으로 m 단위 거리를 계산한다.
    """
    sql = text(
        """
        SELECT
            id, name, type, parking_type,
            road_address, jibun_address,
            lat, lng,
            capacity, fee_type, base_time, base_fee, extra_time, extra_fee,
            weekday_open_time, weekday_close_time,
            saturday_open_time, saturday_close_time,
            holiday_open_time, holiday_close_time,
            ROUND(
                ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                )
            )::int AS distance_m
        FROM parking_lots
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
            :radius
        )
        ORDER BY distance_m ASC
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql, {"lat": lat, "lng": lng, "radius": radius_m, "limit": limit}
    ).mappings().all()
    return [dict(r) for r in rows]


def latest_realtime_for_lots(db: Session, lot_ids: list[int]) -> dict[int, dict]:
    """주어진 lot id 들에 대해 가장 최근 실시간 상태 1건씩."""
    if not lot_ids:
        return {}
    sql = text(
        """
        SELECT DISTINCT ON (parking_lot_id)
            parking_lot_id, source, observed_at,
            total_capacity, available_count, occupied_count
        FROM parking_realtime_status
        WHERE parking_lot_id = ANY(:ids)
        ORDER BY parking_lot_id, observed_at DESC
        """
    )
    rows = db.execute(sql, {"ids": lot_ids}).mappings().all()
    return {r["parking_lot_id"]: dict(r) for r in rows}
