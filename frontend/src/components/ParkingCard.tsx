import type { Candidate } from "../lib/api";
import RiskBadge from "./RiskBadge";
import { openKakaoFootRoute } from "../lib/maps";

type Props = {
  c: Candidate;
  onSelect?: (c: Candidate) => void;
  onOpenMap?: (c: Candidate) => void;
  destinationLat?: number;
  destinationLng?: number;
  destinationName?: string;
};

export default function ParkingCard({
  c,
  onSelect,
  onOpenMap,
  destinationLat,
  destinationLng,
  destinationName,
}: Props) {
  function openFootRoute() {
    if (destinationLat == null || destinationLng == null) return;
    openKakaoFootRoute(
      { lat: c.lat, lng: c.lng, name: c.name },
      { lat: destinationLat, lng: destinationLng, name: destinationName || "목적지" }
    );
  }

  const distM = c.walking_route_distance_m ?? c.distance_m;
  const distLabel = c.walking_route_source === "osrm" ? "실 도보 경로" : "직선거리 기준";

  return (
    <div className="pcard pcard-usable">
      <div className="head">
        <span className="tag tag-verdict-good">추천 가능</span>
        <RiskBadge value={c.congestion} />
      </div>
      <div className="name" style={{ fontWeight: 700, marginTop: 4 }}>
        {c.name}
      </div>
      <div className="meta meta-walk">
        {c.walk_minutes != null ? (
          <strong>목적지까지 도보 약 {c.walk_minutes}분</strong>
        ) : (
          <strong>도보 시간 산정 불가</strong>
        )}
        {distM != null && (
          <span style={{ marginLeft: 6 }}>
            · {distM}m ({distLabel})
          </span>
        )}
      </div>
      <div className="meta">
        {c.type && <span>{c.type}</span>}
        {c.capacity != null && <span>· 총 {c.capacity}면</span>}
        {c.is_open_now === false && <span>· 운영시간 외</span>}
      </div>
      {c.realtime && (
        <div className="meta">
          잔여 {c.realtime.available_count ?? "?"} / {c.realtime.total_capacity ?? "?"} 면
          {c.realtime.stale_seconds != null && (
            <span> · {Math.round(c.realtime.stale_seconds / 60)}분 전 기준</span>
          )}
        </div>
      )}
      {c.fee_summary && <div className="meta">{c.fee_summary}</div>}
      {c.history && c.history.my_visits > 0 && (
        <div className="reasons">
          내 방문 {c.history.my_visits}회
          {c.history.my_success_rate != null &&
            ` · 성공률 ${Math.round(c.history.my_success_rate * 100)}%`}
        </div>
      )}
      <div className="actions">
        {destinationLat != null && destinationLng != null ? (
          <button className="btn primary" onClick={openFootRoute}>
            도보 길찾기
          </button>
        ) : (
          <button className="btn primary" onClick={() => onOpenMap?.(c)}>
            카카오맵에서 열기
          </button>
        )}
        <button className="btn" onClick={() => onSelect?.(c)}>
          이 주차장으로 가기
        </button>
      </div>
    </div>
  );
}
