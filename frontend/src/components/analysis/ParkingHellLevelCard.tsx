import type { VerdictInfo } from "../../utils/parkingPresentation";
import { buildHellLevel } from "../../utils/funCardPresentation";

type Props = {
  verdict: VerdictInfo;
};

const LEVEL_EMOJI: Record<string, string> = {
  mild: "🍃",
  regular: "🌶",
  spicy: "🔥",
  hell: "💀",
};

/** 흐름 신박 2: 주차 헬 난이도.
 *  기존 stress meter 를 등급 카드로 대체.
 *  순한맛 / 보통맛 / 매운맛 / 지옥맛 — 게임 등급 톤. Toss-ish 카드.
 */
export default function ParkingHellLevelCard({ verdict }: Props) {
  const hell = buildHellLevel(verdict);
  return (
    <section className={`hell-card hell-card-${hell.level}`}>
      <div className="hell-card-row">
        <div className={`hell-badge hell-badge-${hell.level}`}>
          <span className="hell-emoji">{LEVEL_EMOJI[hell.level]}</span>
          <span className="hell-grade">{hell.label}</span>
        </div>
        <div
          className="hell-stars"
          aria-label={`주차 난이도 ${hell.stars} / 4`}
        >
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`hell-star${i <= hell.stars ? " hell-star-on" : ""}`}
            >
              ●
            </span>
          ))}
        </div>
      </div>
      <div className="hell-copy">{hell.copy}</div>
      <div className="hell-footer">
        주차 스트레스 지수 {verdict.stress.score}점 기준
      </div>
    </section>
  );
}
