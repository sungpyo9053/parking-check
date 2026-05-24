import { FormEvent } from "react";
import { motion } from "framer-motion";

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (e: FormEvent) => void;
};

/** "차 가져가도 될까?" 메인 hero — 큰 검색창 + mockup 결과 카드. */
export default function LandingHero({ query, onQueryChange, onSubmit }: Props) {
  return (
    <section className="lh-hero">
      <div className="lh-hero-inner">
        <motion.div
          className="lh-hero-eyebrow"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          🚗 출발 전 1초, 주차 미리보기
        </motion.div>

        <motion.h1
          className="lh-hero-title"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
        >
          차 가져가도 될까?
        </motion.h1>

        <motion.p
          className="lh-hero-sub"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
        >
          맛집·카페·관광지 가기 전 <strong>주차 가능성</strong>을 먼저 확인하세요.
          <br className="lh-br-desktop" />
          공영주차장, 자체 주차장, 도보 거리까지 한 번에.
        </motion.p>

        <motion.form
          className="lh-hero-search"
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="lh-search-row">
            <span className="lh-search-icon" aria-hidden>
              🔎
            </span>
            <input
              inputMode="search"
              placeholder="장소명을 입력하세요 (예: 성수동 카페, 강남역 맛집)"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="lh-hero-cta">
            주차 가능성 확인하기
          </button>
        </motion.form>

        <motion.div
          className="lh-hero-trust"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.32 }}
        >
          * 방문 전 참고용 정보입니다. 실시간 잔여 대수가 아닙니다.
        </motion.div>
      </div>

      {/* mockup 결과 카드 — 분석 결과가 어떻게 나오는지 미리 보여줌 */}
      <motion.div
        className="lh-hero-mockup"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        <div className="lh-mock-card">
          <div className="lh-mock-header">
            <span className="lh-mock-badge lh-mock-badge-caution">
              ⚠️ 주차 까다로움
            </span>
            <span className="lh-mock-time">미리보기</span>
          </div>
          <div className="lh-mock-place">성수동 ○○ 카페</div>

          <div className="lh-mock-verdict">
            대중교통 추천 — 차 가져가면 골목 헤맬 확률 높음
          </div>

          <div className="lh-mock-rows">
            <div className="lh-mock-row">
              <span className="lh-mock-label">주차 난이도</span>
              <span className="lh-mock-val lh-mock-warn">까다로움</span>
            </div>
            <div className="lh-mock-row">
              <span className="lh-mock-label">자체 주차장</span>
              <span className="lh-mock-val">없음</span>
            </div>
            <div className="lh-mock-row">
              <span className="lh-mock-label">근처 주차장</span>
              <span className="lh-mock-val">성수 공영 · 노상공영 · 민영 3곳</span>
            </div>
            <div className="lh-mock-row">
              <span className="lh-mock-label">1순위 대안</span>
              <span className="lh-mock-val lh-mock-emph">성수 공영주차장</span>
            </div>
            <div className="lh-mock-row">
              <span className="lh-mock-label">도보 거리</span>
              <span className="lh-mock-val">320m · 도보 4분</span>
            </div>
            <div className="lh-mock-row">
              <span className="lh-mock-label">기본요금</span>
              <span className="lh-mock-val">30분 1,000원 · 일 12,000원</span>
            </div>
          </div>

          <div className="lh-mock-footnote">
            * 방문 전 참고용 정보입니다. 실시간 잔여 대수가 아닙니다.
          </div>
        </div>
      </motion.div>
    </section>
  );
}
