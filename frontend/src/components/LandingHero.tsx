import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";

/** 배민 톤 랜딩 hero — 100vh, 단어 cycling, 큰 검색창, 스크롤 시 parallax fade. */

const CYCLE_WORDS = [
  "회사 근처",
  "약속 장소",
  "강남 핫플",
  "여행지",
  "주말 마트",
  "데이트 코스",
  "병원",
  "이사 갈 동네",
];
const INTERVAL_MS = 2400;

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (e: FormEvent) => void;
};

export default function LandingHero({ query, onQueryChange, onSubmit }: Props) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % CYCLE_WORDS.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  // Scroll 0~400 구간에서 hero 가 살짝 위로 빠지며 옅어짐 — parallax depth.
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 400], [0, -80]);
  const opacity = useTransform(scrollY, [0, 320], [1, 0.2]);
  const hintOpacity = useTransform(scrollY, [0, 100], [1, 0]);

  return (
    <motion.section className="landing-hero" style={{ y, opacity }}>
      <div className="landing-hero-inner">
        <div className="landing-hero-eyebrow">출발 전 1초</div>
        <h1 className="landing-hero-title">
          <span className="landing-hero-line">
            <span className="landing-word-slot">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={CYCLE_WORDS[idx]}
                  className="landing-word"
                  initial={{ y: "100%", opacity: 0 }}
                  animate={{ y: "0%", opacity: 1 }}
                  exit={{ y: "-100%", opacity: 0 }}
                  transition={{ type: "tween", duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                >
                  {CYCLE_WORDS[idx]}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="landing-hero-tail"> 갈 때,</span>
          </span>
          <span className="landing-hero-line">주차될까?</span>
        </h1>
        <p className="landing-hero-sub">자체 주차 가능성 · 주변 주차장 · 도보 시간을 한 번에.</p>

        <form className="landing-hero-search" onSubmit={onSubmit}>
          <input
            inputMode="search"
            placeholder="예: 수유전통시장, 더홈 안양, 디올 성수"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoFocus
          />
          <button type="submit">검색</button>
        </form>
      </div>

      <motion.div className="landing-scroll-hint" style={{ opacity: hintOpacity }}>
        <span>스크롤</span>
        <motion.span
          className="landing-scroll-arrow"
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ↓
        </motion.span>
      </motion.div>
    </motion.section>
  );
}
