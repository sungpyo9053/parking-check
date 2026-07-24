from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/usage")
def usage_stats(
    days: int = Query(7, ge=1, le=31),
    db: Session = Depends(get_db),
) -> dict:
    """Aggregated usage analytics from search_logs.

    This intentionally returns only counts and place/search terms. It does not expose
    raw user tokens, user agents, referers, or IP addresses.
    """
    params = {"days": days}
    daily_rows = db.execute(
        text(
            """
            WITH bounds AS (
                SELECT
                    ((now() AT TIME ZONE 'Asia/Seoul')::date - (:days - 1) * interval '1 day')
                        AS start_day,
                    ((now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day')
                        AS end_day
            )
            SELECT
                (searched_at AT TIME ZONE 'Asia/Seoul')::date AS day,
                count(*) AS total_events,
                count(*) FILTER (WHERE self_parking_status = 'place_search') AS place_searches,
                count(*) FILTER (
                    WHERE self_parking_status IS DISTINCT FROM 'place_search'
                ) AS parking_analyses,
                count(DISTINCT user_token) FILTER (
                    WHERE user_token IS NOT NULL AND user_token <> ''
                ) AS unique_tokens
            FROM search_logs, bounds
            WHERE (searched_at AT TIME ZONE 'Asia/Seoul') >= bounds.start_day
              AND (searched_at AT TIME ZONE 'Asia/Seoul') < bounds.end_day
            GROUP BY 1
            ORDER BY 1
            """
        ),
        params,
    ).mappings().all()

    top_searches = db.execute(
        text(
            """
            WITH bounds AS (
                SELECT
                    ((now() AT TIME ZONE 'Asia/Seoul')::date - (:days - 1) * interval '1 day')
                        AS start_day,
                    ((now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day')
                        AS end_day
            )
            SELECT
                place_name,
                count(*) AS count
            FROM search_logs, bounds
            WHERE place_name IS NOT NULL
              AND place_name <> ''
              AND (searched_at AT TIME ZONE 'Asia/Seoul') >= bounds.start_day
              AND (searched_at AT TIME ZONE 'Asia/Seoul') < bounds.end_day
            GROUP BY place_name
            ORDER BY count DESC, place_name
            LIMIT 10
            """
        ),
        params,
    ).mappings().all()

    totals = {
        "total_events": sum(r["total_events"] for r in daily_rows),
        "place_searches": sum(r["place_searches"] for r in daily_rows),
        "parking_analyses": sum(r["parking_analyses"] for r in daily_rows),
        "unique_tokens": db.execute(
            text(
                """
                WITH bounds AS (
                    SELECT
                        ((now() AT TIME ZONE 'Asia/Seoul')::date
                            - (:days - 1) * interval '1 day') AS start_day,
                        ((now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day')
                            AS end_day
                )
                SELECT count(DISTINCT user_token)
                FROM search_logs, bounds
                WHERE user_token IS NOT NULL
                  AND user_token <> ''
                  AND (searched_at AT TIME ZONE 'Asia/Seoul') >= bounds.start_day
                  AND (searched_at AT TIME ZONE 'Asia/Seoul') < bounds.end_day
                """
            ),
            params,
        ).scalar_one(),
    }

    return {
        "days": days,
        "timezone": "Asia/Seoul",
        "totals": totals,
        "daily": [
            {
                "date": r["day"].isoformat(),
                "total_events": r["total_events"],
                "place_searches": r["place_searches"],
                "parking_analyses": r["parking_analyses"],
                "unique_tokens": r["unique_tokens"],
            }
            for r in daily_rows
        ],
        "top_searches": [
            {"place_name": r["place_name"], "count": r["count"]} for r in top_searches
        ],
    }
