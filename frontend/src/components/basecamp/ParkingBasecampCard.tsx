import type { BasecampPark } from "../../utils/basecampPresentation";
import { basecampCaption } from "../../utils/basecampPresentation";

type Props = {
  park: BasecampPark;
  walkableCount: number;
};

const STRESS_LABEL: Record<BasecampPark["stress"], string> = {
  low: "주차 스트레스 낮음",
  medium: "주차 스트레스 보통",
  high: "주차 스트레스 높음",
};

/** "오늘은 차 여기 대세요" — 베이스캠프 추천 주차장 카드. */
export default function ParkingBasecampCard({ park, walkableCount }: Props) {
  const caption = basecampCaption(park, walkableCount);
  return (
    <section className={`basecamp-card basecamp-card-${park.stress}`}>
      <div className="basecamp-badge">🅿️ 오늘의 베이스캠프</div>
      <div className="basecamp-cap">{caption}</div>
      <div className="basecamp-name">{park.name}</div>
      <div className="basecamp-meta">
        <span className="basecamp-meta-chip">
          {STRESS_LABEL[park.stress]}
        </span>
        <span className="basecamp-meta-walkers">
          도보권 갈만한 곳 <strong>{walkableCount}</strong>개
        </span>
      </div>
      {park.url && (
        <button
          type="button"
          className="btn primary basecamp-cta"
          onClick={() => window.open(park.url!, "_blank", "noopener,noreferrer")}
        >
          카카오맵에서 보기
        </button>
      )}
    </section>
  );
}
