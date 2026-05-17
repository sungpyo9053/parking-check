from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import discover, favorites, health, parking, places, visits

settings = get_settings()

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
