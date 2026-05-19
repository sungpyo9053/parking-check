import { useState } from "react";
import type { SelfParkingFeedbackStats } from "../../types/parking";

type VisitAnswer = "yes" | "nearby" | "no" | "unknown";
type WalkBucket = "1-3" | "4-7" | "8+";

type Props = {
  placeId: number | null | undefined;
  feedbackBusy: boolean;
  feedbackStats: SelfParkingFeedbackStats | null;
  feedbackJustSent: "yes" | "no" | "unknown" | null;
  /** 내부적으로 yes/no/unknown 만 백엔드로 보냄.
   *  "nearby" 는 no + note 로 보냄 (DB 스키마 변경 회피).
   */
  onSubmit: (params: {
    answer: "yes" | "no" | "unknown";
    note: string | null;
  }) => void;
};

const ANSWER_BTN: { key: VisitAnswer; label: string }[] = [
  { key: "yes", label: "✓ 가능했음" },
  { key: "nearby", label: "🚗 근처 주차장 이용" },
  { key: "no", label: "✗ 불가능했음" },
  { key: "unknown", label: "? 모르겠음" },
];

const WALK_BTN: { key: WalkBucket; label: string }[] = [
  { key: "1-3", label: "1~3분" },
  { key: "4-7", label: "4~7분" },
  { key: "8+", label: "8분 이상" },
];

/** 흐름 6: 방문 후 3초 제보 카드.
 *  - 결과 페이지 하단에 가볍게 배치
 *  - 4개 버튼(가능/근처/불가/모름) + 선택적 도보 시간
 *  - 백엔드 호환을 위해 nearby 는 no + note 로 전송
 */
export default function VisitReportCard({
  placeId,
  feedbackBusy,
  feedbackStats,
  feedbackJustSent,
  onSubmit,
}: Props) {
  const [selected, setSelected] = useState<VisitAnswer | null>(null);
  const [walk, setWalk] = useState<WalkBucket | null>(null);

  if (!placeId) {
    // place_id 없으면 그래도 가벼운 카피만 노출 (집계 불가)
    return (
      <div className="visit-report visit-report-disabled">
        <div className="visit-report-q">방문 결과 제보는 추후 지원돼요.</div>
      </div>
    );
  }

  function send(ans: VisitAnswer) {
    setSelected(ans);
    const noteParts: string[] = [];
    if (ans === "nearby") noteParts.push("planB:nearby");
    if (walk) noteParts.push(`walk:${walk}`);
    const note = noteParts.length ? noteParts.join("|") : null;
    const backendAnswer: "yes" | "no" | "unknown" =
      ans === "nearby" ? "no" : ans;
    onSubmit({ answer: backendAnswer, note });
  }

  return (
    <div className="visit-report">
      <div className="visit-report-q">
        실제로 주차 가능했나요?{" "}
        <span className="visit-report-q-sub">3초만 알려주세요</span>
      </div>

      <div className="visit-report-buttons">
        {ANSWER_BTN.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`btn visit-report-btn${selected === b.key ? " visit-report-btn-on" : ""}`}
            disabled={feedbackBusy}
            onClick={() => send(b.key)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="visit-report-walk">
        <div className="visit-report-walk-q">실 도보 시간 (선택)</div>
        <div className="visit-report-walk-buttons">
          {WALK_BTN.map((w) => (
            <button
              key={w.key}
              type="button"
              className={`btn-mini${walk === w.key ? " btn-mini-on" : ""}`}
              onClick={() => setWalk((cur) => (cur === w.key ? null : w.key))}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {(feedbackStats?.total ?? 0) > 0 && (
        <div className="visit-report-stats">
          누적 {feedbackStats?.total}: ✓ {feedbackStats?.yes_count} · ✗{" "}
          {feedbackStats?.no_count} · ? {feedbackStats?.unknown_count}
          {feedbackJustSent && (
            <span style={{ color: "#16a34a" }}> · 응답 저장됨</span>
          )}
        </div>
      )}

      <div className="visit-report-foot">
        이 데이터는 다음 사용자에게 더 정확한 결과를 보여주는 데 쓰입니다.
      </div>
    </div>
  );
}
