import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = { verdict: VerdictInfo };

const VERDICT_ICON: Record<VerdictInfo["kind"], string> = {
  good: "✓",
  caution: "!",
  bad: "×",
  unknown: "?",
};

/** 바텀시트 peek 영역에 항상 노출되는 "차 가져가도 될까?" 판단 카드. */
export default function VerdictCard({ verdict }: Props) {
  return (
    <div className="sheet-peek-area">
      <div className={`verdict-pill verdict-pill-${verdict.kind}`}>
        <div className={`verdict-icon verdict-icon-${verdict.kind}`}>
          {VERDICT_ICON[verdict.kind]}
        </div>
        <div className="verdict-pill-body">
          <span className="verdict-pill-q">차 가져가도 될까?</span>
          <span className="verdict-pill-title">{verdict.title}</span>
        </div>
      </div>
      <div className="verdict-pill-detail">{verdict.detail}</div>
      {verdict.hint && <div className="verdict-pill-hint">{verdict.hint}</div>}
    </div>
  );
}
