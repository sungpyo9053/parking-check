import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

type Example = {
  region: string;
  category: string;
  verdict: "good" | "caution" | "tough";
  verdictLabel: string;
  hint: string;
  topRec: string;
  walkMin: number;
  fee: string;
  query: string;
};

const EXAMPLES: Example[] = [
  {
    region: "성수동",
    category: "카페",
    verdict: "tough",
    verdictLabel: "주차 까다로움",
    hint: "주말 골목 주차 거의 불가능. 공영주차장 도보 4~7분",
    topRec: "성수공영주차장",
    walkMin: 5,
    fee: "30분 1,000원",
    query: "성수동 카페",
  },
  {
    region: "강남역",
    category: "맛집",
    verdict: "caution",
    verdictLabel: "주차 확인 필요",
    hint: "회사 빌딩 주차장 多 — 외부 출입 여부 사전 확인",
    topRec: "강남역 노상공영",
    walkMin: 6,
    fee: "30분 1,200원",
    query: "강남역 맛집",
  },
  {
    region: "부산 해운대",
    category: "관광지",
    verdict: "caution",
    verdictLabel: "성수기 주의",
    hint: "관광 성수기 노상 만차. 미포 / 해운대구청 공영 추천",
    topRec: "미포 공영주차장",
    walkMin: 8,
    fee: "30분 800원",
    query: "해운대 카페",
  },
  {
    region: "제주",
    category: "카페",
    verdict: "good",
    verdictLabel: "주차 여유",
    hint: "대부분 자체 주차장 보유. 다만 협소로 1~2자리만 가능",
    topRec: "매장 자체 주차장",
    walkMin: 1,
    fee: "무료",
    query: "제주 카페",
  },
];

export default function LandingExample() {
  const navigate = useNavigate();
  return (
    <section className="lh-section lh-example-section">
      <motion.div
        className="lh-section-header"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <span className="lh-section-tag lh-tag-brand">EXAMPLE</span>
        <h2 className="lh-section-title">이런 식으로 결과가 나와요</h2>
        <p className="lh-section-sub">실제 분석 결과 카드 미리보기.</p>
      </motion.div>

      <div className="lh-example-grid">
        {EXAMPLES.map((ex, i) => (
          <motion.button
            key={ex.region + ex.category}
            type="button"
            className="lh-example-card"
            onClick={() => navigate(`/places?q=${encodeURIComponent(ex.query)}`)}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.06 }}
          >
            <div className="lh-example-head">
              <span
                className={`lh-example-verdict lh-vd-${ex.verdict}`}
              >
                {ex.verdictLabel}
              </span>
              <span className="lh-example-region">
                {ex.region} · {ex.category}
              </span>
            </div>
            <div className="lh-example-hint">{ex.hint}</div>
            <div className="lh-example-detail">
              <div>
                <span className="lh-example-key">1순위</span>
                <span className="lh-example-val">{ex.topRec}</span>
              </div>
              <div>
                <span className="lh-example-key">도보</span>
                <span className="lh-example-val">{ex.walkMin}분</span>
              </div>
              <div>
                <span className="lh-example-key">요금</span>
                <span className="lh-example-val">{ex.fee}</span>
              </div>
            </div>
            <div className="lh-example-cta">검색해보기 →</div>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
