import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = { verdict: VerdictInfo };

const VERDICT_ICON: Record<VerdictInfo["kind"], string> = {
  good: "✓",
  caution: "!",
  bad: "×",
  unknown: "?",
};

const STRESS_LABEL: Record<VerdictInfo["stress"]["level"], string> = {
  low: "주차 스트레스 낮음",
  medium: "주차 스트레스 보통",
  high: "주차 스트레스 높음",
};

/** 바텀시트 peek 영역의 큰 컬러 판단 패널 (Toss-ish).
 *  결론 + 주차 스트레스 지수 게이지가 메인.
 */
export default function VerdictCard({ verdict }: Props) {
  return (
    <div className="sheet-peek-area">
      <div className={`verdict-panel verdict-panel-${verdict.kind}`}>
        <div className={`verdict-icon verdict-icon-${verdict.kind}`}>
          {VERDICT_ICON[verdict.kind]}
        </div>
        <div className="verdict-panel-body">
          <div className="verdict-panel-q">차 가져가도 될까?</div>
          <div className="verdict-panel-title">{verdict.title}</div>
          <div className="verdict-panel-detail">{verdict.detail}</div>
          <StressGauge stress={verdict.stress} />
        </div>
      </div>
      {verdict.hint && (
        <div className="verdict-panel-hint">{verdict.hint}</div>
      )}
    </div>
  );
}

function StressGauge({ stress }: { stress: VerdictInfo["stress"] }) {
  const { score, level, cue } = stress;
  return (
    <div className="stress-gauge">
      <div className="stress-head">
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
          style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
        />
      </div>
      {cue && <div className={`stress-cue stress-cue-${level}`}>→ {cue}</div>}
    </div>
  );
}
