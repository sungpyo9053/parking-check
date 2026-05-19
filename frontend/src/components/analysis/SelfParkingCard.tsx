import type {
  AnalyzeResponse,
  SelfParkingFeedbackStats,
} from "../../types/parking";
import type { SelfParkingCopy } from "../../utils/parkingPresentation";

type Props = {
  data: AnalyzeResponse;
  copy: SelfParkingCopy;
  feedbackBusy: boolean;
  feedbackStats: SelfParkingFeedbackStats | null;
  feedbackJustSent: "yes" | "no" | "unknown" | null;
  onFeedback: (answer: "yes" | "no" | "unknown") => void;
};

/** 목적지 자체 주차 카드.
 *  - "도보 0분" 같은 표현은 의미가 없으므로 표시하지 않는다.
 *  - 가능/불가/확인 필요 톤은 utils/parkingPresentation.ts 의 selfParkingCopy 에서 통일.
 */
export default function SelfParkingCard({
  data,
  copy,
  feedbackBusy,
  feedbackStats,
  feedbackJustSent,
  onFeedback,
}: Props) {
  return (
    <div className={`self-card self-card-${copy.tagKind}`}>
      <div className="self-card-head">
        <span className="self-card-title">목적지 자체 주차</span>
        <span className={`tag tag-verdict-${copy.tagKind}`}>{copy.tag}</span>
      </div>
      <div className="self-card-line">{copy.line}</div>

      {data.self_parking.summary_natural && (
        <div className="self-card-quote">
          💬 {data.self_parking.summary_natural}
        </div>
      )}

      {!data.self_parking.summary_natural &&
        data.self_parking.evidence &&
        data.self_parking.evidence.length > 0 && (
          <div className="self-card-quote">
            💬 {data.self_parking.evidence[0].snippet}
            {data.self_parking.evidence[0].title && (
              <div className="self-card-quote-src">
                — {data.self_parking.evidence[0].title}
              </div>
            )}
          </div>
        )}

      {data.destination.place_id && (
        <div className="sp-feedback">
          <div className="sp-feedback-q">실제로 자체 주차 가능했나요?</div>
          <div className="sp-feedback-buttons">
            <button
              className="btn sp-yes"
              disabled={feedbackBusy}
              onClick={() => onFeedback("yes")}
            >
              ✓ 있었음
            </button>
            <button
              className="btn sp-no"
              disabled={feedbackBusy}
              onClick={() => onFeedback("no")}
            >
              ✗ 없었음
            </button>
            <button
              className="btn sp-unk"
              disabled={feedbackBusy}
              onClick={() => onFeedback("unknown")}
            >
              ? 모름
            </button>
          </div>
          {(feedbackStats?.total ?? 0) > 0 && (
            <div className="sp-feedback-stats">
              누적 응답 {feedbackStats?.total}: ✓ {feedbackStats?.yes_count} · ✗{" "}
              {feedbackStats?.no_count} · ? {feedbackStats?.unknown_count}
              {feedbackJustSent && (
                <span style={{ color: "#16a34a" }}> · 응답 저장됨</span>
              )}
            </div>
          )}
        </div>
      )}

      {data.self_parking.evidence && data.self_parking.evidence.length > 0 && (
        <details className="self-evidence">
          <summary>
            판단 근거 {data.self_parking.evidence.length}건 보기
          </summary>
          <ul className="evidence-list">
            {data.self_parking.evidence.map((e, i) => (
              <li key={`ev-${i}`} className="evidence-item">
                <div className="evidence-head">
                  <span className={`tag tag-${e.confidence}`}>
                    웹 후기 · {e.confidence}
                  </span>
                  {e.title && <span className="evidence-title">{e.title}</span>}
                </div>
                {e.snippet && (
                  <div className="evidence-snippet">{e.snippet}</div>
                )}
                {e.url && (
                  <a
                    className="evidence-link"
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    근거 링크 보기 →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
