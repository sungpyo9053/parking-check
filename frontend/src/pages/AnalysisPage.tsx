import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  AnalyzeResponse,
  Candidate,
  ExternalCandidate,
  SelfParkingFeedbackStats,
} from "../lib/api";
import KakaoMap, { MapMarker } from "../components/KakaoMap";
import ParkingCard from "../components/ParkingCard";
import ExternalCard from "../components/ExternalCard";
import { openKakaoFootRoute } from "../lib/maps";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { getGroup } from "../lib/favoritesGroup";
import { sharePage } from "../lib/share";

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

// ─── 최종 판단(verdict) 계산 ─────────────────────────────
// 입력 데이터에서 사용자가 보고 싶은 결론 한 줄을 만든다.
type Verdict = "good" | "caution" | "bad" | "unknown";

function buildVerdict(data: AnalyzeResponse): {
  kind: Verdict;
  title: string;
  detail: string;
  hint: string | null;
} {
  const sp = data.self_parking;
  const tr = data.top_recommendation;
  const trc = tr?.candidate;
  const usableCount =
    data.candidates.length +
    (data.external_candidates || []).filter(e => e.usability === "usable").length;
  const cautionCount = (data.external_candidates || []).filter(e => e.usability === "caution")
    .length;
  const excludedCount = data.fallback?.excluded_items?.length ?? 0;
  const trWalkMin = trc?.walking_minutes ?? null;

  // 1) 자체 가능 — 가장 강한 긍정
  if (sp.status === "available" || sp.status === "likely") {
    return {
      kind: "good",
      title: "차 가져가도 괜찮습니다",
      detail: "목적지에 자체 주차가 가능한 것으로 보입니다. 현장에서 한 번 더 확인하세요.",
      hint:
        excludedCount > 0
          ? `근처 타 매장 전용 주차장 ${excludedCount}곳은 추천에서 제외했습니다.`
          : null,
    };
  }
  // 2) 자체 안됨 + 가까운 추천 있음 — 차 가져가도 OK
  if (sp.status === "unavailable" && trc && trWalkMin != null && trWalkMin <= 7) {
    return {
      kind: "good",
      title: "차 가져가도 괜찮습니다",
      detail: `자체 주차장은 없지만 도보 약 ${trWalkMin}분 거리의 추천 주차장이 있습니다.`,
      hint:
        excludedCount > 0
          ? `타 매장 전용 주차장 ${excludedCount}곳은 추천에서 제외했습니다.`
          : null,
    };
  }
  // 3) 자체 안됨 + 추천도 멀거나 없음 — 주의
  if (sp.status === "unavailable") {
    if (trc) {
      return {
        kind: "caution",
        title: "주차 후 좀 걸어야 합니다",
        detail: `자체 주차장은 없습니다. 가까운 추천 주차장까지 도보 약 ${
          trWalkMin ?? "?"
        }분.`,
        hint: cautionCount > 0 ? `추가 확인 필요 후보 ${cautionCount}곳도 함께 표시했습니다.` : null,
      };
    }
    return {
      kind: "bad",
      title: "차로 가는 건 추천하지 않습니다",
      detail: "자체 주차장이 없고, 가까운 공용 주차장도 찾지 못했습니다.",
      hint: "대중교통/택시를 고려해 보세요.",
    };
  }
  // 4) 자체 불확실 + 추천 가까이 — 가능
  if (sp.status === "uncertain" && trc && trWalkMin != null && trWalkMin <= 7) {
    return {
      kind: "good",
      title: "차 가져가도 괜찮습니다",
      detail: `자체 주차는 확인이 필요하지만, 도보 약 ${trWalkMin}분 거리의 추천 주차장이 있습니다.`,
      hint: null,
    };
  }
  // 5) 자체 불확실 + 추천 있음 — 애매
  if (sp.status === "uncertain") {
    if (trc) {
      return {
        kind: "caution",
        title: "확인이 필요합니다",
        detail: `목적지 자체 주차는 매장 확인이 필요합니다. 추천 주차장까지 도보 약 ${
          trWalkMin ?? "?"
        }분.`,
        hint: null,
      };
    }
    return {
      kind: "caution",
      title: "확인이 필요합니다",
      detail: "자체 주차 여부를 확인하기 어렵습니다. 매장에 문의하거나 현장에서 확인하세요.",
      hint: null,
    };
  }
  // 6) 정보 부족
  if (usableCount === 0 && cautionCount === 0 && !trc) {
    return {
      kind: "unknown",
      title: "정보가 부족합니다",
      detail: "이 위치 주변의 주차장 정보를 충분히 찾지 못했습니다. 현장 확인이 필요합니다.",
      hint: null,
    };
  }
  // 7) fallthrough — 정보 부족이지만 추천은 있는 케이스
  return {
    kind: "unknown",
    title: "정보가 부족합니다",
    detail: trc
      ? `자체 주차 정보를 확인할 수 없습니다. 참고 후보로 도보 약 ${trWalkMin ?? "?"}분 거리의 주차장이 있습니다.`
      : "자체 주차 정보를 확인할 수 없습니다.",
    hint: null,
  };
}

// 자체 주차 카드 사용자 친화 문구
function selfParkingCopy(data: AnalyzeResponse): { tag: string; tagKind: Verdict; line: string } {
  const sp = data.self_parking;
  switch (sp.status) {
    case "available":
      return {
        tag: "가능성 높음",
        tagKind: "good",
        line: "지도에 매장 자체 주차장이 등록되어 있습니다.",
      };
    case "likely":
      return {
        tag: "가능성 높음",
        tagKind: "good",
        line: "후기/지도 정보 기준으로 매장 자체 주차가 가능한 것으로 보입니다.",
      };
    case "uncertain":
      return {
        tag: "확인 필요",
        tagKind: "caution",
        line: "매장 자체 주차 여부를 확실히 판단하기 어렵습니다. 방문 전 매장에 확인하는 것이 좋습니다.",
      };
    case "unavailable":
      return {
        tag: "가능성 낮음",
        tagKind: "bad",
        line: "후기 기준으로 매장 자체 주차는 어려운 것으로 보입니다. 아래 추천 주차장을 이용하세요.",
      };
    default:
      return {
        tag: "정보 부족",
        tagKind: "unknown",
        line: "지도/후기에서 자체 주차 정보를 찾지 못했습니다. 현장 확인이 필요합니다.",
      };
  }
}

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
  const [fav, setFav] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // 즐겨찾기 상태 동기화 (data 도착 후)
  useEffect(() => {
    if (!data) return;
    const g = getGroup();
    if (g) {
      api
        .getFavGroup(g.code)
        .then(d => {
          const matched = d.items.find(
            it =>
              (data.destination.place_id != null && it.place_id === data.destination.place_id) ||
              (Math.abs(it.lat - data.destination.lat) < 0.0001 &&
                Math.abs(it.lng - data.destination.lng) < 0.0001)
          );
          setFav(!!matched);
        })
        .catch(() => setFav(false));
    } else {
      setFav(
        isFavorite(
          data.destination.place_id ?? null,
          data.destination.lat,
          data.destination.lng
        )
      );
    }
  }, [data]);

  async function toggleFav() {
    if (!data) return;
    const g = getGroup();
    if (g) {
      try {
        const d = await api.getFavGroup(g.code);
        const existing = d.items.find(
          it =>
            (data.destination.place_id != null && it.place_id === data.destination.place_id) ||
            (Math.abs(it.lat - data.destination.lat) < 0.0001 &&
              Math.abs(it.lng - data.destination.lng) < 0.0001)
        );
        if (existing) {
          await api.removeFavItem(g.code, existing.id);
          setFav(false);
        } else {
          await api.addFavItem(g.code, {
            place_id: data.destination.place_id,
            name: data.destination.name || placeName || "목적지",
            address: data.destination.address,
            lat: data.destination.lat,
            lng: data.destination.lng,
            added_by: getUserToken(),
          });
          setFav(true);
        }
      } catch (e) {
        alert("서버 즐겨찾기 실패: " + (e instanceof Error ? e.message : String(e)));
      }
    } else {
      const next = toggleFavorite({
        place_id: data.destination.place_id ?? null,
        name: data.destination.name || placeName || "목적지",
        address: data.destination.address ?? null,
        lat: data.destination.lat,
        lng: data.destination.lng,
      });
      setFav(next);
    }
  }

  async function doShare() {
    if (!data) return;
    const name = data.destination.name || placeName || "목적지";
    const v = buildVerdict(data);
    const top = data.top_recommendation?.candidate;
    const bits: string[] = [v.title];
    if (top) {
      bits.push(
        `추천: ${top.name}${
          top.walking_minutes != null ? ` (도보 약 ${top.walking_minutes}분)` : ""
        }`
      );
    }
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const res = await sharePage({
      title: `주차될까 - ${name}`,
      text: bits.join(" · "),
      url,
    });
    if (res.kind === "copied") setShareMsg("링크 복사됨");
    else if (res.kind === "error") setShareMsg(res.message);
    else setShareMsg(null);
    if (res.kind === "copied" || res.kind === "error") {
      setTimeout(() => setShareMsg(null), 2500);
    }
  }

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
    // 지도에는 추천 가능 + 확인 필요 만. 추천 제외는 숨김.
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
          usabilityLabel: "1순위 추천",
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
            usabilityLabel:
              e.usability === "usable" ? "추천 가능" : e.usability === "caution" ? "확인 필요" : "추천 제외",
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
      predicted_status:
        c.congestion === "full" || c.congestion === "risky"
          ? "risky"
          : c.congestion === "unknown"
            ? "unknown"
            : "available",
      predicted_risk_score: c.score,
      api_available_count: c.realtime?.available_count ?? null,
      api_total_capacity: c.realtime?.total_capacity ?? null,
    };
    api
      .createVisit(payload)
      .then(v => navigate(`/visits/new?id=${v.id}`))
      .catch(e => setError(e.message));
  }

  function openKakaoMap(c: Candidate) {
    const dest = data?.destination;
    if (!dest) return;
    const url = `https://map.kakao.com/?map_type=TYPE_MAP&target=other&rt=,,${dest.lng},${dest.lat}&rt2=${encodeURIComponent(c.name)}`;
    window.open(url, "_blank");
  }

  // ─── 렌더 ─────────────────────────────────────────────
  const verdict = data ? buildVerdict(data) : null;
  const selfCopy = data ? selfParkingCopy(data) : null;
  const dest = data?.destination;
  const destName = data?.destination.name || placeName || "목적지";

  // 추천 가능 / 확인 필요 / 추천 제외 분리
  // 좌표 없는 외부 후보(매장 안내 페이지 등)는 추천 가능에서 빼고 '확인 필요' 로 격하
  // — 도보 시간 계산 불가 & 진짜 주차장 POI 가 아닐 가능성.
  const hasCoords = (e: ExternalCandidate) => e.lat != null && e.lng != null;
  const usableExt: ExternalCandidate[] = data
    ? (data.external_candidates || []).filter(e => e.usability === "usable" && hasCoords(e))
    : [];
  const cautionExt: ExternalCandidate[] = data
    ? (data.external_candidates || []).filter(
        e =>
          e.usability === "caution" ||
          (e.usability === "usable" && !hasCoords(e))
      )
    : [];
  const excluded: ExternalCandidate[] = data?.fallback?.excluded_items || [];

  return (
    <div>
      {/* 헤더: 목적지 이름 + 즐겨찾기/공유 */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h1 className="h1" style={{ margin: 0 }}>
          {placeName || data?.destination.name || "분석"}
        </h1>
        {data && (
          <>
            <button
              type="button"
              onClick={toggleFav}
              aria-label={fav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              style={{
                background: "transparent",
                border: "none",
                fontSize: 22,
                color: fav ? "#f59e0b" : "#9ca3af",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
              }}
            >
              {fav ? "★" : "☆"}
            </button>
            <button
              type="button"
              onClick={doShare}
              aria-label="공유"
              style={{
                background: "transparent",
                border: "none",
                fontSize: 18,
                color: "#0b6cff",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
              }}
            >
              📤
            </button>
            {shareMsg && (
              <span className="muted" style={{ fontSize: 11 }}>
                {shareMsg}
              </span>
            )}
          </>
        )}
      </div>
      <p className="tagline">{data?.destination.address}</p>

      {/* 반경 선택 칩 */}
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

      {data && verdict && selfCopy && dest && (
        <>
          {/* [1] 최종 판단 카드 — 화면 최상단 */}
          <section className={`verdict-card verdict-${verdict.kind}`} aria-live="polite">
            <div className="verdict-q">차 가져가도 될까?</div>
            <div className="verdict-title">{verdict.title}</div>
            <div className="verdict-detail">{verdict.detail}</div>
            {verdict.hint && <div className="verdict-hint">{verdict.hint}</div>}
          </section>

          {/* [2] 1순위 추천 카드 (자체 가능이면 자체 카드, 아니면 외부 추천) */}
          {(() => {
            const isSelf =
              data.self_parking.status === "available" || data.self_parking.status === "likely";
            const tr = data.top_recommendation;
            if (isSelf) {
              return (
                <section className="top-rec-card top-rec-self">
                  <div className="top-rec-head">
                    <span className="top-rec-badge">⭐ 1순위 — 목적지 자체 주차</span>
                  </div>
                  <div className="top-rec-name">{destName}</div>
                  <div className="top-rec-meta">
                    <strong>주차 후 매장까지 도보 0분</strong>
                  </div>
                  <div className="top-rec-help">
                    매장 자체 주차장 이용을 권장합니다. 실시간 가용은 현장 확인이 필요합니다.
                  </div>
                </section>
              );
            }
            if (!tr) {
              return (
                <section className="top-rec-card top-rec-empty">
                  <div className="top-rec-head">
                    <span className="top-rec-badge top-rec-badge-empty">
                      추천 가능한 주차장을 찾지 못했습니다
                    </span>
                  </div>
                  <div className="top-rec-help">
                    이 위치 주변에서 추천 가능한 주차장이 확인되지 않았습니다. 대중교통/택시
                    이용을 고려해 보세요.
                  </div>
                </section>
              );
            }
            const c = tr.candidate;
            const canRoute = c.lat != null && c.lng != null;
            const distM = c.walking_route_distance_m ?? c.distance_m;
            const distSourceLabel =
              c.walking_route_source === "osrm" ? "실 도보 경로" : "직선거리 기준";
            // 카테고리 → 사용자 표현
            const kindLabel = (() => {
              const cat = c.category || "";
              if (cat.includes("공영")) return "공영주차장";
              if (cat.includes("노상")) return "공영(노상)주차장";
              if (cat.includes("주차")) return "민영/유료주차장";
              return "주차장";
            })();
            return (
              <section className="top-rec-card">
                <div className="top-rec-head">
                  <span className="top-rec-badge">⭐ 1순위 추천 주차장</span>
                </div>
                <div className="top-rec-name">{c.name}</div>
                <div className="top-rec-meta">
                  {c.walking_minutes != null && (
                    <strong>목적지까지 도보 약 {c.walking_minutes}분</strong>
                  )}
                  {distM != null && (
                    <span style={{ marginLeft: 6 }}>
                      · {distM}m ({distSourceLabel})
                    </span>
                  )}
                </div>
                <div className="top-rec-help">
                  {kindLabel} · 운영/요금 확인 필요
                </div>
                <div className="top-rec-help">
                  목적지 자체 주차장이 아닙니다. 주차 후 목적지까지 걸어가야 합니다.
                </div>
                <div className="actions" style={{ marginTop: 10 }}>
                  {canRoute && (
                    <button
                      className="btn primary"
                      onClick={() =>
                        openKakaoFootRoute(
                          { lat: c.lat!, lng: c.lng!, name: c.name },
                          { lat: dest.lat, lng: dest.lng, name: destName }
                        )
                      }
                    >
                      도보 길찾기
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
              </section>
            );
          })()}

          {/* 지도 */}
          <KakaoMap
            center={{ lat: dest.lat, lng: dest.lng }}
            markers={markers}
            destinationLat={dest.lat}
            destinationLng={dest.lng}
            destinationName={destName}
          />

          {/* [3] 목적지 자체 주차 카드 */}
          <section className={`self-card self-card-${selfCopy.tagKind}`}>
            <div className="self-card-head">
              <span className="self-card-title">목적지 자체 주차</span>
              <span className={`tag tag-verdict-${selfCopy.tagKind}`}>{selfCopy.tag}</span>
            </div>
            <div className="self-card-line">{selfCopy.line}</div>

            {data.self_parking.summary_natural && (
              <div className="self-card-quote">💬 {data.self_parking.summary_natural}</div>
            )}

            {/* 사용자 피드백 */}
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
                    누적 응답 {feedbackStats?.total}: ✓ {feedbackStats?.yes_count} · ✗{" "}
                    {feedbackStats?.no_count} · ? {feedbackStats?.unknown_count}
                    {feedbackJustSent && (
                      <span style={{ color: "#16a34a" }}> · 응답 저장됨</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 근거는 접기 영역으로 */}
            {data.self_parking.evidence && data.self_parking.evidence.length > 0 && (
              <details className="self-evidence">
                <summary>판단 근거 {data.self_parking.evidence.length}건 보기</summary>
                <ul className="evidence-list">
                  {data.self_parking.evidence.map((e, i) => (
                    <li key={`ev-${i}`} className="evidence-item">
                      <div className="evidence-head">
                        <span className={`tag tag-${e.confidence}`}>웹 후기 · {e.confidence}</span>
                        {e.title && <span className="evidence-title">{e.title}</span>}
                      </div>
                      {e.snippet && <div className="evidence-snippet">{e.snippet}</div>}
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
          </section>

          {/* 메뉴 카드 (식당/카페) */}
          {data.menu && data.menu.items.length > 0 && (
            <section className="menu-card">
              <div className="menu-card-head">
                <span className="menu-card-title">🍽 인기 메뉴</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  방문 후기 빈도
                </span>
              </div>
              <div className="menu-chips">
                {data.menu.items.map(m => (
                  <span key={m.name} className="menu-chip" title={m.evidence || ""}>
                    {m.name}
                    <span className="menu-chip-count">{m.mentions}회</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* [4] 주차장 후보 리스트 — 3섹션 */}
          {(() => {
            const dbCount = data.candidates.length;
            const recommendCount = dbCount + usableExt.length;
            const cautionCount = cautionExt.length;
            const excludedCount = excluded.length;

            if (recommendCount + cautionCount + excludedCount === 0) {
              return (
                <section className="empty-card">
                  <div className="empty-title">주변 주차장 후보를 찾지 못했습니다</div>
                  <div className="empty-detail">
                    이 반경 안에서 추천 가능한 주차장이 확인되지 않았습니다. 반경을 늘리거나 현장
                    확인이 필요합니다.
                  </div>
                </section>
              );
            }
            return (
              <>
                <h2 className="h2">주변 주차장 후보</h2>

                {/* A. 추천 가능 */}
                {recommendCount > 0 && (
                  <>
                    <div className="section-pill section-pill-good">
                      추천 가능 {recommendCount}곳
                    </div>
                    <ul className="list">
                      {data.candidates.map(c => (
                        <li key={c.id}>
                          <ParkingCard
                            c={c}
                            onSelect={startVisit}
                            onOpenMap={openKakaoMap}
                            destinationLat={dest.lat}
                            destinationLng={dest.lng}
                            destinationName={destName}
                          />
                        </li>
                      ))}
                      {usableExt.map((e, i) => (
                        <li key={`u-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={dest.lat}
                            destinationLng={dest.lng}
                            destinationName={destName}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* B. 확인 필요 */}
                {cautionCount > 0 && (
                  <>
                    <div className="section-pill section-pill-caution">
                      확인 필요 {cautionCount}곳
                    </div>
                    <div className="section-help">
                      운영/요금/일반 개방 여부가 명확하지 않은 후보입니다. 방문 전 확인 후 이용하세요.
                    </div>
                    <ul className="list">
                      {cautionExt.map((e, i) => (
                        <li key={`c-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={dest.lat}
                            destinationLng={dest.lng}
                            destinationName={destName}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* C. 추천 제외 — 접힘 */}
                {excludedCount > 0 && (
                  <details className="excluded-block">
                    <summary>
                      추천 제외 {excludedCount}곳 보기 (타 매장/기관 전용으로 보이는 후보)
                    </summary>
                    <div className="section-help">
                      목적지 방문자가 임의로 이용하기 어려울 수 있어 추천에서 제외했습니다.
                    </div>
                    <ul className="list" style={{ marginTop: 8 }}>
                      {excluded.map((e, i) => (
                        <li key={`x-${i}`}>
                          <ExternalCard
                            c={e}
                            destinationLat={dest.lat}
                            destinationLng={dest.lng}
                            destinationName={destName}
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            );
          })()}

          {/* 과거 기록 */}
          {data.history_for_destination.length > 0 && (
            <>
              <h2 className="h2">이 목적지의 과거 기록</h2>
              <ul className="list">
                {data.history_for_destination.map(h => (
                  <li key={h.visit_id} className="list-item">
                    <span className="title">{h.selected_parking_name || "(주차장 미선택)"}</span>
                    <span className="sub">
                      {new Date(h.searched_at).toLocaleString("ko-KR")}
                      {" · "}
                      {h.actual_result ?? "결과 미입력"}
                    </span>
                    {h.memo && <span className="sub">메모: {h.memo}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 데이터 기준 — 접힘 */}
          <details className="data-source">
            <summary>데이터 기준</summary>
            <ul className="data-source-list">
              <li>공식 주차장 데이터 (시·도 공공 주차장)</li>
              <li>카카오맵 등록 주차장 검색</li>
              <li>네이버 블로그/카페 후기 (자체 주차 판단·메뉴 추출)</li>
              <li>실시간 잔여면수는 일부 공영주차장만 제공됩니다</li>
              <li>운영/요금은 현장과 다를 수 있으며 방문 전 확인을 권장합니다</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
