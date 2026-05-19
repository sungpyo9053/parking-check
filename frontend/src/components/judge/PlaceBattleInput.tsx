import { useState } from "react";
import { api, PlaceItem } from "../../lib/api";

export type BattleCandidate = {
  key: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  place_id: number | null;
};

type Props = {
  candidates: BattleCandidate[];
  onAdd: (c: BattleCandidate) => void;
  onRemove: (key: string) => void;
  onJudge: () => void;
  max?: number;
};

/** 후보 장소 입력 — Kakao 검색 → 후보 풀에 추가 (최대 N). */
export default function PlaceBattleInput({
  candidates,
  onAdd,
  onRemove,
  onJudge,
  max = 5,
}: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PlaceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api.searchPlaces(q.trim(), 5);
      setItems(d.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function add(it: PlaceItem) {
    if (candidates.length >= max) return;
    const key = `${it.external_id || it.name}-${it.lat.toFixed(4)}`;
    if (candidates.find((c) => c.key === key)) return;
    onAdd({
      key,
      name: it.name,
      address: it.road_address || it.address,
      lat: it.lat,
      lng: it.lng,
      place_id: it.place_id,
    });
    setItems([]);
    setQ("");
  }

  return (
    <div className="battle-input">
      <div className="battle-input-head">
        <h2 className="h2" style={{ margin: 0 }}>
          약속 장소 후보 입력
        </h2>
        <span className="battle-input-sub">최대 {max}개</span>
      </div>

      <div className="battle-search">
        <input
          className="battle-search-input"
          placeholder="예: 수유전통시장, 더홈, 디올 성수"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <button
          type="button"
          className="btn primary"
          onClick={search}
          disabled={busy || !q.trim()}
        >
          {busy ? "검색…" : "검색"}
        </button>
      </div>

      {err && <div className="battle-err">검색 실패: {err}</div>}

      {items.length > 0 && (
        <ul className="battle-results">
          {items.map((it, i) => {
            const key = `${it.external_id || it.name}-${it.lat.toFixed(4)}`;
            const added = !!candidates.find((c) => c.key === key);
            return (
              <li key={i} className="battle-result-row">
                <div className="battle-result-body">
                  <div className="battle-result-name">{it.name}</div>
                  <div className="battle-result-addr">
                    {it.road_address || it.address || "주소 미상"}
                  </div>
                </div>
                <button
                  type="button"
                  className={`btn${added ? "" : " primary"}`}
                  disabled={added || candidates.length >= max}
                  onClick={() => add(it)}
                >
                  {added ? "추가됨" : "후보 추가"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="battle-pool">
          <div className="battle-pool-head">
            현재 후보 {candidates.length}/{max}
          </div>
          <ul className="battle-pool-list">
            {candidates.map((c) => (
              <li key={c.key} className="battle-pool-row">
                <div className="battle-pool-name">{c.name}</div>
                <button
                  type="button"
                  className="battle-pool-remove"
                  onClick={() => onRemove(c.key)}
                  aria-label="후보 제거"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        className="btn primary battle-judge-btn"
        disabled={candidates.length < 2}
        onClick={onJudge}
      >
        {candidates.length < 2
          ? `후보 2개 이상 필요 (현재 ${candidates.length})`
          : `심판 시작 (${candidates.length}곳 비교)`}
      </button>
    </div>
  );
}
