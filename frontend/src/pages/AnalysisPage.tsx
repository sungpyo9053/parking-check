import { useEffect, useMemo, useRef, useState } from "react";
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
import ParkingHellLevelCard from "../components/analysis/ParkingHellLevelCard";
import CarCompatibilityCard from "../components/analysis/CarCompatibilityCard";
import DrivingScenarioTimeline from "../components/analysis/DrivingScenarioTimeline";
import ShareablePunchline from "../components/analysis/ShareablePunchline";
import AnalysisBottomSheet, {
  SheetState,
} from "../components/analysis/AnalysisBottomSheet";
import PlanACard from "../components/analysis/PlanACard";
import PlanBPanel from "../components/analysis/PlanBPanel";
import AlternativePlaceSection from "../components/analysis/AlternativePlaceSection";
import VisitFeedbackCard from "../components/analysis/VisitFeedbackCard";
import SelfParkingCard from "../components/analysis/SelfParkingCard";
import MenuCard from "../components/analysis/MenuCard";
import ParkingCandidateSection from "../components/analysis/ParkingCandidateSection";
import DataBasisPanel from "../components/analysis/DataBasisPanel";
import { buildVerdict, selfParkingCopy } from "../utils/parkingPresentation";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { getGroup } from "../lib/favoritesGroup";
import { sharePage } from "../lib/share";
import ShareImageCard from "../components/analysis/ShareImageCard";

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
  // 모바일에서는 결과 카드들이 한눈에 보이도록 기본을 expanded 로 둔다.
  // 사용자가 지도 보고 싶으면 핸들 / 헤더 탭으로 줄임.
  const [sheetState, setSheetState] = useState<SheetState>("expanded");

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

  const shareCardRef = useRef<HTMLDivElement | null>(null);

  async function doShare() {
    if (!data) return;
    const name = data.destination.name || placeName || "목적지";
    const v = buildVerdict(data);
    const top = data.top_recommendation?.candidate;
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;

    // 1) 이미지 캡처 시도 (오프스크린 ShareImageCard → blob)
    let imageFile: File | null = null;
    try {
      if (shareCardRef.current) {
        const { default: html2canvas } = await import("html2canvas-pro");
        const canvas = await html2canvas(shareCardRef.current, {
          backgroundColor: null,
          scale: 2,
          logging: false,
          useCORS: true,
        });
        const blob: Blob | null = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (blob)
          imageFile = new File([blob], `parking-check-${name}.png`, {
            type: "image/png",
          });
      }
    } catch (e) {
      // 캡처 실패해도 텍스트 공유로 폴백
      console.warn("share image capture failed", e);
    }

    // 2) 이미지가 있고 Web Share API 가 파일 지원하면 이미지로 공유
    if (
      imageFile &&
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [imageFile] })
    ) {
      try {
        await navigator.share({
          title: `주차될까 - ${name}`,
          text: v.title,
          url,
          files: [imageFile],
        });
        setShareMsg("공유됨");
        setTimeout(() => setShareMsg(null), 2000);
        return;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === "AbortError") return;
        // 실패 시 다운로드로 폴백
      }
    }

    // 3) 이미지 다운로드 폴백 (데스크탑 / 파일 공유 미지원 브라우저)
    if (imageFile) {
      const objUrl = URL.createObjectURL(imageFile);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = imageFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      setShareMsg("이미지 저장됨");
      setTimeout(() => setShareMsg(null), 2000);
      return;
    }

    // 4) 최종 폴백: 텍스트 + 링크
    const bits: string[] = [v.title];
    if (top)
      bits.push(
        `추천: ${top.name}${top.walking_minutes != null ? ` (도보 약 ${top.walking_minutes}분)` : ""}`,
      );
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

  async function sendFeedback(
    answer: "yes" | "no" | "unknown",
    note: string | null = null,
  ) {
    if (!data?.destination.place_id) return;
    setFeedbackBusy(true);
    try {
      await api.submitSelfParkingFeedback(data.destination.place_id, {
        answer,
        note: note ?? undefined,
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
    if (placeName) params.name = placeName;
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
              {/* 흐름 2: 주차 헬 난이도 (Stress 대체) */}
              <ParkingHellLevelCard verdict={verdict} />

              {/* 신박 1: 내 차 궁합 */}
              <CarCompatibilityCard data={data} verdict={verdict} />

              {/* 흐름 3: 플랜 A — 1순위 주차 플랜 */}
              <PlanACard data={data} destName={destName} />

              {/* 신박 3: 차 가져가면 예상 시나리오 */}
              <DrivingScenarioTimeline data={data} verdict={verdict} />

              {/* 흐름 4: 주차 실패했어요 — 플랜 B 토글 */}
              <PlanBPanel data={data} destName={destName} />

              {/* 흐름 5: 주차 쉬운 대체 장소 (uncertain/unavailable/unknown 일 때만) */}
              {(verdict.kind === "caution" ||
                verdict.kind === "bad" ||
                verdict.kind === "unknown") && (
                <AlternativePlaceSection
                  destLat={dest.lat}
                  destLng={dest.lng}
                  destCategoryGroup={null}
                  destName={destName}
                />
              )}

              {/* 보조: 자체주차 evidence 인용 (셀프 라벨링 버튼은 제거 — VisitFeedbackCard 로 통일) */}
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

              {/* 보조: 전체 후보 리스트 (참고용, 펼치기로 둘 수 있음) */}
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

              {/* 신박 4: 공유용 한 줄 밈 */}
              <ShareablePunchline verdict={verdict} />

              {/* 흐름 6: 방문 후 3초 제보 */}
              <VisitFeedbackCard
                placeId={data.destination.place_id ?? null}
                feedbackBusy={feedbackBusy}
                feedbackStats={feedbackStats}
                feedbackJustSent={feedbackJustSent}
                onSubmit={({ answer, note }) => sendFeedback(answer, note)}
              />

              <DataBasisPanel />
            </>
          }
        />
      )}

      {/* 오프스크린 공유 이미지 카드 — 캡처용 (visually hidden) */}
      {data && verdict && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: -10000,
            pointerEvents: "none",
            opacity: 1,
          }}
        >
          <ShareImageCard
            ref={shareCardRef}
            destName={destName}
            verdict={verdict}
            data={data}
          />
        </div>
      )}
    </div>
  );
}
