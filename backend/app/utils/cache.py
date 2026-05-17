"""작은 in-memory TTL 캐시.

Tavily / Kakao 호출 비용을 줄이기 위해 (좌표, 카테고리) 같은 키로 결과를
짧게 캐싱. 프로세스 재시작이나 다중 워커 환경에서는 공유되지 않으니,
정확한 idempotency 가 필요한 곳엔 쓰지 말 것 — 호출 비용 절약 목적.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Generic, Hashable, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    def __init__(self, max_size: int = 256, ttl_seconds: float = 1800) -> None:
        self._max = max_size
        self._ttl = ttl_seconds
        self._data: OrderedDict[K, tuple[float, V]] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def get(self, key: K) -> V | None:
        now = time.monotonic()
        with self._lock:
            item = self._data.get(key)
            if item is None:
                self._misses += 1
                return None
            ts, value = item
            if now - ts > self._ttl:
                self._data.pop(key, None)
                self._misses += 1
                return None
            self._data.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: K, value: V) -> None:
        now = time.monotonic()
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = (now, value)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def get_or_compute(self, key: K, factory: Callable[[], V]) -> V:
        v = self.get(key)
        if v is not None:
            return v
        v = factory()
        self.set(key, v)
        return v

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "size": len(self._data),
                "max": self._max,
                "ttl_seconds": self._ttl,
                "hits": self._hits,
                "misses": self._misses,
            }

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
