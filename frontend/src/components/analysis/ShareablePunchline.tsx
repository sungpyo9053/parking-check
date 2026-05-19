import { useEffect, useState } from "react";
import type { VerdictInfo } from "../../utils/parkingPresentation";
import {
  buildPunchline,
  loadCarPref,
} from "../../utils/funCardPresentation";

type Props = {
  verdict: VerdictInfo;
  onCopy?: () => void;
};

/** 흐름 신박 4: 공유용 한 줄 밈.
 *  상태별로 다르게. 복사 버튼 1개.
 */
export default function ShareablePunchline({ verdict, onCopy }: Props) {
  const [copied, setCopied] = useState(false);
  const [pref, setPref] = useState({ car: null, drive: null } as ReturnType<
    typeof loadCarPref
  >);
  useEffect(() => {
    setPref(loadCarPref());
  }, []);
  const text = buildPunchline(verdict, pref.car, pref.drive);

  async function doCopy() {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      onCopy?.();
    } catch {
      /* ignore */
    }
  }

  return (
    <section className={`punchline punchline-${verdict.kind}`}>
      <div className="punchline-quote">“{text}”</div>
      <button type="button" className="punchline-copy" onClick={doCopy}>
        {copied ? "복사됨 ✓" : "복사"}
      </button>
    </section>
  );
}
