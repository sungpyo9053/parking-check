from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class SearchLog(Base):
    """사용자 검색 활동 로그 (운영자 분석용).

    - /api/parking/analyze 호출시 백그라운드로 1행 insert.
    - place_id 또는 lat/lng 둘 중 하나는 들어있다.
    - 개인 식별 정보 없음 (user_token 은 익명 cookie/local 토큰일 뿐).
    """

    __tablename__ = "search_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    searched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # 입력 파라미터
    place_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    place_name: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    radius_m: Mapped[int | None] = mapped_column(Integer)

    # 결과 요약 (운영자가 한눈에 볼 수 있게)
    self_parking_status: Mapped[str | None] = mapped_column(Text)
    top_recommendation_name: Mapped[str | None] = mapped_column(Text)
    top_recommendation_walking_min: Mapped[int | None] = mapped_column(Integer)
    external_candidate_count: Mapped[int | None] = mapped_column(Integer)

    # 요청 메타
    user_token: Mapped[str | None] = mapped_column(Text, index=True)
    user_agent: Mapped[str | None] = mapped_column(Text)
    referer: Mapped[str | None] = mapped_column(Text)
