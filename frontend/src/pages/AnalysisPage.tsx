import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type {
  AnalyzeResponse,
  Candidate,
  ExternalCandidate,
  SelfParkingFeedbackStats,
} from "../types/parking";
import KakaoMap, { MapMarker } from "../components/KakaoMap";
import AnalysisHeader from "../components/analysis/AnalysisHeader";
import VerdictCard from "../components/analysis/VerdictCard";
import AnalysisBottomSheet, {
  SheetState,
} from "../components/analysis/AnalysisBottomSheet";
import TopRecommendationCard from "../components/analysis/TopRecommendationCard";
import SelfParkingCard from "../components/analysis/SelfParkingCard";
import MenuCard from "../components/analysis/MenuCard";
import ParkingCandidateSection from "../components/analysis/ParkingCandidateSection";
import DataBasisPanel from "../components/analysis/DataBasisPanel";
import { buildVerdict, selfParkingCopy } from "../utils/parkingPresentation";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { getGroup } from "../lib/favoritesGroup";
import { sharePage } from "../lib/share";

function getUserToken(): string {
  try {
    const k = "pk_user_token";
    let v = localStorage.getItem(k);
    if (!v) {
      v = (crypto?.randomUUID?.() ?? `u-${Date.now()}-${Math.random()}`).slice(
        0,
        40,
      );
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "anon";
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
  const [feedbackStats, setFeedbackStats] =
    useState<SelfParkingFeedbackStats | null>(null);
  const [feedbackJustSent, setFeedbackJustSent] = useState<
    "yes" | "no" | "unknown" | null
  >(null);
  const [fav, setFav] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("half");

  useEffect(() => {
    if (!data) return;
    const g = getGroup();
    if (g) {
      api
        .getFavGroup(g.code)
        .then((d) => {
          const matched = d.items.find(
            (it) =>
              (data.destination.place_id != null &&
                it.place_id === data.destination.place_id) ||
              (Math.abs(it.lat - data.destination.lat) < 0.0001 &&
                Math.abs(it.lng - data.destination.lng) < 0.0001),
          );
          setFav(!!matched);
        })
        .catch(() => setFav(false));
    } else {
      setFav(
        isFavorite(
          data.destination.place_id ?? null,
          data.destination.lat,
          data.destination.lng,
        ),
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
          (it) =>
            (data.destination.place_id != null &&
              it.place_id === data.destination.place_id) ||
            (Math.abs(it.lat - data.destination.lat) < 0.0001 &&
              Math.abs(it.lng - data.destination.lng) < 0.0001),
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
        alert(
          "서버 즐겨찾기 실패: " + (e instanceof Error ? e.message : String(e)),
        );
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
        `추천: ${top.name}${top.walking_minutes != null ? ` (도보 약 ${top.walking_minutes}분)` : ""}`,
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
      const sum = await api.selfParkingFeedbackSummary(
        data.destination.place_id,
      );
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
      .then((d) => {
        setData(d);
        setFeedbackStats(d.self_parking_feedback_stats);
        setFeedbackJustSent(null);
      })
      .catch((e) => setError(e.message));
  }, [place_id, lat, lng, radius]);

  // 마커: 목적지 + 추천(P1) + 거리순으로 P2, P3, ... 짧은 라벨만 표시.
  // 전체 이름은 마커 클릭 시 KakaoMap 의 팝업에서 보여준다.
  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const externalForMap = (data.external_candidates || []).filter(
      (e) =>
        e.lat != null && e.lng != null && e.usability !== "private_restricted",
    );
    const tr = data.top_recommendation;
    const recLat = tr?.candidate.lat;
    const recLng = tr?.candidate.lng;
    const isSameMarker = (la: number | null, lo: number | null) =>
      recLat != null && recLng != null && la === recLat && lo === recLng;

    const out: MapMarker[] = [
      {
        id: "dest",
        lat: data.destination.lat,
        lng: data.destination.lng,
        label: "목적지",
        kind: "destination",
      },
    ];
    if (tr && recLat != null && recLng != null) {
      out.push({
        id: "top-rec",
        lat: recLat,
        lng: recLng,
        label: "P1",
        kind: "recommended",
        detail: {
          name: tr.candidate.name,
          usability: "usable",
          usabilityLabel: "1순위 추천",
          distanceM:
            tr.candidate.walking_route_distance_m ?? tr.candidate.distance_m,
          walkingMinutes: tr.candidate.walking_minutes,
          routeSource: tr.candidate.walking_route_source,
        },
      });
    }
    let pn = 2;
    out.push(
      ...data.candidates
        .filter((c) => !isSameMarker(c.lat, c.lng))
        .map<MapMarker>((c) => ({
          id: String(c.id),
          lat: c.lat,
          lng: c.lng,
          label: `P${pn++}`,
          kind: "parking",
          detail: {
            name: c.name,
            usability: "usable",
            usabilityLabel: "추천 가능",
            distanceM: c.walking_route_distance_m ?? c.distance_m,
            walkingMinutes: c.walk_minutes,
            routeSource: c.walking_route_source,
          },
        })),
      ...externalForMap
        .filter((e) => !isSameMarker(e.lat, e.lng))
        .map<MapMarker>((e) => ({
          id: `ext-${pn}`,
          lat: e.lat as number,
          lng: e.lng as number,
          label: `P${pn++}`,
          kind: "parking",
          detail: {
            name: e.name,
            usability: e.usability,
            usabilityLabel:
              e.usability === "usable"
                ? "추천 가능"
                : e.usability === "caution"
                  ? "확인 필요"
                  : "추천 제외",
            distanceM: e.walking_route_distance_m ?? e.distance_m,
            walkingMinutes: e.walking_minutes,
            routeSource: e.walking_route_source,
          },
        })),
    );
    return out;
  }, [data]);

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
      .then((v) => navigate(`/visits/new?id=${v.id}`))
      .catch((e) => setError(e.message));
  }

  const verdict = data ? buildVerdict(data) : null;
  const selfCopy = data ? selfParkingCopy(data) : null;
  const dest = data?.destination;
  const destName = data?.destination.name || placeName || "목적지";

  const hasCoords = (e: ExternalCandidate) => e.lat != null && e.lng != null;
  const usableExt: ExternalCandidate[] = data
    ? (data.external_candidates || []).filter(
        (e) => e.usability === "usable" && hasCoords(e),
      )
    : [];
  const cautionExt: ExternalCandidate[] = data
    ? (data.external_candidates || []).filter(
        (e) =>
          e.usability === "caution" ||
          (e.usability === "usable" && !hasCoords(e)),
      )
    : [];
  const excluded: ExternalCandidate[] = data?.fallback?.excluded_items || [];

  return (
    <div className="analyze-screen">
      <AnalysisHeader
        title={placeName || data?.destination.name || "분석"}
        address={data?.destination.address}
        fav={fav}
        shareMsg={shareMsg}
        radius={radius}
        onBack={() => navigate(-1)}
        onToggleFav={toggleFav}
        onShare={doShare}
        onChangeRadius={setRadius}
      />

      <div className="analyze-map">
        {dest && (
          <KakaoMap
            center={{ lat: dest.lat, lng: dest.lng }}
            markers={markers}
            destinationLat={dest.lat}
            destinationLng={dest.lng}
            destinationName={destName}
            className="map-fullbleed"
          />
        )}
      </div>

      {error && <div className="analyze-error">{error}</div>}
      {!data && !error && <div className="analyze-loading">분석 중...</div>}

      {data && verdict && selfCopy && dest && (
        <AnalysisBottomSheet
          state={sheetState}
          onChangeState={setSheetState}
          peek={<VerdictCard verdict={verdict} />}
          body={
            <>
              {verdict.hint && (
                <div className="verdict-hint-inline">{verdict.hint}</div>
              )}

              <TopRecommendationCard data={data} destName={destName} />

              <SelfParkingCard
                data={data}
                copy={selfCopy}
                feedbackBusy={feedbackBusy}
                feedbackStats={feedbackStats}
                feedbackJustSent={feedbackJustSent}
                onFeedback={sendFeedback}
              />

              {data.menu && data.menu.items.length > 0 && (
                <MenuCard menu={data.menu} />
              )}

              <ParkingCandidateSection
                dbCandidates={data.candidates}
                usableExt={usableExt}
                cautionExt={cautionExt}
                excluded={excluded}
                destinationLat={dest.lat}
                destinationLng={dest.lng}
                destinationName={destName}
                onSelectDb={startVisit}
              />

              {data.history_for_destination.length > 0 && (
                <>
                  <h2 className="h2" style={{ marginTop: 16 }}>
                    이 목적지의 과거 기록
                  </h2>
                  <ul className="list">
                    {data.history_for_destination.map((h) => (
                      <li key={h.visit_id} className="list-item">
                        <span className="title">
                          {h.selected_parking_name || "(주차장 미선택)"}
                        </span>
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

              <DataBasisPanel />
            </>
          }
        />
      )}
    </div>
  );
}
