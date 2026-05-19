import { useState } from "react";
import type { BasecampPark } from "../../utils/basecampPresentation";
import { basecampPunchline } from "../../utils/basecampPresentation";
import { sharePage } from "../../lib/share";

type Props = {
  park: BasecampPark;
  regionLabel: string | null;
  walkableCount: number;
};

/** 베이스캠프 공유 카드 — 펀치라인 + 공유 버튼. */
export default function BasecampShareCard({
  park,
  regionLabel,
  walkableCount,
}: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const punch = basecampPunchline(regionLabel);

  async function doShare() {
    const text = [
      "🅿️ 오늘의 주차 베이스캠프",
      `장소: ${park.name}`,
      regionLabel ? `지역: ${regionLabel}` : null,
      `도보권 후보 ${walkableCount}곳`,
      "",
      `"${punch}"`,
    ]
      .filter(Boolean)
      .join("\n");
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const r = await sharePage({
      title: "parking-check 베이스캠프",
      text,
      url,
    });
    if (r.kind === "shared") setMsg("공유됨");
    else if (r.kind === "copied") setMsg("결과 복사됨");
    else setMsg(`공유 실패: ${r.message}`);
    setTimeout(() => setMsg(null), 1800);
  }

  return (
    <section className="basecamp-share">
      <div className="basecamp-share-punch">“{punch}”</div>
      <div className="basecamp-share-row">
        <button type="button" className="btn primary" onClick={doShare}>
          카톡/링크 공유
        </button>
      </div>
      {msg && <div className="basecamp-share-msg">{msg}</div>}
    </section>
  );
}
