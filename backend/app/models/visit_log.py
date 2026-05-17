from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, Numeric, SmallInteger, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ParkingVisitLog(Base):
    __tablename__ = "parking_visit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    destination_name: Mapped[str | None] = mapped_column(Text)
    destination_place_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("places.id", ondelete="SET NULL")
    )
    destination_lat: Mapped[float | None] = mapped_column(Float)
    destination_lng: Mapped[float | None] = mapped_column(Float)

    selected_parking_lot_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("parking_lots.id", ondelete="SET NULL")
    )
    selected_parking_name: Mapped[str | None] = mapped_column(Text)

    searched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expected_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    predicted_status: Mapped[str | None] = mapped_column(Text)
    predicted_risk_score: Mapped[Decimal | None] = mapped_column(Numeric)
    api_available_count: Mapped[int | None] = mapped_column(Integer)
    api_total_capacity: Mapped[int | None] = mapped_column(Integer)

    actual_result: Mapped[str | None] = mapped_column(Text)
    actual_wait_minutes: Mapped[int | None] = mapped_column(Integer)
    actual_fee: Mapped[int | None] = mapped_column(Integer)
    entrance_difficulty: Mapped[int | None] = mapped_column(SmallInteger)
    walking_difficulty: Mapped[int | None] = mapped_column(SmallInteger)
    perceived_congestion: Mapped[int | None] = mapped_column(SmallInteger)
    memo: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
