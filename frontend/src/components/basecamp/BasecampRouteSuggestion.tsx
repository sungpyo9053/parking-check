import type { HotPlaceItem } from "../../lib/api";
import {
  WalkableCategory,
  buildSuggestedRoute,
} from "../../utils/basecampPresentation";

type Props = {
  byCategory: Record<WalkableCategory, HotPlaceItem[]>;
};

/** "주차 → 카페 → 맛집 → 산책" 추천 동선. */
export default function BasecampRouteSuggestion({ byCategory }: Props) {
  const stops = buildSuggestedRoute(byCategory);
  if (stops.length <= 1) return null;
  return (
    <section className="route-card">
      <div className="route-head">
        <span className="route-title">추천 동선</span>
        <span className="route-sub">간단 코스 제안</span>
      </div>
      <ol className="route-list">
        {stops.map((s, i) => (
          <li key={i} className="route-stop">
            <div className="route-stop-marker">
              <span className="route-stop-emoji">{s.emoji}</span>
              {i < stops.length - 1 && <div className="route-stop-line" />}
            </div>
            <div className="route-stop-body">
              <div className="route-stop-label">{s.label}</div>
              <div className="route-stop-name">{s.name}</div>
              {s.walkingMinutes != null && (
                <div className="route-stop-meta">
                  도보 약 {s.walkingMinutes}분
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
