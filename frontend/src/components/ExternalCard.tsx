import type { ExternalCandidate } from "../lib/api";

type Props = {
  c: ExternalCandidate;
  destinationLat: number;
  destinationLng: number;
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

export default function ExternalCard({ c, destinationLat, destinationLng }: Props) {
  const isWeb = c.source === "web_search";

  function openKakaoMapSearch() {
    // 카카오맵에서 "주차장" 키워드 + 목적지 좌표 중심으로 열기
    const url = `https://map.kakao.com/?q=${encodeURIComponent("주차장")}&map_type=TYPE_MAP&MX=${destinationLng}&MY=${destinationLat}&map_attribute=ROADVIEW`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openSource() {
    if (!c.url) return;
    window.open(c.url, "_blank", "noopener,noreferrer");
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

      <div className="reasons" style={{ color: "#b85c00" }}>
        ⚠ {c.warning}
      </div>
      {c.usability_reasons.length > 0 && (
        <div className="reasons muted" style={{ fontSize: 11 }}>
          분류 근거: {c.usability_reasons.join(" · ")}
        </div>
      )}

      <div className="actions">
        {c.url && (
          <button className="btn" onClick={openSource}>
            {isWeb ? "원문 보기" : "카카오맵에서 열기"}
          </button>
        )}
        <button className="btn" onClick={openKakaoMapSearch}>
          카카오맵에서 주변 주차장 검색
        </button>
      </div>
    </div>
  );
}
