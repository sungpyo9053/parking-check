import type { ExternalCandidate } from "../lib/api";
import { kakaoMapSearchUrl, openKakaoFootRoute } from "../lib/maps";

type Props = {
  c: ExternalCandidate;
  destinationLat: number;
  destinationLng: number;
  destinationName?: string;
};

function sourceLabel(source: ExternalCandidate["source"]): string {
  if (source === "kakao_fallback") return "지도 검색 후보";
  if (source === "web_search") return "웹 검색 후보";
  return "참고 후보";
}

function usabilityTagClass(u: ExternalCandidate["usability"]): string {
  if (u === "usable") return "tag tag-verdict-good";
  if (u === "caution") return "tag tag-verdict-caution";
  return "tag tag-verdict-bad";
}

function usabilityUserLabel(u: ExternalCandidate["usability"]): string {
  if (u === "usable") return "추천 가능";
  if (u === "caution") return "확인 필요";
  return "추천 제외";
}

function userKindLabel(
  category: string | null | undefined,
  source: ExternalCandidate["source"],
): string {
  const cat = category || "";
  if (cat.includes("공영")) return "공영주차장";
  if (cat.includes("노상")) return "공영(노상)주차장";
  if (cat.includes("주차장")) return "민영/유료주차장";
  if (source === "web_search") return "웹 검색 기반";
  return "주차장";
}

export default function ExternalCard({
  c,
  destinationLat,
  destinationLng,
  destinationName,
}: Props) {
  const isWeb = c.source === "web_search";
  const hasCoords = c.lat != null && c.lng != null;

  function openKakaoMapSearch() {
    const url = kakaoMapSearchUrl("주차장", {
      lat: destinationLat,
      lng: destinationLng,
    });
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
      {
        lat: destinationLat,
        lng: destinationLng,
        name: destinationName || "목적지",
      },
    );
  }

  const isExcluded = c.usability === "private_restricted";
  const kindLabel = userKindLabel(c.category, c.source);
  const distM = c.walking_route_distance_m ?? c.distance_m;
  const distLabel =
    c.walking_route_source === "osrm" ? "실 도보 경로" : "직선거리 기준";

  // 추천 제외 카드는 '왜 제외'를 사용자 친화 문구로 한 줄 보여줌
  const excludedReasonLine = isExcluded
    ? "타 매장/기관 전용 주차장으로 보여 추천하지 않습니다."
    : null;

  return (
    <div className={`pcard pcard-${c.usability}`}>
      <div className="head">
        <span className={usabilityTagClass(c.usability)}>
          {usabilityUserLabel(c.usability)}
        </span>
        <span
          className="tag"
          style={{ background: "#f3f4f6", color: "#6b7280" }}
        >
          {sourceLabel(c.source)}
        </span>
      </div>
      <div
        className="name"
        style={{
          fontWeight: 700,
          marginTop: 4,
          ...(isExcluded
            ? { textDecoration: "line-through", color: "#9ca3af" }
            : null),
        }}
      >
        {c.name}
      </div>

      {hasCoords && c.walking_minutes != null && !isExcluded && (
        <div className="meta meta-walk">
          <strong>목적지까지 도보 약 {c.walking_minutes}분</strong>
          {distM != null && (
            <span style={{ marginLeft: 6 }}>
              · {distM}m ({distLabel})
            </span>
          )}
        </div>
      )}
      {!hasCoords && !isExcluded && (
        <div className="meta meta-walk" style={{ color: "#9a3412" }}>
          위치 정보가 없는 참고 후보입니다. 방문 전 매장 확인이 필요합니다.
        </div>
      )}
      {!isExcluded && (
        <div className="meta">
          <span>{kindLabel}</span>
          {(c.address || c.road_address) && (
            <span>· {c.road_address || c.address}</span>
          )}
        </div>
      )}
      {!isExcluded && hasCoords && (
        <div className="meta muted">
          {c.fee_summary === "확인 필요"
            ? "요금 확인 필요"
            : `요금 ${c.fee_summary}`}{" "}
          ·{" "}
          {c.realtime_status === "실시간 정보 없음"
            ? "실시간 정보 없음"
            : c.realtime_status}
        </div>
      )}
      {excludedReasonLine && (
        <div
          className="meta"
          style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}
        >
          {excludedReasonLine}
        </div>
      )}

      {!isExcluded && (
        <div className="actions">
          {hasCoords && (
            <button className="btn primary" onClick={openFootRoute}>
              도보 길찾기
            </button>
          )}
          {c.url && (
            <button className="btn" onClick={openSource}>
              {isWeb ? "원문 보기" : "카카오맵에서 열기"}
            </button>
          )}
          {!c.url && !hasCoords && (
            <button className="btn" onClick={openKakaoMapSearch}>
              주변 주차장 검색
            </button>
          )}
        </div>
      )}
    </div>
  );
}
