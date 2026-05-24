import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

type Props = {
  value: number;
  /** 애니메이션 길이 (ms). 기본 700 — 토스/배민 톤. */
  duration?: number;
  /** 출력 변환. 천 단위 콤마 등. 기본은 Math.round 후 toString. */
  format?: (n: number) => string;
  className?: string;
};

/** 토스/배민 같은 spring count-up 숫자.
 *  - 마운트 시 0 → value 로 부드럽게 증가
 *  - value 가 바뀌면 현재값 → 새 value 로 다시 애니메이션
 *  - GPU 가속 텍스트 (transform 아닌 textContent 갱신이지만 매우 가벼움)
 */
export default function NumberTicker({
  value,
  duration = 700,
  format,
  className,
}: Props) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (n) =>
    format ? format(n) : Math.round(n).toString(),
  );
  useEffect(() => {
    const controls = animate(mv, value, {
      duration: duration / 1000,
      ease: [0.32, 0.72, 0, 1],
    });
    return () => controls.stop();
  }, [value, duration, mv]);
  return <motion.span className={className}>{display}</motion.span>;
}

export const formatThousands = (n: number) =>
  Math.round(n).toLocaleString("ko-KR");
