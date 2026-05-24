import { useEffect, useState } from "react";

type Props = {
  value: number;
  /** 애니메이션 길이 (ms). 기본 700 — 토스/배민 톤. */
  duration?: number;
  /** 출력 변환. 기본은 Math.round 후 toString. */
  format?: (n: number) => string;
  className?: string;
};

/** raf 기반 안전한 카운트업.
 *  framer-motion MotionValue children 패턴은 minified prod 빌드에서 흰화면 사고
 *  가능성 있어 회피. 의존성 없는 plain react.
 */
export default function NumberTicker({
  value,
  duration = 700,
  format,
  className,
}: Props) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const startVal = 0;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      setN(startVal + (value - startVal) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{format ? format(n) : Math.round(n).toString()}</span>;
}

export const formatThousands = (n: number) =>
  Math.round(n).toLocaleString("ko-KR");
