import type { Candidate, ExternalCandidate } from "../../types/parking";
import ParkingCandidateCard, {
  ParkingCandidateCardProps,
} from "./ParkingCandidateCard";
import {
  externalSourceLabel,
  kindLabel as toKindLabel,
} from "../../utils/parkingPresentation";

type Props = {
  dbCandidates: Candidate[];
  usableExt: ExternalCandidate[];
  cautionExt: ExternalCandidate[];
  excluded: ExternalCandidate[];
  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  onSelectDb: (c: Candidate) => void;
};

function normalizeDb(
  c: Candidate,
  destLat: number,
  destLng: number,
  destName: string,
  onSelectDb: (c: Candidate) => void,
): ParkingCandidateCardProps {
  return {
    name: c.name,
    usability: "usable",
    sourceLabel: "공식 주차장 데이터",
    kindLabel: c.type || "주차장",
    walkingMinutes: c.walk_minutes ?? null,
    distanceM: c.walking_route_distance_m ?? c.distance_m,
    routeSource: c.walking_route_source ?? null,
    address: null,
    feeLabel: c.fee_summary || "요금 확인 필요",
    realtimeLabel: c.realtime
      ? `잔여 ${c.realtime.available_count ?? "?"} / ${c.realtime.total_capacity ?? "?"}면`
      : "실시간 정보 없음",
    lat: c.lat,
    lng: c.lng,
    externalUrl: null,
    excludedReason: null,
    destinationLat: destLat,
    destinationLng: destLng,
    destinationName: destName,
    onSelectVisit: () => onSelectDb(c),
  };
}

function normalizeExternal(
  e: ExternalCandidate,
  destLat: number,
  destLng: number,
  destName: string,
): ParkingCandidateCardProps {
  const isExcluded = e.usability === "private_restricted";
  return {
    name: e.name,
    usability: e.usability,
    sourceLabel: externalSourceLabel(e.source),
    kindLabel: toKindLabel(e.category),
    walkingMinutes: e.walking_minutes ?? null,
    distanceM: e.walking_route_distance_m ?? e.distance_m ?? null,
    routeSource: e.walking_route_source ?? null,
    address: e.road_address || e.address || null,
    feeLabel:
      e.fee_summary === "확인 필요"
        ? "요금 확인 필요"
        : `요금 ${e.fee_summary}`,
    realtimeLabel: e.realtime_status,
    lat: e.lat ?? null,
    lng: e.lng ?? null,
    externalUrl: e.url ?? null,
    excludedReason: isExcluded
      ? "타 매장/기관 전용 주차장으로 보여 추천하지 않습니다."
      : null,
    destinationLat: destLat,
    destinationLng: destLng,
    destinationName: destName,
  };
}

export default function ParkingCandidateSection({
  dbCandidates,
  usableExt,
  cautionExt,
  excluded,
  destinationLat,
  destinationLng,
  destinationName,
  onSelectDb,
}: Props) {
  const recommendCount = dbCandidates.length + usableExt.length;
  const cautionCount = cautionExt.length;
  const excludedCount = excluded.length;

  if (recommendCount + cautionCount + excludedCount === 0) {
    return (
      <div className="empty-card">
        <div className="empty-title">주변 주차장 후보를 찾지 못했습니다</div>
        <div className="empty-detail">
          이 반경 안에서 추천 가능한 주차장이 확인되지 않았습니다. 반경을
          늘리거나 현장 확인이 필요합니다.
        </div>
      </div>
    );
  }

  return (
    <>
      {recommendCount > 0 && (
        <>
          <div className="section-pill section-pill-good">
            추천 가능 {recommendCount}곳
          </div>
          <ul className="list">
            {dbCandidates.map((c) => (
              <li key={`db-${c.id}`}>
                <ParkingCandidateCard
                  {...normalizeDb(
                    c,
                    destinationLat,
                    destinationLng,
                    destinationName,
                    onSelectDb,
                  )}
                />
              </li>
            ))}
            {usableExt.map((e, i) => (
              <li key={`u-${i}`}>
                <ParkingCandidateCard
                  {...normalizeExternal(
                    e,
                    destinationLat,
                    destinationLng,
                    destinationName,
                  )}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {cautionCount > 0 && (
        <>
          <div className="section-pill section-pill-caution">
            확인 필요 {cautionCount}곳
          </div>
          <div className="section-help">
            운영/요금/일반 개방 여부가 명확하지 않은 후보입니다. 방문 전 확인 후
            이용하세요.
          </div>
          <ul className="list">
            {cautionExt.map((e, i) => (
              <li key={`c-${i}`}>
                <ParkingCandidateCard
                  {...normalizeExternal(
                    e,
                    destinationLat,
                    destinationLng,
                    destinationName,
                  )}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {excludedCount > 0 && (
        <details className="excluded-block">
          <summary>
            추천 제외 {excludedCount}곳 보기 (타 매장/기관 전용으로 보이는 후보)
          </summary>
          <div className="section-help">
            목적지 방문자가 임의로 이용하기 어려울 수 있어 추천에서
            제외했습니다.
          </div>
          <ul className="list" style={{ marginTop: 8 }}>
            {excluded.map((e, i) => (
              <li key={`x-${i}`}>
                <ParkingCandidateCard
                  {...normalizeExternal(
                    e,
                    destinationLat,
                    destinationLng,
                    destinationName,
                  )}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
