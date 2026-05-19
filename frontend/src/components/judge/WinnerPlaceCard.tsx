import type { JudgeEntry } from "../../utils/judgePresentation";
import { winnerCaption } from "../../utils/judgePresentation";

type Props = {
  top: JudgeEntry;
};

/** 우승 장소 카드 — 큰 트로피 + 한 줄 카피 + safety. */
export default function WinnerPlaceCard({ top }: Props) {
  return (
    <section className="winner-card">
      <div className="winner-trophy">🏆</div>
      <div className="winner-caption">{winnerCaption(top)}</div>
      <div className="winner-name">{top.name}</div>
      <div className="winner-meta">
        차량 방문 안전도{" "}
        <strong className="winner-score">{top.safety}</strong>점
      </div>
      <ul className="winner-reasons">
        {top.reasons.slice(0, 3).map((r, i) => (
          <li key={i}>· {r}</li>
        ))}
      </ul>
    </section>
  );
}
