import { useNavigate } from "react-router-dom";

type Props = {
  destName: string;
  onShare: () => void;
  onScrollToNearby: () => void;
};

/** 추천 행동 — 4개 액션. */
export default function RecommendedActionCard({ destName, onShare, onScrollToNearby }: Props) {
  const navigate = useNavigate();
  return (
    <section className="rcard">
      <header className="rcard-head">
        <span className="rcard-tag">추천 행동</span>
        <h3 className="rcard-title">이렇게 해보세요</h3>
      </header>
      <div className="ract-grid">
        <button className="ract-btn" type="button" onClick={onScrollToNearby}>
          <span className="ract-icon">🅿️</span>
          <span className="ract-body">
            <span className="ract-title">근처 주차장 먼저 확인</span>
            <span className="ract-sub">아래 후보 리스트에서 거리/요금 비교</span>
          </span>
        </button>
        <button
          className="ract-btn"
          type="button"
          onClick={() => {
            const q = encodeURIComponent(`${destName} 가는 길 대중교통`);
            window.open(
              `https://map.kakao.com/?q=${q}`,
              "_blank",
              "noopener,noreferrer",
            );
          }}
        >
          <span className="ract-icon">🚇</span>
          <span className="ract-body">
            <span className="ract-title">대중교통 추천</span>
            <span className="ract-sub">카카오맵 길찾기로 빠르게 비교</span>
          </span>
        </button>
        <button className="ract-btn" type="button" onClick={() => navigate("/")}>
          <span className="ract-icon">🔎</span>
          <span className="ract-body">
            <span className="ract-title">다른 장소 검색하기</span>
            <span className="ract-sub">홈으로 돌아가 새로 분석</span>
          </span>
        </button>
        <button className="ract-btn" type="button" onClick={onShare}>
          <span className="ract-icon">📤</span>
          <span className="ract-body">
            <span className="ract-title">결과 공유하기</span>
            <span className="ract-sub">동승자에게 한 번에 전달</span>
          </span>
        </button>
      </div>
    </section>
  );
}
