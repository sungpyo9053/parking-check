from __future__ import annotations

from datetime import date, datetime, time

from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Integer, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class ParkingLot(Base):
    __tablename__ = "parking_lots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str | None] = mapped_column(Text)
    parking_type: Mapped[str | None] = mapped_column(Text)
    road_address: Mapped[str | None] = mapped_column(Text)
    jibun_address: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    geom = mapped_column(Geometry(geometry_type="POINT", srid=4326), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer)
    weekday_open_time: Mapped[time | None] = mapped_column(Time)
    weekday_close_time: Mapped[time | None] = mapped_column(Time)
    saturday_open_time: Mapped[time | None] = mapped_column(Time)
    saturday_close_time: Mapped[time | None] = mapped_column(Time)
    holiday_open_time: Mapped[time | None] = mapped_column(Time)
    holiday_close_time: Mapped[time | None] = mapped_column(Time)
    fee_type: Mapped[str | None] = mapped_column(Text)
    base_time: Mapped[int | None] = mapped_column(Integer)
    base_fee: Mapped[int | None] = mapped_column(Integer)
    extra_time: Mapped[int | None] = mapped_column(Integer)
    extra_fee: Mapped[int | None] = mapped_column(Integer)
    phone: Mapped[str | None] = mapped_column(Text)
    has_disabled_parking: Mapped[bool | None] = mapped_column(Boolean)
    data_reference_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
