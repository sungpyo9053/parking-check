from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect

from .config import get_settings
from .db import engine
from .models import SearchLog
from .routers import discover, favorites, health, parking, places, visits

settings = get_settings()

# search_logs 신규 테이블은 alembic 없이 부팅 시 자동 생성.
# 다른 큰 스키마(parking_lots/PostGIS 등)는 절대 건드리지 않음.
try:
    if not inspect(engine).has_table(SearchLog.__tablename__):
        SearchLog.__table__.create(bind=engine, checkfirst=True)
        logging.getLogger(__name__).info("created table %s", SearchLog.__tablename__)
except Exception as e:  # noqa: BLE001
    logging.getLogger(__name__).warning("search_logs auto-create skipped: %s", e)

app = FastAPI(
    title="주차될까 backend",
    version="0.0.1",
    description="개인용 주차 판단 PWA의 백엔드",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(places.router)
app.include_router(parking.router)
app.include_router(visits.router)
app.include_router(discover.router)
app.include_router(favorites.router)


@app.get("/")
def root() -> dict:
    return {"name": "주차될까", "docs": "/docs"}
