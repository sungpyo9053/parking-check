import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, AnalyzeResponse, Candidate, SelfParkingFeedbackStats } from "../lib/api";

// 익명 클라이언트 토큰 (피드백 중복 측정용)
function getUserToken(): string {
  try {
    const k = "pk_user_token";
    let v = localStorage.getItem(k);
    if (!v) {
      v = (crypto?.randomUUID?.() ?? `u-${Date.now()}-${Math.random()}`).slice(0, 40);
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "anon";
  }
}
import KakaoMap, { MapMarker } from "../components/KakaoMap";
import ParkingCard from "../components/ParkingCard";
import ExternalCard from "../components/ExternalCard";
import { openKakaoFootRoute } from "../lib/maps";

const SELF_LABEL: Record<string, string> = {
  available: "자체 주차 가능 (DB 매칭)",
  likely: "자체 주차 가능성 높음 (웹 근거)",
  uncertain: "자체 주차 가능성 불확실",
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
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStats, setFeedbackStats] = useState<SelfParkingFeedbackStats | null>(null);
  const [feedbackJustSent, setFeedbackJustSent] = useState<"yes" | "no" | "unknown" | null>(null);

  async function sendFeedback(answer: "yes" | "no" | "unknown") {
    if (!data?.destination.place_id) return;
    setFeedbackBusy(true);
    try {
      await api.submitSelfParkingFeedback(data.destination.place_id, {
        answer,
        user_token: getUserToken(),
      });
      const sum = await api.selfParkingFeedbackSummary(data.destination.place_id);
      setFeedbackStats({
        place_id: sum.place_id,
        yes_count: sum.yes_count,
        no_count: sum.no_count,
        unknown_count: sum.unknown_count,
        total: sum.total,
      });
      setFeedbackJustSent(answer);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedbackBusy(false);
    }
  }

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
    api
      .analyze(params)
      .then(d => {
        setData(d);
        setFeedbackStats(d.self_parking_feedback_stats);
        setFeedbackJustSent(null);
      })
      .catch(e => setError(e.message));
  }, [place_id, lat, lng, radius]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const externalForMap = (data.external_candidates || []).filter(
      e => e.lat != null && e.lng != null && e.usability !== "private_restricted"
    );
    const tr = data.top_recommendation;
    const recLat = tr?.candidate.lat;
    const recLng = tr?.candidate.lng;
    const isSameMarker = (lat: number | null, lng: number | null) =>
      recLat != null && recLng != null && lat === recLat && lng === recLng;

    const out: MapMarker[] = [
      {
        id: "dest",
        lat: data.destination.lat,
        lng: data.destination.lng,
        label: data.destination.name || placeName || "목적지",
        kind: "destination" as const,
      },
    ];

    // 추천 마커는 가장 위에 별도로 노란 ⭐ 강조
    if (tr && recLat != null && recLng != null) {
      out.push({
        id: "top-rec",
        lat: recLat,
        lng: recLng,
        label: tr.candidate.name,
        kind: "recommended" as const,
        detail: {
          name: tr.candidate.name,
          usability: "usable",
          usabilityLabel: "⭐ 최우선 추천",
          distanceM: tr.candidate.walking_route_distance_m ?? tr.candidate.distance_m,
          walkingMinutes: tr.candidate.walking_minutes,
        },
      });
    }

    out.push(
      ...data.candidates
        .filter(c => !isSameMarker(c.lat, c.lng))
        .map<MapMarker>(c => ({
          id: String(c.id),
          lat: c.lat,
          lng: c.lng,
          label: c.name,
          kind: "parking" as const,
          detail: {
            name: c.name,
            usability: "usable",
            usabilityLabel: "추천 가능",
            distanceM: c.walking_route_distance_m ?? c.distance_m,
            walkingMinutes: c.walk_minutes,
          },
        })),
      ...externalForMap
        .filter(e => !isSameMarker(e.lat, e.lng))
        .map<MapMarker>((e, i) => ({
          id: `ext-${i}`,
          lat: e.lat as number,
          lng: e.lng as number,
          label: e.name,
          kind: "parking" as const,
          detail: {
            name: e.name,
            usability: e.usability,
            usabilityLabel: e.usability_label,
            distanceM: e.walking_route_distance_m ?? e.distance_m,
            walkingMinutes: e.walking_minutes,
          },
        }))
    );
    return out;
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
            destinationLat={data.destination.lat}
            destinationLng={data.destination.lng}
            destinationName={data.destination.name || placeName || "목적지"}
          />

          <div className="summary-card">
            <div className="row">
              <span className="label">자체 주차 가능성</span>
              <span className={`self-status self-status-${data.self_parking.status}`}>
                {data.self_parking.label || SELF_LABEL[data.self_parking.status]}
                {data.self_parking.confidence > 0 ? ` · ${data.self_parking.confidence}점` : ""}
              </span>
            </div>
            {data.self_parking.reason && (
              <div className="muted" style={{ fontSize: 12 }}>
                {data.self_parking.reason}
              </div>
            )}
            {data.self_parking.warning && (
              <div style={{ fontSize: 12, color: "#b85c00" }}>
                ⚠ {data.self_parking.warning}
              </div>
            )}
            {data.destination.place_id && (
              <div className="sp-feedback">
                <div className="sp-feedback-q">실제로 자체 주차 가능했나요?</div>
                <div className="sp-feedback-buttons">
                  <button
                    className="btn sp-yes"
                    disabled={feedbackBusy}
                    onClick={() => sendFeedback("yes")}
                  >
                    ✓ 있었음
                  </button>
                  <button
                    className="btn sp-no"
                    disabled={feedbackBusy}
                    onClick={() => sendFeedback("no")}
                  >
                    ✗ 없었음
                  </button>
                  <button
                    className="btn sp-unk"
                    disabled={feedbackBusy}
                    onClick={() => sendFeedback("unknown")}
                  >
                    ? 모름
                  </button>
                </div>
                {(feedbackStats?.total ?? 0) > 0 && (
                  <div className="sp-feedback-stats">
                    누적 응답 {feedbackStats?.total}: ✓ {feedbackStats?.yes_count} · ✗ {feedbackStats?.no_count} · ? {feedbackStats?.unknown_count}
                    {feedbackJustSent && <span style={{ color: "#16a34a" }}> · 응답 저장됨</span>}
                  </div>
                )}
              </div>
            )}
            {data.self_parking.evidence && data.self_parking.evidence.length > 0 && (
              <details className="self-evidence">
                <summary>
                  자체 주차 근거 {data.self_parking.evidence.length}건 보기
                </summary>
                <ul className="evidence-list">
                  {data.self_parking.evidence.map((e, i) => (
                    <li key={`ev-${i}`} className="evidence-item">
                      <div className="evidence-head">
                        <span className={`tag tag-${e.confidence}`}>
                          {e.source === "web_search" ? "웹" : e.source} · {e.confidence}
                        </span>
                        {e.title && <span className="evidence-title">{e.title}</span>}
                      </div>
                      {e.snippet && <div className="evidence-snippet">{e.snippet}</div>}
                      {e.matched_keywords.length > 0 && (
                        <div className="evidence-keywords">
                          매칭: {e.matched_keywords.map(k => `「${k}」`).join(" ")}
                        </div>
                      )}
                      {e.url && (
                        <a
                          className="evidence-link"
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          근거 링크 보기 →
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
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

          {(() => {
            // 통일된 '⭐ 추천 주차장' 카드:
            //   - 자체 주차 likely/available → "자체 주차 추천 — [목적지명]"
            //   - 그 외 + top_recommendation 있음 → "[외부 주차장명] 주차장 추천"
            const sp = data.self_parking;
            const isSelf = sp.status === "available" || sp.status === "likely";
            const tr = data.top_recommendation;
            const dest = data.destination;
            const destDisplayName = dest.name || placeName || "목적지";

            if (isSelf) {
              return (
                <div className="top-rec-card top-rec-self">
                  <div className="top-rec-head">
                    <span className="top-rec-badge">⭐ 자체 주차 추천</span>
                    {sp.confidence > 0 && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        confidence {sp.confidence}
                      </span>
                    )}
                  </div>
                  <div className="top-rec-name">{destDisplayName} (목적지 자체 주차)</div>
                  <div className="top-rec-meta">
                    <strong>주차 후 매장까지 도보 0분</strong>
                    {sp.label ? ` · ${sp.label}` : ""}
                  </div>
                  {sp.reason && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {sp.reason}
                    </div>
                  )}
                  {sp.warning && (
                    <div style={{ fontSize: 12, color: "#b85c00", marginTop: 4 }}>
                      ⚠ {sp.warning}
                    </div>
                  )}
                </div>
              );
            }
            if (!tr) return null;
            const c = tr.candidate;
            const canRoute = c.lat != null && c.lng != null;
            return (
              <div className="top-rec-card">
                <div className="top-rec-head">
                  <span className="top-rec-badge">⭐ {c.name} 추천</span>
                  <span className="muted" style={{ fontSize: 11 }}>score {tr.score}</span>
                </div>
                <div className="top-rec-name">{c.name}</div>
                <div className="top-rec-meta">
                  {c.walking_minutes != null && (
                    <span>
                      <strong>
                        {(c.walking_route_distance_m ?? c.distance_m) != null
                          ? `${c.walking_route_distance_m ?? c.distance_m}m · `
                          : ""}
                        도보 약 {c.walking_minutes}분
                        {c.walking_route_source === "osrm" ? " (실 경로)" : " (직선거리)"}
                      </strong>
                    </span>
                  )}
                  {c.category && <span> · {c.category}</span>}
                </div>
                {tr.rationale && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {tr.rationale}
                  </div>
                )}
                {tr.reasons.length > 0 && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    선정 근거: {tr.reasons.join(" · ")}
                  </div>
                )}
                <div className="actions" style={{ marginTop: 8 }}>
                  {canRoute && (
                    <button
                      className="btn primary"
                      onClick={() =>
                        openKakaoFootRoute(
                          { lat: c.lat!, lng: c.lng!, name: c.name },
                          {
                            lat: dest.lat,
                            lng: dest.lng,
                            name: destDisplayName,
                          }
                        )
                      }
                    >
                      카카오맵 도보 길찾기
                    </button>
                  )}
                  {c.url && (
                    <button
                      className="btn"
                      onClick={() => window.open(c.url!, "_blank", "noopener,noreferrer")}
                    >
                      카카오맵에서 열기
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

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
            const ext = data.external_candidates || [];
            const usableExt = ext.filter(e => e.usability === "usable");
            const cautionExt = ext.filter(e => e.usability === "caution");
            const excluded = data.fallback?.excluded_items || [];

            const recommendCount = dbCount + usableExt.length;
            const cautionCount = cautionExt.length;
            const excludedCount = excluded.length;

            if (recommendCount + cautionCount + excludedCount === 0) {
              return (
                <p className="muted">
                  현재 연결된 데이터 소스에서는 반경 {radius}m 내 주차장 후보를 찾지 못했습니다.
                  카카오맵/현장 확인이 필요합니다.
                </p>
              );
            }
            return (
              <>
                <h2 className="h2">
                  추천 가능 후보 {recommendCount}개
                  {cautionCount > 0 ? ` · 주의 ${cautionCount}개` : ""}
                  {excludedCount > 0 ? ` · 제외 ${excludedCount}개` : ""}
                </h2>

                {dbCount > 0 && (
                  <>
                    <div className="section-sub">
                      공공데이터 기반 {dbCount}개 · 요금/실시간 정보 있음
                    </div>
                    <ul className="list">
                      {data.candidates.map(c => (
                        <li key={c.id}>
                          <ParkingCard
                            c={c}
                            onSelect={startVisit}
                            onOpenMap={openKakaoMap}
                            destinationLat={data.destination.lat}
                            destinationLng={data.destination.lng}
                            destinationName={data.destination.name || placeName || "목적지"}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {usableExt.length > 0 && (
                  <>
                    <div className="section-sub">
                      지도/웹 검색 기반 추천 {usableExt.length}개 · 운영/요금/실시간 확인 필요
                    </div>
                    <ul className="list">
                      {usableExt.map((e, i) => (
                        <li key={`u-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={data.destination.lat}
                            destinationLng={data.destination.lng}
                            destinationName={data.destination.name || placeName || "목적지"}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {cautionExt.length > 0 && (
                  <>
                    <div className="section-sub" style={{ color: "#b85c00" }}>
                      ⚠ 확인 필요 후보 {cautionExt.length}개 · 일반 개방 여부 확인 후 이용
                    </div>
                    <ul className="list">
                      {cautionExt.map((e, i) => (
                        <li key={`c-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={data.destination.lat}
                            destinationLng={data.destination.lng}
                            destinationName={data.destination.name || placeName || "목적지"}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {excluded.length > 0 && (
                  <details className="excluded-block">
                    <summary>
                      추천 제외 {excluded.length}개 보기 (타 매장/기관 전용 추정)
                    </summary>
                    <ul className="list" style={{ marginTop: 8 }}>
                      {excluded.map((e, i) => (
                        <li key={`x-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={data.destination.lat}
                            destinationLng={data.destination.lng}
                            destinationName={data.destination.name || placeName || "목적지"}
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
