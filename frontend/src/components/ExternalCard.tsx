import type { ExternalCandidate } from "../lib/api";

type Props = {
  c: ExternalCandidate;
  destinationLat: number;
  destinationLng: number;
};

function badgeClass(source: ExternalCandidate["source"]): string {
  if (source === "kakao_fallback") return "tag tag-kakao";
  if (source === "web_search") return "tag tag-web";
  return "tag";
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

  return (
    <div className="pcard pcard-external">
      <div className="head">
        <span className="name">{c.name}</span>
        <span className={badgeClass(c.source)}>{c.source_label}</span>
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
