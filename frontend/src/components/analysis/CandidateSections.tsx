import type { Candidate, ExternalCandidate } from "../../lib/api";
import ParkingCard from "../ParkingCard";
import ExternalCard from "../ExternalCard";

type Props = {
  dbCandidates: Candidate[];
  usableExt: ExternalCandidate[];
  cautionExt: ExternalCandidate[];
  excluded: ExternalCandidate[];
  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  onSelectDb: (c: Candidate) => void;
  onOpenMapDb: (c: Candidate) => void;
};

export default function CandidateSections({
  dbCandidates,
  usableExt,
  cautionExt,
  excluded,
  destinationLat,
  destinationLng,
  destinationName,
  onSelectDb,
  onOpenMapDb,
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
              <li key={c.id}>
                <ParkingCard
                  c={c}
                  onSelect={onSelectDb}
                  onOpenMap={onOpenMapDb}
                  destinationLat={destinationLat}
                  destinationLng={destinationLng}
                  destinationName={destinationName}
                />
              </li>
            ))}
            {usableExt.map((e, i) => (
              <li key={`u-${i}`}>
                <ExternalCard
                  c={e}
                  destinationLat={destinationLat}
                  destinationLng={destinationLng}
                  destinationName={destinationName}
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
                <ExternalCard
                  c={e}
                  destinationLat={destinationLat}
                  destinationLng={destinationLng}
                  destinationName={destinationName}
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
                <ExternalCard
                  c={e}
                  destinationLat={destinationLat}
                  destinationLng={destinationLng}
                  destinationName={destinationName}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
