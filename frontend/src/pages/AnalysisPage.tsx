import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, AnalyzeResponse, Candidate } from "../lib/api";
import KakaoMap, { MapMarker } from "../components/KakaoMap";
import ParkingCard from "../components/ParkingCard";

const SELF_LABEL = {
  available: "자체 주차 가능성 높음",
  uncertain: "자체 주차 불확실",
  unavailable: "자체 주차 어려움",
  unknown: "자체 주차 정보 부족"
};

export default function AnalysisPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const place_id = sp.get("place_id");
  const lat = sp.get("lat");
  const lng = sp.get("lng");
  const placeName = sp.get("name") || "";

  const [radius, setRadius] = useState<number>(500);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setData(null);
    const params: Parameters<typeof api.analyze>[0] = { radius };
    if (place_id) params.place_id = Number(place_id);
    else if (lat && lng) {
      params.lat = Number(lat);
      params.lng = Number(lng);
    } else {
      setError("place_id 또는 lat+lng 가 필요합니다.");
      return;
    }
    api.analyze(params).then(setData).catch(e => setError(e.message));
  }, [place_id, lat, lng, radius]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    return [
      {
        id: "dest",
        lat: data.destination.lat,
        lng: data.destination.lng,
        label: data.destination.name || placeName || "목적지",
        kind: "destination"
      },
      ...data.candidates.map<MapMarker>(c => ({
        id: String(c.id),
        lat: c.lat,
        lng: c.lng,
        label: c.name,
        kind: "parking"
      }))
    ];
  }, [data, placeName]);

  function startVisit(c: Candidate) {
    if (!data) return;
    const payload = {
      destination_name: data.destination.name || placeName,
      destination_place_id: data.destination.place_id,
      destination_lat: data.destination.lat,
      destination_lng: data.destination.lng,
      selected_parking_lot_id: c.id,
      selected_parking_name: c.name,
      predicted_status: c.congestion === "full" || c.congestion === "risky"
        ? "risky" : c.congestion === "unknown" ? "unknown" : "available",
      predicted_risk_score: c.score,
      api_available_count: c.realtime?.available_count ?? null,
      api_total_capacity: c.realtime?.total_capacity ?? null
    };
    api
      .createVisit(payload)
      .then(v => navigate(`/visits/new?id=${v.id}`))
      .catch(e => setError(e.message));
  }

  function openKakaoMap(c: Candidate) {
    // 카카오맵 외부 길찾기 URL — 좌표가 비어있으면 이름으로 열기
    const dest = data?.destination;
    if (!dest) return;
    const url = `https://map.kakao.com/?map_type=TYPE_MAP&target=other&rt=,,${dest.lng},${dest.lat}&rt2=${encodeURIComponent(c.name)}`;
    window.open(url, "_blank");
  }

  return (
    <div>
      <h1 className="h1">{placeName || data?.destination.name || "분석"}</h1>
      <p className="tagline">{data?.destination.address}</p>

      <div className="search-box" style={{ marginTop: 0 }}>
        {[300, 500, 1000].map(r => (
          <button
            key={r}
            type="button"
            className={radius === r ? "btn primary" : "btn"}
            onClick={() => setRadius(r)}
          >
            {r >= 1000 ? `${r / 1000}km` : `${r}m`}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">분석 중...</p>}

      {data && (
        <>
          <KakaoMap
            center={{ lat: data.destination.lat, lng: data.destination.lng }}
            markers={markers}
          />

          <div className="summary-card">
            <div className="row">
              <span className="label">자체 주차 가능성</span>
              <span>
                {SELF_LABEL[data.self_parking.status]} ({data.self_parking.confidence}점)
              </span>
            </div>
            {data.self_parking.reason && (
              <div className="muted" style={{ fontSize: 12 }}>
                {data.self_parking.reason}
              </div>
            )}
            <div className="row">
              <span className="label">주변 주차장</span>
              <span>
                {data.summary.nearby_count}개 / 최근접 {data.summary.nearest_distance_m ?? "-"}m
              </span>
            </div>
            <div className="row">
              <span className="label">만차 위험</span>
              <span>{data.summary.any_full_risk ? "있음" : "낮음"}</span>
            </div>
            <div className="row">
              <span className="label">데이터 신뢰도</span>
              <span>{data.summary.data_quality}</span>
            </div>
          </div>

          {data.history_for_destination.length > 0 && (
            <>
              <h2 className="h2">이 목적지의 과거 기록</h2>
              <ul className="list">
                {data.history_for_destination.map(h => (
                  <li key={h.visit_id} className="list-item">
                    <span className="title">
                      {h.selected_parking_name || "(주차장 미선택)"}
                    </span>
                    <span className="sub">
                      {new Date(h.searched_at).toLocaleString("ko-KR")}
                      {" · "}{h.actual_result ?? "결과 미입력"}
                    </span>
                    {h.memo && <span className="sub">메모: {h.memo}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="h2">추천 주차장</h2>
          {data.candidates.length === 0 && (
            <p className="muted">반경 {radius}m 내 등록된 주차장이 없습니다. 반경을 늘려보세요.</p>
          )}
          <ul className="list">
            {data.candidates.map(c => (
              <li key={c.id}>
                <ParkingCard c={c} onSelect={startVisit} onOpenMap={openKakaoMap} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
