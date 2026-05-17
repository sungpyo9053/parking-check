import type { UsabilityStatus } from "../../types/parking";
import {
  distanceSourceLabel,
  usabilityTagClass,
  usabilityUserLabel,
} from "../../utils/parkingPresentation";
import { openKakaoFootRoute } from "../../lib/maps";

/** ParkingCard(공식 DB) + ExternalCard(지도/웹 검색) 를 흡수한 통합 카드.
 *  호출 측에서 source/원본 데이터를 보고 props 를 normalize 해서 넘긴다. */
export type ParkingCandidateCardProps = {
  name: string;
  usability: UsabilityStatus;
  /** 출처 라벨 — "공식 주차장 데이터" / "지도 검색 후보" / "웹 검색 후보" 등 */
  sourceLabel: string;
  /** "공영주차장" / "민영/유료주차장" / "지도 검색 기반" 등 */
  kindLabel: string;
  walkingMinutes: number | null;
  distanceM: number | null;
  routeSource: "osrm" | "haversine" | null;
  address?: string | null;
  feeLabel?: string | null;
  realtimeLabel?: string | null;
  lat: number | null;
  lng: number | null;
  externalUrl?: string | null;
  /** 추천 제외 후보의 이유 한 줄. usability=private_restricted 일 때만 사용. */
  excludedReason?: string | null;

  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  /** DB 후보일 때만 — "이 주차장으로 가기" 버튼 (방문 로그 시작). */
  onSelectVisit?: () => void;
};

export default function ParkingCandidateCard(props: ParkingCandidateCardProps) {
  const {
    name,
    usability,
    sourceLabel,
    kindLabel,
    walkingMinutes,
    distanceM,
    routeSource,
    address,
    feeLabel,
    realtimeLabel,
    lat,
    lng,
    externalUrl,
    excludedReason,
    destinationLat,
    destinationLng,
    destinationName,
    onSelectVisit,
  } = props;

  const isExcluded = usability === "private_restricted";
  const hasCoords = lat != null && lng != null;

  function onFootRoute() {
    if (!hasCoords) return;
    openKakaoFootRoute(
      { lat: lat!, lng: lng!, name },
      { lat: destinationLat, lng: destinationLng, name: destinationName },
    );
  }

  return (
    <div className={`pcard pcard-${usability}`}>
      <div className="head">
        <span className={usabilityTagClass(usability)}>
          {usabilityUserLabel(usability)}
        </span>
        <span
          className="tag"
          style={{ background: "#f3f4f6", color: "#6b7280" }}
        >
          {sourceLabel}
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
        {name}
      </div>

      {!isExcluded && hasCoords && walkingMinutes != null && (
        <div className="meta meta-walk">
          <strong>목적지까지 도보 약 {walkingMinutes}분</strong>
          {distanceM != null && (
            <span style={{ marginLeft: 6 }}>
              · {distanceM}m ({distanceSourceLabel(routeSource)})
            </span>
          )}
        </div>
      )}
      {!isExcluded && !hasCoords && (
        <div className="meta meta-walk" style={{ color: "#9a3412" }}>
          위치 정보가 없는 참고 후보입니다. 방문 전 매장 확인이 필요합니다.
        </div>
      )}

      {!isExcluded && (
        <div className="meta">
          <span>{kindLabel}</span>
          {address && <span>· {address}</span>}
        </div>
      )}

      {!isExcluded && hasCoords && (feeLabel || realtimeLabel) && (
        <div className="meta muted">
          {feeLabel || "요금 확인 필요"}
          {realtimeLabel ? ` · ${realtimeLabel}` : ""}
        </div>
      )}

      {excludedReason && (
        <div
          className="meta"
          style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}
        >
          {excludedReason}
        </div>
      )}

      {!isExcluded && (
        <div className="actions">
          {hasCoords && (
            <button className="btn primary" onClick={onFootRoute}>
              도보 길찾기
            </button>
          )}
          {externalUrl && (
            <button
              className="btn"
              onClick={() =>
                window.open(externalUrl!, "_blank", "noopener,noreferrer")
              }
            >
              카카오맵에서 열기
            </button>
          )}
          {onSelectVisit && (
            <button className="btn" onClick={onSelectVisit}>
              이 주차장으로 가기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
