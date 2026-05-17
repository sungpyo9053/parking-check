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
 *  핸들 탭 시 peek → half → expanded → peek 으로 순환. */
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

  return (
    <section className={`sheet sheet-${state}`} aria-label="주차 판단 패널">
      <button
        type="button"
        className="sheet-handle-btn"
        onClick={cycle}
        aria-label="패널 펼치기/접기"
      >
        <div className="sheet-handle-bar" />
      </button>
      {peek}
      <div className="sheet-body" ref={bodyRef}>
        {body}
      </div>
    </section>
  );
}
