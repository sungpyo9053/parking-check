from __future__ import annotations

import gzip
import os
import re
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(prefix="/api/stats", tags=["stats"])

_ACCESS_LOGS = [
    "/var/log/nginx/access.log",
    "/var/log/nginx/access.log.1",
    *[f"/var/log/nginx/access.log.{i}.gz" for i in range(2, 15)],
]
_LOG_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] "(?P<method>\S+) '
    r'(?P<path>\S+)(?: [^"]*)?" (?P<status>\d{3}) \S+ "[^"]*" "(?P<ua>[^"]*)"'
)
_BOT_RE = re.compile(
    r"bot|crawler|spider|zgrab|curl|python|go-http-client|headless|httpclient|"
    r"scan|masscan|nmap|wget|semrush|ahrefs|libredtail|genomecrawler",
    re.I,
)


def _read_security_log_stats(days: int) -> dict:
    tz = ZoneInfo("Asia/Seoul")
    start = (datetime.now(tz) - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    suspicious_paths: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    bot_or_scan_requests = 0
    total_requests = 0

    try:
        for path in _ACCESS_LOGS:
            if not os.path.exists(path):
                continue
            opener = gzip.open if path.endswith(".gz") else open
            with opener(path, "rt", errors="ignore") as f:
                for line in f:
                    m = _LOG_RE.match(line)
                    if not m:
                        continue
                    dt = datetime.strptime(
                        m.group("ts"), "%d/%b/%Y:%H:%M:%S %z"
                    ).astimezone(tz)
                    if dt < start:
                        continue
                    total_requests += 1
                    clean_path = m.group("path").split("?", 1)[0]
                    ua = m.group("ua") or ""
                    status = m.group("status")
                    is_probe = (
                        _BOT_RE.search(ua) is not None
                        or clean_path.startswith("/.")
                        or clean_path
                        in {
                            "/developmentserver/metadatauploader",
                            "/index.php",
                            "/phpinfo.php",
                        }
                        or clean_path.startswith(("/cgi-bin/", "/vendor/"))
                    )
                    if is_probe:
                        bot_or_scan_requests += 1
                        suspicious_paths[clean_path] += 1
                    status_counts[status] += 1
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": str(e)}

    return {
        "available": True,
        "total_requests": total_requests,
        "bot_or_scan_requests": bot_or_scan_requests,
        "top_suspicious_paths": [
            {"path": p, "count": c} for p, c in suspicious_paths.most_common(10)
        ],
        "status_counts": [
            {"status": s, "count": c} for s, c in status_counts.most_common()
        ],
    }


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

    popular_segments = {
        "self_parking_likely": [
            {"place_name": r["place_name"], "count": r["count"]}
            for r in db.execute(
                text(
                    """
                    WITH bounds AS (
                        SELECT
                            ((now() AT TIME ZONE 'Asia/Seoul')::date
                                - (:days - 1) * interval '1 day') AS start_day,
                            ((now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day')
                                AS end_day
                    )
                    SELECT place_name, count(*) AS count
                    FROM search_logs, bounds
                    WHERE place_name IS NOT NULL
                      AND place_name <> ''
                      AND self_parking_status IN ('available', 'likely')
                      AND (searched_at AT TIME ZONE 'Asia/Seoul') >= bounds.start_day
                      AND (searched_at AT TIME ZONE 'Asia/Seoul') < bounds.end_day
                    GROUP BY place_name
                    ORDER BY count DESC, place_name
                    LIMIT 6
                    """
                ),
                params,
            ).mappings()
        ],
        "parking_hard": [
            {"place_name": r["place_name"], "count": r["count"]}
            for r in db.execute(
                text(
                    """
                    WITH bounds AS (
                        SELECT
                            ((now() AT TIME ZONE 'Asia/Seoul')::date
                                - (:days - 1) * interval '1 day') AS start_day,
                            ((now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day')
                                AS end_day
                    )
                    SELECT place_name, count(*) AS count
                    FROM search_logs, bounds
                    WHERE place_name IS NOT NULL
                      AND place_name <> ''
                      AND (
                        self_parking_status IN ('uncertain', 'unavailable', 'unknown')
                        OR top_recommendation_name IS NOT NULL
                      )
                      AND self_parking_status IS DISTINCT FROM 'place_search'
                      AND (searched_at AT TIME ZONE 'Asia/Seoul') >= bounds.start_day
                      AND (searched_at AT TIME ZONE 'Asia/Seoul') < bounds.end_day
                    GROUP BY place_name
                    ORDER BY count DESC, place_name
                    LIMIT 6
                    """
                ),
                params,
            ).mappings()
        ],
        "alternative_recommended": [
            {
                "place_name": r["place_name"],
                "parking_name": r["top_recommendation_name"],
                "count": r["count"],
            }
            for r in db.execute(
                text(
                    """
                    WITH bounds AS (
                        SELECT
                            ((now() AT TIME ZONE 'Asia/Seoul')::date
                                - (:days - 1) * interval '1 day') AS start_day,
                            ((now() AT TIME ZONE 'Asia/Seoul')::date + interval '1 day')
                                AS end_day
                    )
                    SELECT place_name, top_recommendation_name, count(*) AS count
                    FROM search_logs, bounds
                    WHERE place_name IS NOT NULL
                      AND place_name <> ''
                      AND top_recommendation_name IS NOT NULL
                      AND top_recommendation_name <> ''
                      AND (searched_at AT TIME ZONE 'Asia/Seoul') >= bounds.start_day
                      AND (searched_at AT TIME ZONE 'Asia/Seoul') < bounds.end_day
                    GROUP BY place_name, top_recommendation_name
                    ORDER BY count DESC, place_name
                    LIMIT 6
                    """
                ),
                params,
            ).mappings()
        ],
    }

    parking_data = db.execute(
        text(
            """
            SELECT
                count(*) AS parking_lot_count,
                max(data_reference_date) AS latest_data_reference_date,
                max(created_at) AS latest_created_at
            FROM parking_lots
            """
        )
    ).mappings().one()

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
        "popular_segments": popular_segments,
        "parking_data": {
            "parking_lot_count": parking_data["parking_lot_count"],
            "latest_data_reference_date": (
                parking_data["latest_data_reference_date"].isoformat()
                if parking_data["latest_data_reference_date"]
                else None
            ),
            "latest_created_at": (
                parking_data["latest_created_at"].isoformat()
                if parking_data["latest_created_at"]
                else None
            ),
            "needs_import": parking_data["parking_lot_count"] == 0,
        },
        "security": _read_security_log_stats(days),
    }
