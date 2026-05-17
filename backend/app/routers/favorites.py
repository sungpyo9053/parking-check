"""공유 즐겨찾기 — group code 기반 (가입 없이)."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import FavoriteGroup, FavoriteItem
from ..schemas.favorite import (
    FavoriteGroupCreate,
    FavoriteGroupDetail,
    FavoriteGroupOut,
    FavoriteItemCreate,
    FavoriteItemOut,
)

router = APIRouter(prefix="/api/favorites", tags=["favorites"])

_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{4,32}$")
_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 글자 제외 (I, O, 0, 1)


def _gen_code(n: int = 8) -> str:
    return "".join(secrets.choice(_ALPHA) for _ in range(n))


def _get_group_or_404(db: Session, code: str) -> FavoriteGroup:
    if not _CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="invalid code format")
    g = db.execute(
        select(FavoriteGroup).where(FavoriteGroup.code == code.upper())
    ).scalar_one_or_none()
    if g is None:
        raise HTTPException(status_code=404, detail="group not found")
    return g


@router.post("/groups", response_model=FavoriteGroupOut, status_code=201)
def create_group(body: FavoriteGroupCreate, db: Session = Depends(get_db)) -> FavoriteGroupOut:
    for _ in range(5):
        code = _gen_code()
        g = FavoriteGroup(code=code, name=(body.name or None))
        db.add(g)
        try:
            db.commit()
            db.refresh(g)
            return FavoriteGroupOut.model_validate(g, from_attributes=True)
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=500, detail="failed to generate unique code")


@router.get("/groups/{code}", response_model=FavoriteGroupDetail)
def get_group(code: str, db: Session = Depends(get_db)) -> FavoriteGroupDetail:
    g = _get_group_or_404(db, code)
    rows = (
        db.execute(
            select(FavoriteItem)
            .where(and_(FavoriteItem.group_id == g.id, FavoriteItem.deleted_at.is_(None)))
            .order_by(FavoriteItem.created_at.desc())
        )
        .scalars()
        .all()
    )
    return FavoriteGroupDetail(
        group=FavoriteGroupOut.model_validate(g, from_attributes=True),
        items=[FavoriteItemOut.model_validate(r, from_attributes=True) for r in rows],
    )


@router.post(
    "/groups/{code}/items", response_model=FavoriteItemOut, status_code=201
)
def add_item(
    code: str, body: FavoriteItemCreate, db: Session = Depends(get_db)
) -> FavoriteItemOut:
    g = _get_group_or_404(db, code)

    # place_id 매칭이 있으면 멱등 (중복 추가 X)
    if body.place_id is not None:
        existing = db.execute(
            select(FavoriteItem).where(
                FavoriteItem.group_id == g.id,
                FavoriteItem.place_id == body.place_id,
                FavoriteItem.deleted_at.is_(None),
            )
        ).scalar_one_or_none()
        if existing is not None:
            return FavoriteItemOut.model_validate(existing, from_attributes=True)

    item = FavoriteItem(
        group_id=g.id,
        place_id=body.place_id,
        name=body.name,
        address=body.address,
        lat=body.lat,
        lng=body.lng,
        added_by=body.added_by,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return FavoriteItemOut.model_validate(item, from_attributes=True)


@router.delete("/groups/{code}/items/{item_id}", status_code=204)
def remove_item(code: str, item_id: int, db: Session = Depends(get_db)) -> None:
    g = _get_group_or_404(db, code)
    item = db.execute(
        select(FavoriteItem).where(
            FavoriteItem.id == item_id, FavoriteItem.group_id == g.id
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    if item.deleted_at is None:
        item.deleted_at = datetime.now(timezone.utc)
        db.commit()
