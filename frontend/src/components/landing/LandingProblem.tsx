import { motion } from "framer-motion";

const PROBLEMS = [
  {
    emoji: "🅿️",
    title: "도착했는데 주차장이 없음",
    sub: "골목 한 바퀴 돌아도 자리 없어 결국 멀리 주차",
  },
  {
    emoji: "💬",
    title: "리뷰마다 주차 정보가 제각각",
    sub: "\"가능했어요\" vs \"없어서 헤맸어요\" 누가 맞는지 모름",
  },
  {
    emoji: "🔁",
    title: "근처 주차장 다시 검색해야 함",
    sub: "지도 앱 따로 켜서 주차장 → 도보 거리 → 요금 따로 확인",
  },
  {
    emoji: "🙋",
    title: "동승자에게 설명하기 어려움",
    sub: "\"여기 주차 될 거 같긴 한데...\" 자신 없는 안내",
  },
];

export default function LandingProblem() {
  return (
    <section className="lh-section lh-problem-section">
      <motion.div
        className="lh-section-header"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <span className="lh-section-tag lh-tag-warn">PROBLEM</span>
        <h2 className="lh-section-title">이런 적, 한 번쯤 있죠?</h2>
        <p className="lh-section-sub">차 가져갈지 말지 결정이 어려운 이유.</p>
      </motion.div>

      <div className="lh-problem-grid">
        {PROBLEMS.map((p, i) => (
          <motion.div
            className="lh-problem-card"
            key={p.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.05 }}
          >
            <span className="lh-problem-emoji">{p.emoji}</span>
            <div className="lh-problem-title">{p.title}</div>
            <div className="lh-problem-sub">{p.sub}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
