import type { Candidate } from "../lib/api";
import RiskBadge from "./RiskBadge";

type Props = {
  c: Candidate;
  onSelect?: (c: Candidate) => void;
  onOpenMap?: (c: Candidate) => void;
};

export default function ParkingCard({ c, onSelect, onOpenMap }: Props) {
  return (
    <div className="pcard">
      <div className="head">
        <span className="name">{c.name}</span>
        <RiskBadge value={c.congestion} />
      </div>
      <div className="meta">
        <span>{c.distance_m}m · 도보 {c.walk_minutes}분</span>
        {c.type && <span>· {c.type}</span>}
        {c.capacity != null && <span>· 총 {c.capacity}면</span>}
        {c.is_open_now === false && <span>· 운영시간 외</span>}
      </div>
      {c.realtime && (
        <div className="meta">
          잔여 {c.realtime.available_count ?? "?"} / {c.realtime.total_capacity ?? "?"} 면
          {c.realtime.stale_seconds != null && (
            <span> · {Math.round(c.realtime.stale_seconds / 60)}분 전 기준</span>
          )}
        </div>
      )}
      {c.fee_summary && <div className="meta">{c.fee_summary}</div>}
      {c.reasons.length > 0 && (
        <div className="reasons">· {c.reasons.slice(0, 3).join(" · ")}</div>
      )}
      {c.history && c.history.my_visits > 0 && (
        <div className="reasons">
          내 방문 {c.history.my_visits}회
          {c.history.my_success_rate != null &&
            ` · 성공률 ${Math.round(c.history.my_success_rate * 100)}%`}
        </div>
      )}
      <div className="actions">
        <button className="btn primary" onClick={() => onSelect?.(c)}>
          이 주차장으로 가기
        </button>
        <button className="btn" onClick={() => onOpenMap?.(c)}>
          카카오맵 길찾기
        </button>
      </div>
    </div>
  );
}
