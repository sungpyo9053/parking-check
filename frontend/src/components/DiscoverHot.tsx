import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  AnalyzeResponse,
  DiscoverHotResponse,
  HotPlaceItem,
} from "../lib/api";
import KakaoMap, { MapMarker } from "./KakaoMap";

type ParkingMini =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: AnalyzeResponse };

function selfBadge(status: string | undefined): {
  label: string;
  color: string;
  bg: string;
} {
  if (status === "available")
    return { label: "자체 주차 가능", color: "#14532d", bg: "#bbf7d0" };
  if (status === "likely")
    return { label: "자체 주차 가능성 높음", color: "#14532d", bg: "#bbf7d0" };
  if (status === "uncertain")
    return { label: "자체 주차 불확실", color: "#9a3412", bg: "#fed7aa" };
  if (status === "unavailable")
    return { label: "자체 주차 어려움", color: "#7f1d1d", bg: "#fecaca" };
  return { label: "자체 주차 정보 부족", color: "#374151", bg: "#e5e7eb" };
}

type Category = "cafe" | "food" | "sights";

/** views 절대값을 사람 친화적 라벨로. 100k+ = 매우 높음 / 10k+ = 높음 / 그 외 = 있음. */
function viewLabel(views: number): string {
  if (views >= 100_000) return "매우 높음";
  if (views >= 10_000) return "높음";
  if (views > 0) return "있음";
  return "없음";
}

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
  const [parkingByKey, setParkingByKey] = useState<Record<string, ParkingMini>>(
    {},
  );

  // 핫플 결과가 바뀌면 각 매장 lat/lng 로 analyze 병렬 호출해서 주차 정보 채우기
  useEffect(() => {
    if (!data || data.items.length === 0) {
      setParkingByKey({});
      return;
    }
    const next: Record<string, ParkingMini> = {};
    data.items.forEach((it, idx) => {
      const k = `${idx}-${it.name}`;
      next[k] = { state: "loading" };
    });
    setParkingByKey(next);

    let cancelled = false;
    Promise.all(
      data.items.map((it, idx) =>
        api
          .analyze({ lat: it.lat, lng: it.lng, radius: 500 })
          .then((d) => ({ k: `${idx}-${it.name}`, ok: true as const, d }))
          .catch((e) => ({
            k: `${idx}-${it.name}`,
            ok: false as const,
            e: e?.message || String(e),
          })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setParkingByKey((prev) => {
        const out = { ...prev };
        for (const r of results) {
          out[r.k] = r.ok
            ? { state: "ok", data: r.d }
            : { state: "error", message: r.e };
        }
        return out;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  function getLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("브라우저가 위치 권한을 지원하지 않습니다.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setError(`위치 권한 거부 또는 실패: ${err.message}`);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
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
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }

  function openInParking(it: HotPlaceItem) {
    navigate(
      `/analyze?lat=${it.lat}&lng=${it.lng}&name=${encodeURIComponent(it.name)}`,
    );
  }

  function openKakaoMap(it: HotPlaceItem) {
    const url =
      it.place_url ||
      `https://map.kakao.com/?q=${encodeURIComponent(it.name)}&MX=${it.lng}&MY=${it.lat}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // 지도 마커: 현위치 + 각 핫플 + 각 핫플의 추천 주차장
  const markers = useMemo<MapMarker[]>(() => {
    if (!data || data.items.length === 0 || !coord) return [];
    const out: MapMarker[] = [
      {
        id: "me",
        lat: coord.lat,
        lng: coord.lng,
        kind: "current",
      },
    ];
    data.items.forEach((it, idx) => {
      out.push({
        id: `hot-${idx}`,
        lat: it.lat,
        lng: it.lng,
        label: it.name,
        kind: "hot",
        detail: {
          name: it.name,
          distanceM: it.distance_m,
          walkingMinutes: it.walking_minutes,
          usabilityLabel: `⭐ 핫플 #${idx + 1}`,
        },
      });
      const pk = parkingByKey[`${idx}-${it.name}`];
      if (pk?.state === "ok") {
        const tr = pk.data.top_recommendation;
        if (tr && tr.candidate.lat != null && tr.candidate.lng != null) {
          out.push({
            id: `park-${idx}`,
            lat: tr.candidate.lat,
            lng: tr.candidate.lng,
            label: tr.candidate.name,
            kind: "parking",
            detail: {
              name: tr.candidate.name,
              usability: "usable",
              usabilityLabel: `${it.name} 추천 주차장`,
              distanceM: tr.candidate.distance_m,
              walkingMinutes: tr.candidate.walking_minutes,
            },
          });
        }
      }
    });
    return out;
  }, [data, coord, parkingByKey]);

  return (
    <div className="discover-block">
      <div className="discover-head">
        <h2 className="h2" style={{ margin: 0 }}>
          주변 핫플
        </h2>
        {coord && (
          <span className="muted" style={{ fontSize: 11 }}>
            현위치 {coord.lat.toFixed(3)}, {coord.lng.toFixed(3)}
            {data?.region ? ` · ${data.region}` : ""}
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        현위치 기준 인스타에서 자주 언급되는 카페/맛집/가볼곳 추천 (Tavily 웹
        검색 기반).
      </p>

      {!coord && (
        <button
          className="btn primary"
          onClick={getLocation}
          style={{ width: "100%" }}
        >
          {loading ? "현위치 확인 중..." : "📍 현위치 권한 허용하고 시작"}
        </button>
      )}

      {coord && (
        <div className="search-box" style={{ marginTop: 4 }}>
          {CATS.map((c) => (
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

      {data && data.items.length > 0 && coord && (
        <KakaoMap
          center={coord}
          markers={markers}
          destinationLat={coord.lat}
          destinationLng={coord.lng}
          destinationName="현위치"
        />
      )}

      {data && data.items.length > 0 && (
        <ul className="list" style={{ marginTop: 8 }}>
          {data.items.map((it, idx) => (
            <li
              key={`${it.name}-${idx}`}
              className="pcard pcard-hot"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <div className="head">
                <span className="name">
                  {idx + 1}. {it.name}
                </span>
              </div>
              <div className="meta">
                도보 약 {it.walking_minutes}분 · {it.distance_m}m
                {it.category && <span> · {it.category}</span>}
              </div>
              {(it.address || it.road_address) && (
                <div className="meta muted">
                  {it.road_address || it.address}
                </div>
              )}

              {/* 신뢰 신호 칩 (단정 X, 신호의 강약을 그대로 노출) */}
              <div className="hot-signals">
                {it.youtube_video_count > 0 && (
                  <span className="signal-chip signal-chip-yt">
                    YouTube 조회 신호 {viewLabel(it.youtube_total_views)}
                  </span>
                )}
                {it.naver_mentions > 0 && (
                  <span className="signal-chip signal-chip-naver">
                    블로그 언급 {it.naver_mentions}건
                  </span>
                )}
                {it.tavily_mentions > 0 && (
                  <span className="signal-chip signal-chip-web">
                    웹 추천 글 {it.tavily_mentions}건
                  </span>
                )}
                {it.congestion && (
                  <span
                    className={`signal-chip signal-chip-cong signal-chip-cong-${it.congestion.level}`}
                    title={it.congestion.basis}
                  >
                    예상 {it.congestion.label}
                  </span>
                )}
              </div>

              {/* 주차 미리보기 */}
              {(() => {
                const pk = parkingByKey[`${idx}-${it.name}`];
                if (!pk) return null;
                if (pk.state === "loading") {
                  return (
                    <div
                      className="parking-mini muted"
                      style={{ fontSize: 11 }}
                    >
                      ⏳ 주차 가능 여부 확인 중…
                    </div>
                  );
                }
                if (pk.state === "error") {
                  return (
                    <div
                      className="parking-mini muted"
                      style={{ fontSize: 11 }}
                    >
                      주차 정보 확인 실패 — {pk.message}
                    </div>
                  );
                }
                const sp = pk.data.self_parking;
                const tr = pk.data.top_recommendation;
                const b = selfBadge(sp?.status);
                return (
                  <div className="parking-mini">
                    <div>
                      <span
                        className="tag"
                        style={{ background: b.bg, color: b.color }}
                      >
                        {b.label}
                      </span>
                      {sp?.confidence != null && sp.confidence > 0 && (
                        <span
                          className="muted"
                          style={{ fontSize: 11, marginLeft: 6 }}
                        >
                          ({sp.confidence}점)
                        </span>
                      )}
                    </div>
                    {tr ? (
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginTop: 3 }}
                      >
                        ⭐ 추천: <strong>{tr.candidate.name}</strong>
                        {tr.candidate.walking_minutes != null && (
                          <span>
                            {" "}
                            · 도보 약 {tr.candidate.walking_minutes}분
                          </span>
                        )}
                      </div>
                    ) : sp?.status === "available" ||
                      sp?.status === "likely" ? (
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginTop: 3 }}
                      >
                        매장 자체 주차로 해결
                      </div>
                    ) : (
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginTop: 3 }}
                      >
                        주변 추천 주차장 없음 — 분석 페이지에서 확인
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="actions">
                <button
                  className="btn primary"
                  onClick={() => openInParking(it)}
                >
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
