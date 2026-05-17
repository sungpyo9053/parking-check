from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ParkingFeedback(Base):
    __tablename__ = "parking_feedbacks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parking_lot_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("parking_lots.id", ondelete="CASCADE")
    )
    visit_log_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("parking_visit_logs.id", ondelete="SET NULL")
    )
    feedback_type: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
