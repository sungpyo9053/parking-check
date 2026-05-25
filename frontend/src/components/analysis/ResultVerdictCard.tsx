import type { ParkingResult } from "../../utils/parkingResult";

type Props = {
  result: ParkingResult;
  aiSummary?: string | null;
};

const DIFF_TONE: Record<ParkingResult["difficulty"], "good" | "caution" | "tough" | "unknown"> = {
  easy: "good",
  normal: "caution",
  hard: "tough",
  unknown: "unknown",
};
const VISIT_TONE: Record<ParkingResult["visitRecommendation"], "good" | "caution" | "tough" | "unknown"> = {
  recommended: "good",
  conditional: "caution",
  not_recommended: "tough",
  unknown: "unknown",
};

export default function ResultVerdictCard({ result, aiSummary }: Props) {
  const diffTone = DIFF_TONE[result.difficulty];
  const visitTone = VISIT_TONE[result.visitRecommendation];
  const dedicatedTone: "good" | "warn" | "unknown" =
    result.hasDedicatedParking === "yes" ? "good" :
    result.hasDedicatedParking === "no" ? "warn" : "unknown";
  const nearbyTone: "good" | "warn" | "unknown" =
    result.nearbyParkingAvailable ? "good" : "warn";

  return (
    <div className={`rv-card rv-tone-${diffTone}`}>
      <div className="rv-head">
        <div className="rv-place">{result.placeName}</div>
        <span className={`rv-difficulty rv-diff-${diffTone}`}>
          주차 난이도 · {result.difficultyLabel}
        </span>
      </div>

      {/* 차량 방문 판단 배지 + 점수 게이지 */}
      <div className="rv-decision">
        <div className="rv-decision-left">
          <span className={`rv-visit-badge rv-vd-${visitTone}`}>
            {result.visitRecommendationLabel}
          </span>
          <div className="rv-confidence">정보 신뢰도 · {result.confidenceLabel}</div>
        </div>
        <div className="rv-score-wrap" title="100점 만점 참고 지표">
          <div className="rv-score-meter" aria-hidden>
            <div
              className={`rv-score-fill rv-fill-${diffTone}`}
              style={{ width: `${Math.max(2, Math.min(100, result.score))}%` }}
            />
          </div>
          <div className="rv-score-caption">
            <span className="rv-score-small">{result.score}/100</span>
            <span className="rv-score-label">참고 지표</span>
          </div>
        </div>
      </div>

      {/* 2-col grid: 전용 / 근처 */}
      <div className="rv-grid">
        <div className="rv-grid-item">
          <span className="rv-grid-key">전용 주차장</span>
          <span className={`rv-grid-val rv-val-${dedicatedTone}`}>
            {result.hasDedicatedParkingLabel}
          </span>
        </div>
        <div className="rv-grid-item">
          <span className="rv-grid-key">근처 대안 주차장</span>
          <span className={`rv-grid-val rv-val-${nearbyTone}`}>
            {result.nearbyParkingAvailable
              ? `있음 (${result.nearbyParkingCount}곳)`
              : "확인 필요"}
          </span>
        </div>
      </div>

      {/* 한 줄 결론 — Groq 자연어 우선, 없으면 rule-based. AI 라벨 노출 X (프로 톤). */}
      <div className="rv-oneline">{aiSummary || result.summary}</div>

      <div className="rv-score-foot">
        * 100점 만점 지표는 방문 전 참고용이며, 실시간 주차 가능 대수가 아닙니다.
      </div>
    </div>
  );
}
