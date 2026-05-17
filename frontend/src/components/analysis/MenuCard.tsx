import type { AnalyzeResponse } from "../../lib/api";

type Props = { menu: NonNullable<AnalyzeResponse["menu"]> };

export default function MenuCard({ menu }: Props) {
  if (!menu.items.length) return null;
  return (
    <div className="menu-card">
      <div className="menu-card-head">
        <span className="menu-card-title">🍽 인기 메뉴</span>
        <span className="muted" style={{ fontSize: 11 }}>
          방문 후기 빈도
        </span>
      </div>
      <div className="menu-chips">
        {menu.items.map((m) => (
          <span key={m.name} className="menu-chip" title={m.evidence || ""}>
            {m.name}
            <span className="menu-chip-count">{m.mentions}회</span>
          </span>
        ))}
      </div>
    </div>
  );
}
