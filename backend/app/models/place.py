from __future__ import annotations

from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Computed, DateTime, Float, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Place(Base):
    __tablename__ = "places"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    external_source: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    road_address: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    # geom 은 DB GENERATED ALWAYS 컬럼이라 INSERT/UPDATE에서 제외해야 한다.
    geom = mapped_column(
        Geometry(geometry_type="POINT", srid=4326),
        Computed("ST_SetSRID(ST_MakePoint(lng, lat), 4326)", persisted=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
