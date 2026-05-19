import type { JudgeEntry } from "../../utils/judgePresentation";
import { protectionLines } from "../../utils/judgePresentation";

type Props = {
  worst: JudgeEntry;
};

/** 운전자 보호 카드 — 가장 위험한 후보 강조용.
 *  카톡 공유 설득 카드 톤. 3가지 이유 + 결론.
 */
export default function DriverProtectionCard({ worst }: Props) {
  const lines = protectionLines(worst);
  return (
    <section className="protection-card">
      <div className="protection-badge">🛡️ 운전자 보호 카드</div>
      <div className="protection-title">
        {worst.name}은 차 가져가면 위험해요
      </div>
      <ul className="protection-reasons">
        {lines.map((l, i) => (
          <li key={i}>· {l}</li>
        ))}
      </ul>
      <div className="protection-conclude">운전자를 보호해주세요.</div>
    </section>
  );
}
