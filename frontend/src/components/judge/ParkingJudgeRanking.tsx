import type { JudgeEntry } from "../../utils/judgePresentation";

type Props = {
  entries: JudgeEntry[];
};

/** 정렬된 후보 랭킹 — safety bar + safety 점수. */
export default function ParkingJudgeRanking({ entries }: Props) {
  if (entries.length === 0) return null;
  return (
    <section className="judge-rank">
      <h2 className="h2" style={{ marginBottom: 8 }}>
        주차 기준 랭킹
      </h2>
      <ol className="judge-rank-list">
        {entries.map((e, i) => (
          <li
            key={`${e.name}-${i}`}
            className={`judge-rank-row judge-rank-row-${i === 0 ? "first" : "rest"}`}
          >
            <div className="judge-rank-pos">{i + 1}</div>
            <div className="judge-rank-body">
              <div className="judge-rank-name">{e.name}</div>
              <div className="judge-rank-bar">
                <div
                  className={`judge-rank-fill judge-rank-fill-${bandOf(e.safety)}`}
                  style={{ width: `${e.safety}%` }}
                />
              </div>
              <div className="judge-rank-meta">
                <span className={`judge-rank-tag judge-rank-tag-${bandOf(e.safety)}`}>
                  {e.badge}
                </span>
                <span className="judge-rank-score">
                  <strong>{e.safety}</strong>점
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function bandOf(s: number): "good" | "okay" | "warn" | "bad" {
  if (s >= 75) return "good";
  if (s >= 55) return "okay";
  if (s >= 35) return "warn";
  return "bad";
}
