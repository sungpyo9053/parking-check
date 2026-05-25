import { useEffect, useState } from "react";
import { api, NearbyPoi } from "../../lib/api";
import type { ParkingResult } from "../../utils/parkingResult";

type Props = {
  result: ParkingResult;
  destLat: number;
  destLng: number;
  topWalkMin: number | null;
};

/** 차량 vs 대중교통 직접 비교 — 모두의주차장이 못 하는 의사결정 정보. */
export default function VehicleVsTransitCard({
  result,
  destLat,
  destLng,
  topWalkMin,
}: Props) {
  const [subway, setSubway] = useState<NearbyPoi | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .nearbyPois({ lat: destLat, lng: destLng, category: "subway", radius_m: 1500 })
      .then((r) => {
        if (cancelled) return;
        setSubway(r.items[0] ?? null);
      })
      .catch(() => !cancelled && setSubway(null));
    return () => {
      cancelled = true;
    };
  }, [destLat, destLng]);

  const visit = result.visitRecommendation;
  const carVerdict =
    visit === "recommended"
      ? { label: "차량 추천", tone: "good" as const }
      : visit === "conditional"
        ? { label: "조건부", tone: "caution" as const }
        : visit === "not_recommended"
          ? { label: "비추천", tone: "tough" as const }
          : { label: "정보 부족", tone: "unknown" as const };
  const transitOk = !!subway;
  const transitVerdict = transitOk
    ? { label: "대중교통 가능", tone: "good" as const }
    : { label: "정류장 멀음", tone: "caution" as const };

  return (
    <section className="rcard vs-card">
      <header className="rcard-head">
        <span className="rcard-tag">의사 결정</span>
        <h3 className="rcard-title">차로 갈까, 대중교통으로 갈까?</h3>
      </header>
      <div className="vs-grid">
        <div className={`vs-col vs-tone-${carVerdict.tone}`}>
          <div className="vs-col-head">차량</div>
          <div className="vs-col-verdict">{carVerdict.label}</div>
          <div className="vs-col-detail">
            {topWalkMin != null ? (
              <>
                추천 주차장까지 <strong>도보 {topWalkMin}분</strong>
                <br />
                주차 난이도 {result.difficultyLabel}
              </>
            ) : (
              "주변 추천 주차장 정보 부족"
            )}
          </div>
        </div>
        <div className="vs-divider">vs</div>
        <div className={`vs-col vs-tone-${transitVerdict.tone}`}>
          <div className="vs-col-head">대중교통</div>
          <div className="vs-col-verdict">{transitVerdict.label}</div>
          <div className="vs-col-detail">
            {subway ? (
              <>
                가장 가까운 역: <strong>{subway.name}</strong>
                <br />
                목적지까지 {subway.distance_m ?? "?"}m
              </>
            ) : (
              "1.5km 이내 지하철역 없음 — 버스 확인 필요"
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
