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

/** 1순위 추천 카드.
 *  - 자체 주차 가능 → 목적지 자체 안내 (도보 분 표시는 의미 없으므로 생략)
 *  - 추천 후보 있음 → 1순위 후보 강조
 *  - 둘 다 없음 → empty state */
export default function TopRecommendationCard({ data, destName }: Props) {
  const sp = data.self_parking;
  const tr = data.top_recommendation;
  const dest = data.destination;
  const isSelf = sp.status === "available" || sp.status === "likely";

  if (isSelf) {
    return (
      <div className="top-rec-card top-rec-self">
        <div className="top-rec-head">
          <span className="top-rec-badge">⭐ 1순위 — 목적지 자체 주차</span>
        </div>
        <div className="top-rec-name">{destName}</div>
        <div className="top-rec-help">
          매장 자체 주차장 이용을 권장합니다. 주차 위치/실시간 가용은 현장에서
          확인이 필요합니다.
        </div>
      </div>
    );
  }

  if (!tr) {
    return (
      <div className="top-rec-card top-rec-empty">
        <div className="top-rec-head">
          <span className="top-rec-badge top-rec-badge-empty">
            추천 가능한 주차장을 찾지 못했습니다
          </span>
        </div>
        <div className="top-rec-help">
          이 위치 주변에서 추천 가능한 주차장이 확인되지 않았습니다.
          대중교통/택시 이용을 고려해 보세요.
        </div>
      </div>
    );
  }

  const c = tr.candidate;
  const canRoute = c.lat != null && c.lng != null;
  const distM = c.walking_route_distance_m ?? c.distance_m;

  return (
    <div className="top-rec-card">
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
            · {distM}m ({distanceSourceLabel(c.walking_route_source)})
          </span>
        )}
      </div>
      <div className="top-rec-help">
        {kindLabel(c.category)} · 운영/요금 확인 필요
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
                { lat: dest.lat, lng: dest.lng, name: destName },
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
    </div>
  );
}
