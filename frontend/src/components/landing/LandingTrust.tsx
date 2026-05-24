import { motion } from "framer-motion";

export default function LandingTrust() {
  return (
    <section className="lh-section lh-trust-section">
      <motion.div
        className="lh-trust-card"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
      >
        <div className="lh-trust-tag">⚠️ 주차될까는 이런 서비스가 아닙니다</div>
        <h2 className="lh-trust-title">
          실시간 주차 가능 대수가 아닌, <br />
          <span className="lh-trust-emph">방문 전 참고용 주차 판단 정보</span>입니다.
        </h2>

        <div className="lh-trust-grid">
          <div className="lh-trust-item">
            <div className="lh-trust-item-title">📍 데이터 출처</div>
            <ul className="lh-trust-list">
              <li>카카오맵 — 주차장 위치·요금·운영시간</li>
              <li>공공데이터 — 전국 주차장 표준데이터</li>
              <li>웹 검색 — 블로그·리뷰의 자체 주차 후기</li>
              <li>사용자 셀프 라벨 — 방문 후 yes/no 제보</li>
            </ul>
          </div>

          <div className="lh-trust-item">
            <div className="lh-trust-item-title">🧭 판단 기준</div>
            <ul className="lh-trust-list">
              <li>거리·도보 시간·주차장 카테고리·운영시간</li>
              <li>회사·오피스텔·아파트 등 외부 출입 제한 자동 제외</li>
              <li>운영사 브랜드(카카오T·나이스파크 등) 우선 추천</li>
              <li>혼잡 시간대 / 매장 후기 기반 종합 난이도 평가</li>
            </ul>
          </div>
        </div>

        <div className="lh-trust-footnote">
          현장 만차·요금 변동·일시 휴장 등으로 실제와 차이가 있을 수 있습니다.
          중요한 약속이라면 매장에 한 번 더 문의해 주세요.
        </div>
      </motion.div>
    </section>
  );
}
