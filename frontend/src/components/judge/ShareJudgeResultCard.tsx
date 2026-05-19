import { useState } from "react";
import type { JudgeEntry } from "../../utils/judgePresentation";
import { sharePage } from "../../lib/share";

type Props = {
  entries: JudgeEntry[];
};

function buildText(entries: JudgeEntry[]): string {
  if (entries.length === 0) return "";
  const top = entries[0];
  const losers = entries.slice(1);
  const lines = [
    "🏆 오늘의 약속 장소 심판",
    `우승: ${top.name} (${top.safety}점) — 운전자 기준 가장 안전`,
  ];
  if (losers.length > 0) {
    lines.push("─");
    losers.forEach((l, i) => {
      lines.push(`${i + 2}. ${l.name} ${l.safety}점`);
    });
  }
  return lines.join("\n");
}

/** 심판 결과 카톡 공유 카드. */
export default function ShareJudgeResultCard({ entries }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  if (entries.length === 0) return null;

  async function doShare() {
    const text = buildText(entries);
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const r = await sharePage({
      title: "parking-check 약속 장소 심판",
      text,
      url,
    });
    if (r.kind === "shared") setMsg("공유됨");
    else if (r.kind === "copied") setMsg("결과 복사됨");
    else setMsg(`공유 실패: ${r.message}`);
    setTimeout(() => setMsg(null), 1800);
  }

  return (
    <section className="share-judge">
      <div className="share-judge-row">
        <div className="share-judge-text">
          친구한테 결과 보내고 약속 장소 정하기
        </div>
        <button type="button" className="btn primary" onClick={doShare}>
          카톡/링크 공유
        </button>
      </div>
      {msg && <div className="share-judge-msg">{msg}</div>}
    </section>
  );
}
