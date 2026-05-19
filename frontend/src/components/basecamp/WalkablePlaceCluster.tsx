import type { HotPlaceItem } from "../../lib/api";
import {
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  WalkableCategory,
} from "../../utils/basecampPresentation";

type Props = {
  byCategory: Record<WalkableCategory, HotPlaceItem[]>;
  loading: boolean;
};

/** 도보권 카테고리별 (카페/맛집/가볼곳) 후보 cluster. */
export default function WalkablePlaceCluster({ byCategory, loading }: Props) {
  const cats: WalkableCategory[] = ["cafe", "food", "sights"];
  return (
    <section className="walkable">
      <h2 className="h2" style={{ marginBottom: 8 }}>
        도보권 갈만한 곳
      </h2>
      {loading && <div className="walkable-empty">⏳ 주변 후보 찾는 중…</div>}
      {!loading &&
        cats.map((c) => {
          const items = byCategory[c] || [];
          if (items.length === 0) return null;
          return (
            <div key={c} className="walkable-group">
              <div className="walkable-group-head">
                <span className="walkable-group-emoji">
                  {CATEGORY_EMOJI[c]}
                </span>
                <span className="walkable-group-title">
                  {CATEGORY_LABEL[c]} {items.length}곳
                </span>
              </div>
              <ul className="walkable-list">
                {items.slice(0, 4).map((it, i) => (
                  <li key={`${c}-${i}`} className="walkable-row">
                    <div className="walkable-row-body">
                      <div className="walkable-row-name">{it.name}</div>
                      <div className="walkable-row-meta">
                        도보 약 {it.walking_minutes ?? "?"}분 · {it.distance_m}m
                      </div>
                    </div>
                    {it.place_url && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          window.open(
                            it.place_url!,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        보기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      {!loading &&
        cats.every((c) => (byCategory[c] || []).length === 0) && (
          <div className="walkable-empty">주변 후보를 찾지 못했어요.</div>
        )}
    </section>
  );
}
