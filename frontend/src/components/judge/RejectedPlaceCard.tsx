import type { JudgeEntry } from "../../utils/judgePresentation";
import { rejectedCaption } from "../../utils/judgePresentation";

type Props = {
  entry: JudgeEntry;
};

/** 탈락 장소 카드 — 이유와 함께. */
export default function RejectedPlaceCard({ entry }: Props) {
  return (
    <article className="rejected-card">
      <div className="rejected-head">
        <span className="rejected-name">{entry.name}</span>
        <span className="rejected-score">{entry.safety}점</span>
      </div>
      <div className="rejected-cap">{rejectedCaption(entry)}</div>
      <ul className="rejected-reasons">
        {entry.reasons.slice(0, 3).map((r, i) => (
          <li key={i}>· {r}</li>
        ))}
      </ul>
    </article>
  );
}
