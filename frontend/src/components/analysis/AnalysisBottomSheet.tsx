import { ReactNode, useRef } from "react";

export type SheetState = "peek" | "half" | "expanded";

type Props = {
  state: SheetState;
  onChangeState: (next: SheetState) => void;
  /** 항상 보이는 peek 영역 (verdict). */
  peek: ReactNode;
  /** half/expanded 일 때만 의미있는 스크롤 본문. */
  body: ReactNode;
};

/** 모바일 지도 앱 패턴 바텀시트.
 *  - 핸들 / 펼친 표시 영역 / verdict (peek) 어디든 탭하면 사이클.
 *  - peek → half → expanded → peek
 */
export default function AnalysisBottomSheet({
  state,
  onChangeState,
  peek,
  body,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  function cycle() {
    const next: SheetState =
      state === "peek" ? "half" : state === "half" ? "expanded" : "peek";
    onChangeState(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }

  const cycleHint =
    state === "expanded" ? "지도 더 보기 ↓" : "결과 더 보기 ↑";

  return (
    <section className={`sheet sheet-${state}`} aria-label="주차 판단 패널">
      <button
        type="button"
        className="sheet-handle-btn"
        onClick={cycle}
        aria-label="패널 펼치기/접기"
      >
        <div className="sheet-handle-bar" />
        <div className="sheet-handle-hint">{cycleHint}</div>
      </button>
      {/* peek 영역 자체도 탭으로 사이클 — 작은 핸들 정밀 조준 부담 줄임 */}
      <div
        role="button"
        tabIndex={0}
        onClick={cycle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            cycle();
          }
        }}
        className="sheet-peek-tap"
      >
        {peek}
      </div>
      <div className="sheet-body" ref={bodyRef}>
        {body}
      </div>
    </section>
  );
}
