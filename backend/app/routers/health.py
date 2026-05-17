from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health(db: Session = Depends(get_db)) -> dict:
    db_ok = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        db_ok = f"error: {e}"
    return {
        "status": "ok",
        "db": db_ok,
        "time": datetime.now(timezone.utc).isoformat(),
    }
