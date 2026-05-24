import { motion } from "framer-motion";

const SOLUTIONS = [
  {
    emoji: "📊",
    title: "장소별 주차 난이도",
    sub: "혼잡 시간대·자리 회전율·후기 기반 종합 판단",
  },
  {
    emoji: "🏬",
    title: "자체 주차장 여부",
    sub: "매장 자체 주차 가능성 — 블로그·리뷰 evidence 분석",
  },
  {
    emoji: "🅿️",
    title: "근처 대안 주차장",
    sub: "공영·민영·운영사 주차장을 거리/요금 순으로 추천",
  },
  {
    emoji: "🚶",
    title: "도보 거리·시간",
    sub: "추천 주차장에서 목적지까지 실제 도보 경로 기반",
  },
  {
    emoji: "🧭",
    title: "방문 전 판단",
    sub: "\"가져갈지\" vs \"대중교통\" 결정에 필요한 한 줄 결론",
  },
];

export default function LandingSolution() {
  return (
    <section className="lh-section lh-solution-section">
      <motion.div
        className="lh-section-header"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <span className="lh-section-tag lh-tag-brand">SOLUTION</span>
        <h2 className="lh-section-title">이렇게 보여드려요</h2>
        <p className="lh-section-sub">한 번 검색으로 필요한 정보 다섯 가지.</p>
      </motion.div>

      <div className="lh-solution-grid">
        {SOLUTIONS.map((s, i) => (
          <motion.div
            className="lh-solution-card"
            key={s.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.05 }}
          >
            <span className="lh-solution-emoji">{s.emoji}</span>
            <div className="lh-solution-body">
              <div className="lh-solution-title">{s.title}</div>
              <div className="lh-solution-sub">{s.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
