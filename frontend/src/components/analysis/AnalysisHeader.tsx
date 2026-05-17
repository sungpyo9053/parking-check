type Props = {
  title: string;
  address?: string | null;
  fav: boolean;
  shareMsg: string | null;
  radius: number;
  onBack: () => void;
  onToggleFav: () => void;
  onShare: () => void;
  onChangeRadius: (radius: number) => void;
};

const RADIUS_CHOICES = [300, 500, 1000] as const;

export default function AnalysisHeader({
  title,
  address,
  fav,
  shareMsg,
  radius,
  onBack,
  onToggleFav,
  onShare,
  onChangeRadius,
}: Props) {
  return (
    <>
      <header className="analyze-topbar">
        <button
          type="button"
          className="topbar-back"
          aria-label="뒤로"
          onClick={onBack}
        >
          ‹
        </button>
        <div className="topbar-title">
          <div className="topbar-name">{title}</div>
          {address && <div className="topbar-addr">{address}</div>}
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            onClick={onToggleFav}
            aria-label={fav ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            className="topbar-icon"
            style={{ color: fav ? "#f59e0b" : "#9ca3af" }}
          >
            {fav ? "★" : "☆"}
          </button>
          <button
            type="button"
            onClick={onShare}
            aria-label="공유"
            className="topbar-icon"
          >
            📤
          </button>
          {shareMsg && <span className="topbar-toast">{shareMsg}</span>}
        </div>
      </header>

      <div className="analyze-chips">
        {RADIUS_CHOICES.map((r) => (
          <button
            key={r}
            type="button"
            className={`chip ${radius === r ? "chip-active" : ""}`}
            onClick={() => onChangeRadius(r)}
          >
            {r >= 1000 ? `${r / 1000}km` : `${r}m`}
          </button>
        ))}
      </div>
    </>
  );
}
