import { useNavigate } from "react-router-dom";
import type { ParkingResult } from "../../utils/parkingResult";

type Props = {
  result: ParkingResult;
  destLat: number;
  destLng: number;
  onShare: () => void;
  onScrollToNearby: () => void;
};

export default function RecommendedActionCard({
  result,
  destLat,
  destLng,
  onShare,
  onScrollToNearby,
}: Props) {
  const navigate = useNavigate();

  function runAction(id: string) {
    switch (id) {
      case "check_nearby":
      case "set_nearby":
        onScrollToNearby();
        return;
      case "public_transport":
        window.open(
          `https://map.kakao.com/?map_type=TYPE_MAP&target=transit&eName=${encodeURIComponent(
            result.placeName,
          )}&eX=${destLng}&eY=${destLat}`,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      case "verify":
        window.open(
          `https://map.kakao.com/?q=${encodeURIComponent(
            result.placeName + " 주차",
          )}`,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      case "modu_parking":
        // 카카오톡 공유 패턴과 동일하게 외부 앱/웹 열기
        window.open(
          "https://www.moduparking.com",
          "_blank",
          "noopener,noreferrer",
        );
        return;
      case "modu_ev":
        window.open(
          "https://www.modu-ev.com",
          "_blank",
          "noopener,noreferrer",
        );
        return;
      case "search_other":
        navigate("/");
        return;
      case "share":
        onShare();
        return;
    }
  }

  return (
    <section className="rcard">
      <header className="rcard-head">
        <span className="rcard-tag">추천 행동</span>
        <h3 className="rcard-title">이렇게 해보세요</h3>
      </header>
      <div className="ract-grid">
        {result.recommendedActions.map((a) => (
          <button
            key={a.id}
            className="ract-btn"
            type="button"
            onClick={() => runAction(a.id)}
          >
            {a.icon && <span className="ract-icon">{a.icon}</span>}
            <span className="ract-body">
              <span className="ract-title">{a.label}</span>
              <span className="ract-sub">{a.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
