from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class PlaceSelfParkingFeedback(Base):
    __tablename__ = "place_self_parking_feedback"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    place_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("places.id", ondelete="CASCADE")
    )
    answer: Mapped[str] = mapped_column(Text, nullable=False)  # 'yes'|'no'|'unknown'
    note: Mapped[str | None] = mapped_column(Text)
    user_token: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
