import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, DiscoverHotResponse, HotPlaceItem } from "../lib/api";

type Category = "cafe" | "food" | "sights";

const CATS: { key: Category; label: string; emoji: string }[] = [
  { key: "cafe", label: "카페", emoji: "☕" },
  { key: "food", label: "맛집", emoji: "🍽" },
  { key: "sights", label: "가볼곳", emoji: "📍" },
];

export default function DiscoverHot() {
  const navigate = useNavigate();
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [data, setData] = useState<DiscoverHotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Category | null>(null);

  function getLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("브라우저가 위치 권한을 지원하지 않습니다.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoading(false);
      },
      err => {
        setLoading(false);
        setError(`위치 권한 거부 또는 실패: ${err.message}`);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  }

  function pick(cat: Category) {
    if (!coord) {
      getLocation();
      return;
    }
    setActive(cat);
    setLoading(true);
    setError(null);
    api
      .discoverHot({ lat: coord.lat, lng: coord.lng, category: cat, limit: 3 })
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }

  function openInParking(it: HotPlaceItem) {
    navigate(
      `/analyze?lat=${it.lat}&lng=${it.lng}&name=${encodeURIComponent(it.name)}`
    );
  }

  function openKakaoMap(it: HotPlaceItem) {
    const url =
      it.place_url ||
      `https://map.kakao.com/?q=${encodeURIComponent(it.name)}&MX=${it.lng}&MY=${it.lat}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="discover-block">
      <div className="discover-head">
        <h2 className="h2" style={{ margin: 0 }}>주변 핫플</h2>
        {coord && (
          <span className="muted" style={{ fontSize: 11 }}>
            현위치 {coord.lat.toFixed(3)}, {coord.lng.toFixed(3)}
            {data?.region ? ` · ${data.region}` : ""}
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        현위치 기준 인스타에서 자주 언급되는 카페/맛집/가볼곳 추천 (Tavily 웹 검색 기반).
      </p>

      {!coord && (
        <button className="btn primary" onClick={getLocation} style={{ width: "100%" }}>
          {loading ? "현위치 확인 중..." : "📍 현위치 권한 허용하고 시작"}
        </button>
      )}

      {coord && (
        <div className="search-box" style={{ marginTop: 4 }}>
          {CATS.map(c => (
            <button
              key={c.key}
              type="button"
              className={active === c.key ? "btn primary" : "btn"}
              onClick={() => pick(c.key)}
              disabled={loading}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {loading && coord && active && (
        <p className="muted">⏳ 인스타 언급 분석 중…</p>
      )}

      {data && data.items.length === 0 && !loading && (
        <p className="muted">결과가 없습니다. 반경/카테고리를 바꿔 보세요.</p>
      )}

      {data && data.items.length > 0 && (
        <ul className="list" style={{ marginTop: 8 }}>
          {data.items.map((it, idx) => (
            <li key={`${it.name}-${idx}`} className="pcard">
              <div className="head">
                <span className="name">
                  {idx + 1}. {it.name}
                </span>
                {it.instagram_mentions > 0 && (
                  <span className="tag tag-high">📷 ×{it.instagram_mentions}</span>
                )}
              </div>
              <div className="meta">
                {it.distance_m}m · 직선거리 도보 약 {it.walking_minutes}분
                {it.category && <span> · {it.category}</span>}
              </div>
              {(it.address || it.road_address) && (
                <div className="meta muted">{it.road_address || it.address}</div>
              )}
              <div className="meta muted" style={{ fontSize: 11 }}>
                hot score {it.hot_score}
              </div>
              <div className="actions">
                <button className="btn primary" onClick={() => openInParking(it)}>
                  주차 분석
                </button>
                <button className="btn" onClick={() => openKakaoMap(it)}>
                  카카오맵에서 보기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
