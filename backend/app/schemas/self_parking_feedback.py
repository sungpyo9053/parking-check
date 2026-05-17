from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

FeedbackAnswer = Literal["yes", "no", "unknown"]


class SelfParkingFeedbackCreate(BaseModel):
    answer: FeedbackAnswer
    note: str | None = Field(default=None, max_length=500)
    user_token: str | None = Field(default=None, max_length=64)


class SelfParkingFeedbackItem(BaseModel):
    id: int
    place_id: int | None
    answer: FeedbackAnswer
    note: str | None
    created_at: datetime


class SelfParkingFeedbackSummary(BaseModel):
    place_id: int
    yes_count: int = 0
    no_count: int = 0
    unknown_count: int = 0
    total: int = 0
    last_answer: FeedbackAnswer | None = None
    last_at: datetime | None = None
