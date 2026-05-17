from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class FavoriteGroup(Base):
    __tablename__ = "favorite_groups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class FavoriteItem(Base):
    __tablename__ = "favorite_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    group_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("favorite_groups.id", ondelete="CASCADE"), nullable=False
    )
    place_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("places.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    added_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
