import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = {
  stress: VerdictInfo["stress"];
};

const STRESS_LABEL: Record<VerdictInfo["stress"]["level"], string> = {
  low: "주차 스트레스 낮음",
  medium: "주차 스트레스 보통",
  high: "주차 스트레스 높음",
};

const STRESS_HELPER: Record<VerdictInfo["stress"]["level"], string> = {
  low: "초행길이어도 무난해요",
  medium: "방문 전 확인이 좋아요",
  high: "도착해서 당황할 가능성이 있어요",
};

/** 흐름 2: 주차 스트레스 지수.
 *  Verdict 카드 바로 아래 별도 카드로 노출.
 *  점수는 buildVerdict() 가 산정해서 verdict.stress 로 전달.
 *  - low/medium/high 3 단계
 *  - 선형 게이지 (도넛 X)
 */
export default function ParkingStressMeter({ stress }: Props) {
  const { score, level, cue } = stress;
  const pct = Math.max(4, Math.min(100, score));
  return (
    <section className={`stress-card stress-card-${level}`}>
      <div className="stress-card-head">
        <span className={`stress-label stress-label-${level}`}>
          {STRESS_LABEL[level]}
        </span>
        <span className="stress-score">
          <strong>{score}</strong>
          <span className="stress-score-unit">점 / 100</span>
        </span>
      </div>
      <div className="stress-bar">
        <div
          className={`stress-fill stress-fill-${level}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`stress-helper stress-helper-${level}`}>
        {STRESS_HELPER[level]}
        {cue && cue !== STRESS_HELPER[level] && (
          <span className="stress-helper-cue"> · {cue}</span>
        )}
      </div>
    </section>
  );
}
