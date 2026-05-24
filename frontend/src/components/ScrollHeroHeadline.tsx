import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** 배민 메인 히어로 톤의 워드 사이클링.
 *
 *  배민: "[육퇴의 행복] 식지 않도록" → "[배달의민족 세상의 모든 것이] 식지 않도록"
 *  우리: "[○○○] 갈 때, 주차될까?"
 *    — [○○○] 부분만 2.4초마다 위로 슬라이드 + cross-fade 로 회전.
 *  나머지 "갈 때, 주차될까?" 는 고정.
 *
 *  스크롤 의존 X — 첫 진입에도 자동으로 메시지 회전됨 (사용자가 비어있어 스크롤
 *  안 되는 경우도 대응). 추후 스크롤 trigger 도 얹을 수 있음.
 */

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

export default function ScrollHeroHeadline() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % CYCLE_WORDS.length);
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="hero-wrap" aria-label="주차될까">
      <div className="hero-headline">
        <div className="hero-cycle-line">
          <span className="hero-cycle-slot">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={CYCLE_WORDS[idx]}
                className="hero-cycle-word"
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "-100%", opacity: 0 }}
                transition={{
                  type: "tween",
                  duration: 0.45,
                  ease: [0.32, 0.72, 0, 1],
                }}
              >
                {CYCLE_WORDS[idx]}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="hero-cycle-tail"> 갈 때,</span>
        </div>
        <div className="hero-static-line">주차될까?</div>
      </div>
      <p className="hero-sub">가기 전 1초, 미리 확인하세요.</p>
    </section>
  );
}
