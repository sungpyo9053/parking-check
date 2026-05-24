import { motion, useScroll, useTransform } from "framer-motion";

/** 배민/토스 스타일 스크롤리텔링 헤드라인.
 *
 *  - 0~80px 스크롤: 카피 1 (페르소나/감성) 그대로 보임
 *  - 80~160px: 카피 1 fade-out + 카피 2 (브랜드) fade-in, 살짝 위로 슬라이드
 *  - 두 카피는 같은 자리에 absolute 로 겹쳐 cross-fade.
 *
 *  스크롤이 짧은 사용자도 어색하지 않도록 transform 폭은 작게 (16px).
 */
export default function ScrollHeroHeadline() {
  const { scrollY } = useScroll();
  const copy1Opacity = useTransform(scrollY, [0, 80, 160], [1, 1, 0]);
  const copy1Y = useTransform(scrollY, [0, 160], [0, -10]);
  const copy2Opacity = useTransform(scrollY, [80, 160, 220], [0, 1, 1]);
  const copy2Y = useTransform(scrollY, [80, 220], [10, 0]);

  return (
    <div className="hero-headline-stack" aria-label="주차될까 — 메인 카피">
      <motion.h1
        className="h1 hero-copy"
        style={{ opacity: copy1Opacity, y: copy1Y }}
      >
        오늘 거기, 주차 자리 있을까?
      </motion.h1>
      <motion.h1
        className="h1 hero-copy hero-copy-brand"
        style={{ opacity: copy2Opacity, y: copy2Y }}
        aria-hidden
      >
        주차될까 — 가기 전 1초 미리 확인
      </motion.h1>
    </div>
  );
}
