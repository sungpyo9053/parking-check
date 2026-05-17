from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ParkingRealtimeStatus(Base):
    __tablename__ = "parking_realtime_status"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parking_lot_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("parking_lots.id", ondelete="CASCADE")
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    source_lot_key: Mapped[str | None] = mapped_column(Text)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    total_capacity: Mapped[int | None] = mapped_column(Integer)
    available_count: Mapped[int | None] = mapped_column(Integer)
    occupied_count: Mapped[int | None] = mapped_column(Integer)
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
