from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    KAKAO_REST_API_KEY: str = ""
    SEOUL_OPENAPI_KEY: str = ""

    # DATABASE_URL 은 반드시 .env 에서 받는다. 기본값으로 깔아두면 잘못된 DB 에
    # 조용히 붙어버리는 사고가 나므로, 누락 시 ValidationError 로 명확히 실패시킨다.
    DATABASE_URL: str = Field(..., min_length=1)

    BACKEND_BASE_URL: str = "http://localhost:8000"
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    CORS_ORIGINS: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174"
    )

    # --- Web Search fallback ---
    TAVILY_API_KEY: str = ""
    WEB_SEARCH_ENABLED: bool = False

    # Naver Search API (Tavily fallback / 한국 자료 강함)
    # 발급: https://developers.naver.com/apps/#/register (검색 API 체크)
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""

    # Anthropic API (LLM 자연어 요약). 없으면 graceful skip.
    # 발급: https://console.anthropic.com → API Keys
    ANTHROPIC_API_KEY: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
