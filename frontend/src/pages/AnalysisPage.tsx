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
import PlanACard from "../components/analysis/PlanACard";
import NearbyTransitCard from "../components/analysis/NearbyTransitCard";
import NearbyEvCard from "../components/analysis/NearbyEvCard";
import PlanBPanel from "../components/analysis/PlanBPanel";
import AlternativePlaceSection from "../components/analysis/AlternativePlaceSection";
import VisitFeedbackCard from "../components/analysis/VisitFeedbackCard";
import SelfParkingCard from "../components/analysis/SelfParkingCard";
import ParkingCandidateSection from "../components/analysis/ParkingCandidateSection";
import DataBasisPanel from "../components/analysis/DataBasisPanel";
import { buildVerdict, selfParkingCopy } from "../utils/parkingPresentation";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { getGroup } from "../lib/favoritesGroup";
import { sharePage } from "../lib/share";
import ShareImageCard from "../components/analysis/ShareImageCard";
import { AnalysisSkeleton } from "../components/Skeleton";
import ResultVerdictCard from "../components/analysis/ResultVerdictCard";
import JudgmentReasonCard from "../components/analysis/JudgmentReasonCard";
import RecommendedActionCard from "../components/analysis/RecommendedActionCard";
import { applySeo } from "../lib/seo";
import { buildParkingResult } from "../utils/parkingResult";

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
  // (시트 폐기 — 사용자 피드백: 위 고정/아래 스크롤이 답답함. 페이지 전체 스크롤로 전환)

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
  const parkingResult = data ? buildParkingResult(data, placeName) : null;

  // SEO — 동적 title/og 메타. 장소명 기반.
  useEffect(() => {
    if (!parkingResult) return;
    const name = parkingResult.placeName;
    const desc = `${name} 방문 전 주차 난이도, 주변 주차장 후보, 차량 방문 추천 여부를 확인하세요.`;
    applySeo({
      title: `${name} 주차될까? | 주차 가능성 분석`,
      description: desc,
      url: typeof window !== "undefined" ? window.location.href : undefined,
    });
  }, [parkingResult]);

  // 상단 재검색 — 현재 장소명을 보여주고 수정 가능
  const [topSearchQ, setTopSearchQ] = useState(placeName);
  useEffect(() => setTopSearchQ(placeName), [placeName]);

  // 공유 toast (Web Share API 미지원 시 URL 복사)
  const [copyToast, setCopyToast] = useState<string | null>(null);
  async function shareWithFallback() {
    const name = parkingResult?.placeName ?? placeName;
    const url = window.location.href;
    const text = `${name} 주차될까? 차량 방문 전 주차 난이도와 주변 주차장 후보를 확인해보세요.`;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${name} 주차될까?`, text, url });
        return;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopyToast("결과 링크를 복사했어요.");
      setTimeout(() => setCopyToast(null), 2400);
    } catch {
      setCopyToast("복사에 실패했어요. URL 을 직접 복사해 주세요.");
      setTimeout(() => setCopyToast(null), 2400);
    }
  }
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

      {error && (
        <div className="analyze-error-wrap">
          <div className="analyze-error-card">
            <div className="analyze-error-title">분석 결과를 불러오지 못했어요</div>
            <div className="analyze-error-sub">
              잠시 후 다시 시도하거나 다른 장소를 검색해 주세요.
            </div>
            <div className="analyze-error-actions">
              <button
                className="lh-hero-cta"
                type="button"
                onClick={() => window.location.reload()}
              >
                다시 시도
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => navigate("/")}
              >
                다른 장소 검색
              </button>
            </div>
          </div>
        </div>
      )}
      {!data && !error && (
        <div className="analyze-loading-wrap">
          <div className="analyze-loading-copy">
            <div className="analyze-loading-title">주차 정보를 분석하고 있어요</div>
            <div className="analyze-loading-sub">
              장소 정보와 주변 주차장 후보를 확인하는 중입니다.
            </div>
          </div>
          <AnalysisSkeleton />
        </div>
      )}

      {data && verdict && selfCopy && dest && parkingResult && (
        <div className="analyze-result-stream">
          <ResultVerdictCard result={parkingResult} />
          <>
              {/* 상단 재검색 — 현재 장소명 수정 가능 */}
              <form
                className="lh-hero-search result-top-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = topSearchQ.trim();
                  if (!q) return;
                  navigate(`/places?q=${encodeURIComponent(q)}`);
                }}
              >
                <div className="lh-search-row">
                  <span className="lh-search-icon" aria-hidden>🔎</span>
                  <input
                    type="search"
                    inputMode="search"
                    value={topSearchQ}
                    onChange={(e) => setTopSearchQ(e.target.value)}
                    placeholder="다른 장소를 검색해보세요"
                  />
                </div>
                <button type="submit" className="lh-hero-cta">
                  주차 가능성 확인
                </button>
              </form>

              {/* 판단 근거 */}
              <JudgmentReasonCard result={parkingResult} />

              {/* 추천 행동 (결론 → 근거 → 행동 순서) */}
              <RecommendedActionCard
                result={parkingResult}
                destLat={dest.lat}
                destLng={dest.lng}
                onShare={shareWithFallback}
                onScrollToNearby={() => {
                  const el = document.getElementById("anchor-nearby-parking");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />

              {/* 1순위 주차 플랜 */}
              <PlanACard data={data} destName={destName} />

              {/* 근처 주차장 후보 */}
              <div id="anchor-nearby-parking">
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
              </div>

              {/* 조건부: PlanB / 대체 장소 */}
              {(verdict.kind === "caution" ||
                verdict.kind === "bad" ||
                verdict.kind === "unknown") && (
                <>
                  <PlanBPanel data={data} destName={destName} />
                  <AlternativePlaceSection
                    destLat={dest.lat}
                    destLng={dest.lng}
                    destCategoryGroup={null}
                    destName={destName}
                  />
                </>
              )}

              {/* 피드백 5: 전기차 충전소 */}
              <NearbyEvCard destLat={dest.lat} destLng={dest.lng} />

              {/* 피드백 6: 주변 정류장 — 대중교통 추천 보조 */}
              <NearbyTransitCard destLat={dest.lat} destLng={dest.lng} />

              {/* 보조: 자체 주차 evidence + 사용자 피드백 */}
              <SelfParkingCard
                data={data}
                copy={selfCopy}
                feedbackBusy={feedbackBusy}
                feedbackStats={feedbackStats}
                feedbackJustSent={feedbackJustSent}
                onFeedback={sendFeedback}
              />
              <VisitFeedbackCard
                placeId={data.destination.place_id ?? null}
                feedbackBusy={feedbackBusy}
                feedbackStats={feedbackStats}
                feedbackJustSent={feedbackJustSent}
                onSubmit={({ answer, note }) => sendFeedback(answer, note)}
              />

              {/* 주의 문구 */}
              <div className="result-disclaimer">
                <p>
                  <strong>이 결과는 방문 전 참고용 정보입니다.</strong> 실시간 주차
                  가능 대수, 요금, 운영 여부는 실제 현장 상황과 다를 수 있습니다.
                </p>
                <p className="result-disclaimer-sub">
                  정확한 주차 가능 여부는 방문 전 지도 앱, 주차장 운영 정보, 매장 안내를
                  함께 확인해 주세요.
                </p>
              </div>
              <DataBasisPanel />

              {/* 다른 장소 검색 */}
              <div className="result-research">
                <h3 className="result-research-title">다른 장소도 확인해볼까요?</h3>
                <form
                  className="lh-hero-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = (
                      e.currentTarget.querySelector("input") as HTMLInputElement
                    )?.value?.trim();
                    if (!q) return;
                    navigate(`/places?q=${encodeURIComponent(q)}`);
                  }}
                >
                  <div className="lh-search-row">
                    <span className="lh-search-icon" aria-hidden>🔎</span>
                    <input
                      type="search"
                      inputMode="search"
                      placeholder="다른 장소명을 입력하세요"
                    />
                  </div>
                  <button type="submit" className="lh-hero-cta">
                    주차 가능성 확인하기
                  </button>
                </form>
              </div>
          </>
        </div>
      )}

      {/* 공유 toast */}
      {copyToast && (
        <div className="copy-toast" role="status">
          {copyToast}
        </div>
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
