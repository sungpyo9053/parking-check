import type { ExternalCandidate } from "../lib/api";
import { kakaoMapSearchUrl, openKakaoFootRoute } from "../lib/maps";

type Props = {
  c: ExternalCandidate;
  destinationLat: number;
  destinationLng: number;
  destinationName?: string;
};

function sourceBadgeClass(source: ExternalCandidate["source"]): string {
  if (source === "kakao_fallback") return "tag tag-kakao";
  if (source === "web_search") return "tag tag-web";
  return "tag";
}

function usabilityBadgeClass(u: ExternalCandidate["usability"]): string {
  if (u === "usable") return "tag tag-usable";
  if (u === "caution") return "tag tag-caution";
  return "tag tag-excluded";
}

export default function ExternalCard({ c, destinationLat, destinationLng, destinationName }: Props) {
  const isWeb = c.source === "web_search";
  const hasCoords = c.lat != null && c.lng != null;

  function openKakaoMapSearch() {
    const url = kakaoMapSearchUrl("주차장", { lat: destinationLat, lng: destinationLng });
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openSource() {
    if (!c.url) return;
    window.open(c.url, "_blank", "noopener,noreferrer");
  }

  function openFootRoute() {
    if (c.lat == null || c.lng == null) return;
    openKakaoFootRoute(
      { lat: c.lat, lng: c.lng, name: c.name },
      { lat: destinationLat, lng: destinationLng, name: destinationName || "목적지" }
    );
  }

  const isExcluded = c.usability === "private_restricted";

  return (
    <div className={`pcard pcard-external pcard-${c.usability}`}>
      <div className="head">
        <span className="name" style={isExcluded ? { textDecoration: "line-through", color: "#9ca3af" } : undefined}>
          {c.name}
        </span>
        <span className={usabilityBadgeClass(c.usability)}>{c.usability_label}</span>
      </div>

      <div className="meta">
        <span className={sourceBadgeClass(c.source)}>{c.source_label}</span>
      </div>

      {c.snippet && <div className="meta external-snippet">{c.snippet}</div>}

      <div className="meta">
        {c.distance_m != null && <span>{c.distance_m}m</span>}
        {c.distance_m != null && (c.address || c.road_address) && <span> · </span>}
        {(c.address || c.road_address) && (
          <span>{c.road_address || c.address}</span>
        )}
        {c.category && <span> · {c.category}</span>}
      </div>

      <div className="meta muted">
        요금 {c.fee_summary} · {c.realtime_status}
      </div>

      {hasCoords && c.walking_minutes != null && (
        <div className="walk-block">
          <div>이 주차장은 목적지 자체 주차장이 아닙니다.</div>
          <div>
            주차 후 목적지까지 <strong>도보 약 {c.walking_minutes}분</strong>
            {c.walking_route_distance_m != null
              ? ` (${c.walking_route_distance_m}m, ${c.walking_route_source === "osrm" ? "실 도보 경로" : "직선거리 추정"})`
              : c.distance_m != null
              ? ` (${c.distance_m}m, 직선거리)`
              : ""}{" "}
            이동이 필요합니다.
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            실 경로는 OpenStreetMap 기반 추정치이며 카카오맵에서 한 번 더 확인할 수 있습니다.
          </div>
        </div>
      )}

      <div className="reasons" style={{ color: "#b85c00" }}>
        ⚠ {c.warning}
      </div>
      {c.usability_reasons.length > 0 && (
        <div className="reasons muted" style={{ fontSize: 11 }}>
          분류 근거: {c.usability_reasons.join(" · ")}
        </div>
      )}

      <div className="actions">
        {hasCoords && (
          <button className="btn primary" onClick={openFootRoute}>
            카카오맵 도보 길찾기
          </button>
        )}
        {c.url && (
          <button className="btn" onClick={openSource}>
            {isWeb ? "원문 보기" : "카카오맵에서 열기"}
          </button>
        )}
        <button className="btn" onClick={openKakaoMapSearch}>
          주변 주차장 검색
        </button>
      </div>
    </div>
  );
}
