import { FormEvent } from "react";
import { motion } from "framer-motion";

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (e: FormEvent) => void;
};

export default function LandingFinalCTA({ query, onQueryChange, onSubmit }: Props) {
  return (
    <section className="lh-section lh-final-section">
      <motion.div
        className="lh-final-inner"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.55 }}
      >
        <h2 className="lh-final-title">
          지금 갈 장소,<br />
          <span className="lh-final-emph">주차될까?</span>
        </h2>
        <p className="lh-final-sub">5초만에 미리 확인하세요.</p>

        <form className="lh-hero-search lh-final-search" onSubmit={onSubmit}>
          <div className="lh-search-row">
            <span className="lh-search-icon" aria-hidden>🔎</span>
            <input
              inputMode="search"
              placeholder="장소명을 입력하세요"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </div>
          <button type="submit" className="lh-hero-cta">
            주차 가능성 확인하기
          </button>
        </form>
      </motion.div>
    </section>
  );
}
