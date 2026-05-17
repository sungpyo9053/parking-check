from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def personal_stats_for_lots(db: Session, lot_ids: list[int]) -> dict[int, dict]:
    if not lot_ids:
        return {}
    sql = text(
        """
        SELECT
            selected_parking_lot_id AS lot_id,
            COUNT(*) FILTER (WHERE actual_result = 'success') AS success,
            COUNT(*) FILTER (
                WHERE actual_result IN ('full','closed','entrance_lost','fee_mismatch','waited')
            ) AS fail,
            COUNT(*) AS total,
            MAX(searched_at) AS last_visit_at,
            MAX(actual_result) FILTER (WHERE actual_result IS NOT NULL) AS last_result
        FROM parking_visit_logs
        WHERE selected_parking_lot_id = ANY(:ids)
        GROUP BY selected_parking_lot_id
        """
    )
    rows = db.execute(sql, {"ids": lot_ids}).mappings().all()
    return {r["lot_id"]: dict(r) for r in rows}


def history_for_place(db: Session, place_id: int, limit: int = 10) -> list[dict]:
    sql = text(
        """
        SELECT id AS visit_id, selected_parking_name, searched_at,
               actual_result, memo
        FROM parking_visit_logs
        WHERE destination_place_id = :pid
        ORDER BY searched_at DESC
        LIMIT :limit
        """
    )
    return [dict(r) for r in db.execute(sql, {"pid": place_id, "limit": limit}).mappings()]


def history_near_coords(
    db: Session, lat: float, lng: float, tolerance_m: int = 100, limit: int = 10
) -> list[dict]:
    sql = text(
        """
        SELECT id AS visit_id, destination_name, selected_parking_name, searched_at,
               actual_result, memo
        FROM parking_visit_logs
        WHERE destination_lat IS NOT NULL AND destination_lng IS NOT NULL
          AND ST_DWithin(
                ST_SetSRID(ST_MakePoint(destination_lng, destination_lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                :tol
              )
        ORDER BY searched_at DESC
        LIMIT :limit
        """
    )
    return [
        dict(r)
        for r in db.execute(
            sql, {"lat": lat, "lng": lng, "tol": tolerance_m, "limit": limit}
        ).mappings()
    ]
