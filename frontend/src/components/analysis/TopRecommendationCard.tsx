import type { AnalyzeResponse } from "../../types/parking";
import { openKakaoFootRoute } from "../../lib/maps";
import {
  distanceSourceLabel,
  kindLabel,
} from "../../utils/parkingPresentation";

type Props = {
  data: AnalyzeResponse;
  destName: string;
};

/** 1순위 추천 카드 — Apple Maps-ish 둥근 카드 + Toss-ish 큰 결론.
 *  - 자체 주차 가능 → 목적지 자체 안내
 *  - 추천 후보 있음 → 1순위 후보 강조 (큰 도보 분)
 *  - 둘 다 없음 → empty
 */
export default function TopRecommendationCard({ data, destName }: Props) {
  const sp = data.self_parking;
  const tr = data.top_recommendation;
  const dest = data.destination;
  // 자체주차 1순위로 표시할 조건:
  //  1) status 가 명시적으로 available/likely 이거나
  //  2) uncertain 이지만 사용자 셀프 라벨 다수가 "있었음" 인 경우 (yes_ratio>=0.7 + total>=2)
  const fb = data.self_parking_feedback_stats;
  const totalFb = fb?.total ?? 0;
  const yesFb = fb?.yes_count ?? 0;
  const yesRatio = totalFb > 0 ? yesFb / totalFb : 0;
  const userVouched =
    sp.status === "uncertain" && totalFb >= 2 && yesFb >= 2 && yesRatio >= 0.7;
  const isSelf =
    sp.status === "available" || sp.status === "likely" || userVouched;

  if (isSelf) {
    return (
      <div className="top-rec-card top-rec-self">
        <div className="top-rec-badge-row">
          <span className="top-rec-badge">⭐ 1순위 — 목적지 자체 주차</span>
        </div>
        <div className="top-rec-headline">
          <span className="top-rec-walk-big">매장 자체</span>
          <span className="top-rec-walk-unit">주차</span>
        </div>
        <div className="top-rec-name">{destName}</div>
        <div className="top-rec-reason">
          매장 자체 주차장 이용을 권장합니다. 주차 위치/실시간 가용은
          현장에서 확인이 필요합니다.
        </div>
      </div>
    );
  }

  if (!tr) {
    return (
      <div className="top-rec-card top-rec-empty">
        <div className="top-rec-badge-row">
          <span className="top-rec-badge top-rec-badge-empty">
            추천 가능한 주차장을 찾지 못했습니다
          </span>
        </div>
        <div className="top-rec-reason">
          이 위치 주변에서 추천 가능한 주차장이 확인되지 않았습니다.
          대중교통/택시 이용을 고려해 보세요.
        </div>
      </div>
    );
  }

  const c = tr.candidate;
  const canRoute = c.lat != null && c.lng != null;
  const distM = c.walking_route_distance_m ?? c.distance_m;
  const reason =
    `${kindLabel(c.category)} · 운영/요금은 카카오맵에서 확인하세요`;

  return (
    <div className="top-rec-card">
      <div className="top-rec-badge-row">
        <span className="top-rec-badge">⭐ 1순위 추천</span>
      </div>
      <div className="top-rec-headline">
        {c.walking_minutes != null ? (
          <>
            <span className="top-rec-walk-big">도보 {c.walking_minutes}</span>
            <span className="top-rec-walk-unit">분</span>
          </>
        ) : (
          <>
            <span className="top-rec-walk-big">근거리</span>
            <span className="top-rec-walk-unit">주차장</span>
          </>
        )}
      </div>
      <div className="top-rec-name">{c.name}</div>
      <div className="top-rec-reason">
        {reason}
        {distM != null && (
          <span className="top-rec-dist">
            {" "}
            · {distM}m ({distanceSourceLabel(c.walking_route_source)})
          </span>
        )}
      </div>
      <div className="top-rec-actions">
        {canRoute && (
          <button
            className="btn primary top-rec-cta"
            onClick={() =>
              openKakaoFootRoute(
                { lat: c.lat!, lng: c.lng!, name: c.name },
                { lat: dest.lat, lng: dest.lng, name: destName },
              )
            }
          >
            도보 길찾기
          </button>
        )}
        {c.url && (
          <button
            className="btn top-rec-cta-secondary"
            onClick={() => window.open(c.url!, "_blank", "noopener,noreferrer")}
          >
            카카오맵 상세
          </button>
        )}
      </div>
    </div>
  );
}
