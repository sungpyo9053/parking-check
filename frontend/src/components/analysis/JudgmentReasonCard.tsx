import type { ParkingResult } from "../../utils/parkingResult";

type Props = {
  result: ParkingResult;
};

export default function JudgmentReasonCard({ result }: Props) {
  return (
    <section className="rcard">
      <header className="rcard-head">
        <span className="rcard-tag">판단 근거</span>
        <h3 className="rcard-title">왜 이렇게 판단했나요?</h3>
      </header>
      <ul className="rcard-list">
        {result.reasons.map((r) => (
          <li key={r.key} className="rcard-row">
            <span className="rcard-row-key">{r.key}</span>
            <span className={`rcard-row-val rcard-val-${r.tone}`}>{r.label}</span>
          </li>
        ))}
      </ul>

      {/* 점수 항목별 brief breakdown — 어디서 점수가 깎였는지 사용자 투명성 확보 */}
      <details className="rcard-score-details">
        <summary>점수 항목별 보기</summary>
        <ul className="rcard-score-list">
          {result.scoreBreakdown.map((p) => (
            <li key={p.key}>
              <span className="rcard-score-key">{p.label}</span>
              <span className="rcard-score-val">
                {p.value}/{p.max}
              </span>
              <div className="rcard-score-bar" aria-hidden>
                <div
                  className="rcard-score-bar-fill"
                  style={{ width: `${(p.value / p.max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
