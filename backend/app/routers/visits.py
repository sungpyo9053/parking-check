from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ParkingVisitLog
from ..schemas.visit import (
    VisitCreate,
    VisitListResponse,
    VisitOut,
    VisitResultUpdate,
)
from ..services.visit_history import history_for_place, history_near_coords

router = APIRouter(prefix="/api/visits", tags=["visits"])


@router.post("", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def create_visit(body: VisitCreate, db: Session = Depends(get_db)) -> VisitOut:
    log = ParkingVisitLog(**body.model_dump(exclude_unset=True))
    db.add(log)
    db.commit()
    db.refresh(log)
    return VisitOut.model_validate(log)


@router.patch("/{visit_id}/result", response_model=VisitOut)
def update_result(
    visit_id: int, body: VisitResultUpdate, db: Session = Depends(get_db)
) -> VisitOut:
    log = db.get(ParkingVisitLog, visit_id)
    if log is None:
        raise HTTPException(status_code=404, detail="visit not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(log, k, v)
    log.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(log)
    return VisitOut.model_validate(log)


@router.get("", response_model=VisitListResponse)
def list_visits(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> VisitListResponse:
    rows = db.execute(
        select(ParkingVisitLog)
        .order_by(ParkingVisitLog.searched_at.desc())
        .limit(limit)
        .offset(offset)
    ).scalars().all()
    return VisitListResponse(
        count=len(rows), items=[VisitOut.model_validate(r) for r in rows]
    )


@router.get("/by-place", response_model=VisitListResponse)
def by_place(
    place_id: int | None = Query(None),
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    tolerance_m: int = Query(100, ge=10, le=2000),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> VisitListResponse:
    if place_id is not None:
        rows = db.execute(
            select(ParkingVisitLog)
            .where(ParkingVisitLog.destination_place_id == place_id)
            .order_by(ParkingVisitLog.searched_at.desc())
            .limit(limit)
        ).scalars().all()
        items = [VisitOut.model_validate(r) for r in rows]
    elif lat is not None and lng is not None:
        # geo 근접 매칭 — id 만 뽑아 다시 ORM 로드
        rows_dicts = history_near_coords(db, lat=lat, lng=lng, tolerance_m=tolerance_m, limit=limit)
        ids = [r["visit_id"] for r in rows_dicts]
        if not ids:
            return VisitListResponse(count=0, items=[])
        rows = db.execute(
            select(ParkingVisitLog).where(ParkingVisitLog.id.in_(ids))
            .order_by(ParkingVisitLog.searched_at.desc())
        ).scalars().all()
        items = [VisitOut.model_validate(r) for r in rows]
    else:
        raise HTTPException(status_code=400, detail="place_id 또는 lat+lng 가 필요합니다.")
    return VisitListResponse(count=len(items), items=items)


@router.get("/by-parking-lot", response_model=VisitListResponse)
def by_parking_lot(
    parking_lot_id: int = Query(...),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> VisitListResponse:
    rows = db.execute(
        select(ParkingVisitLog)
        .where(ParkingVisitLog.selected_parking_lot_id == parking_lot_id)
        .order_by(ParkingVisitLog.searched_at.desc())
        .limit(limit)
    ).scalars().all()
    return VisitListResponse(
        count=len(rows), items=[VisitOut.model_validate(r) for r in rows]
    )
