import type { AnalyzeResponse } from "../../types/parking";
import type { VerdictInfo } from "../../utils/parkingPresentation";
import { buildScenario } from "../../utils/funCardPresentation";

type Props = {
  data: AnalyzeResponse;
  verdict: VerdictInfo;
};

/** 흐름 신박 3: 차 가져가면 예상 시나리오 타임라인.
 *  verdict + self_parking + top_recommendation 기반 3~5 단계.
 *  데이터 기반이지만 확정 표현은 회피.
 */
export default function DrivingScenarioTimeline({ data, verdict }: Props) {
  const steps = buildScenario(data, verdict);
  if (steps.length === 0) return null;
  return (
    <section className="scenario">
      <div className="scenario-head">
        <span className="scenario-title">차 가져가면 이런 흐름이에요</span>
        <span className="scenario-sub">예상 시나리오 (확정 X)</span>
      </div>
      <ol className="scenario-list">
        {steps.map((s, i) => (
          <li key={i} className={`scenario-step scenario-step-${s.tone}`}>
            <div className="scenario-step-marker">
              <span className="scenario-step-emoji">{s.emoji}</span>
              {i < steps.length - 1 && <div className="scenario-step-line" />}
            </div>
            <div className="scenario-step-body">
              <div className="scenario-step-title">{s.title}</div>
              {s.note && <div className="scenario-step-note">{s.note}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
