import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = { verdict: VerdictInfo };

const VERDICT_ICON: Record<VerdictInfo["kind"], string> = {
  good: "✓",
  caution: "!",
  bad: "×",
  unknown: "?",
};

/** 흐름 1: 큰 컬러 Verdict 패널.
 *  - 결과 페이지 최상단 (바텀시트 peek 영역).
 *  - 내부 status code 노출 X. 사용자 문구 + 한 줄 이유.
 *  - 주차 스트레스 게이지는 ParkingStressMeter 로 분리.
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
        </div>
      </div>
      {verdict.hint && (
        <div className="verdict-panel-hint">{verdict.hint}</div>
      )}
    </div>
  );
}
