import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, AnalyzeResponse, Candidate } from "../lib/api";
import KakaoMap, { MapMarker } from "../components/KakaoMap";
import ParkingCard from "../components/ParkingCard";
import ExternalCard from "../components/ExternalCard";

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
    const externalWithCoords = (data.external_candidates || []).filter(
      e => e.lat != null && e.lng != null
    );
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
      })),
      ...externalWithCoords.map<MapMarker>((e, i) => ({
        id: `ext-${i}`,
        lat: e.lat as number,
        lng: e.lng as number,
        label: e.name,
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
                {SELF_LABEL[data.self_parking.status]}
                {data.self_parking.status === "available" || data.self_parking.status === "uncertain"
                  ? ` (${data.self_parking.confidence}점)`
                  : ""}
              </span>
            </div>
            {data.self_parking.reason && (
              <div className="muted" style={{ fontSize: 12 }}>
                {data.self_parking.reason}
              </div>
            )}
            <div className="row">
              <span className="label">DB 등록 후보</span>
              <span>
                {data.summary.nearby_count}개
                {data.summary.nearest_distance_m != null
                  ? ` / 최근접 ${data.summary.nearest_distance_m}m`
                  : ""}
              </span>
            </div>
            {data.external_candidates && data.external_candidates.length > 0 && (
              <div className="row">
                <span className="label">외부 검색 후보</span>
                <span>{data.external_candidates.length}개</span>
              </div>
            )}
            <div className="row">
              <span className="label">만차 위험</span>
              <span>{data.summary.any_full_risk ? "있음" : "낮음"}</span>
            </div>
            <div className="row">
              <span className="label">데이터 신뢰도</span>
              <span>{data.summary.data_quality}</span>
            </div>
          </div>

          {data.fallback && (data.fallback.summary || data.fallback.warnings.length > 0) && (
            <div className="fallback-summary">
              {data.fallback.summary && <div>{data.fallback.summary}</div>}
              {data.fallback.warnings.map((w, i) => (
                <div key={i} className="warn">⚠ {w}</div>
              ))}
            </div>
          )}

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

          {(() => {
            const dbCount = data.candidates.length;
            const extCount = data.external_candidates?.length ?? 0;
            const total = dbCount + extCount;
            if (total === 0) {
              return (
                <p className="muted">
                  현재 연결된 데이터 소스에서는 반경 {radius}m 내 주차장 후보를 찾지 못했습니다.
                  카카오맵/현장 확인이 필요합니다.
                </p>
              );
            }
            return (
              <>
                <h2 className="h2">주차장 후보 {total}개</h2>
                {dbCount > 0 && (
                  <>
                    <div className="section-sub">
                      공공데이터 기반 {dbCount}개 · 요금/실시간 정보 있음
                    </div>
                    <ul className="list">
                      {data.candidates.map(c => (
                        <li key={c.id}>
                          <ParkingCard c={c} onSelect={startVisit} onOpenMap={openKakaoMap} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {extCount > 0 && (
                  <>
                    <div className="section-sub">
                      지도/웹 검색 기반 {extCount}개 · 운영/요금/실시간은 방문 전 확인 필요
                    </div>
                    <ul className="list">
                      {data.external_candidates.map((e, i) => (
                        <li key={`ext-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={data.destination.lat}
                            destinationLng={data.destination.lng}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
