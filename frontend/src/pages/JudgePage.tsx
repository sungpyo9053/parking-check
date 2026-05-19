import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { JudgeEntry, rank, scoreEntry } from "../utils/judgePresentation";
import PlaceBattleInput, {
  BattleCandidate,
} from "../components/judge/PlaceBattleInput";
import ParkingJudgeRanking from "../components/judge/ParkingJudgeRanking";
import WinnerPlaceCard from "../components/judge/WinnerPlaceCard";
import RejectedPlaceCard from "../components/judge/RejectedPlaceCard";
import DriverProtectionCard from "../components/judge/DriverProtectionCard";
import ShareJudgeResultCard from "../components/judge/ShareJudgeResultCard";

/** 약속 장소 심판 페이지 (/judge).
 *  사용자가 후보 2~5개를 입력 → 각각 /api/parking/analyze 호출 →
 *  safety score 산정 → 우승/탈락/운전자 보호 카드 노출.
 */
export default function JudgePage() {
  const [cands, setCands] = useState<BattleCandidate[]>([]);
  const [phase, setPhase] = useState<"input" | "loading" | "result">("input");
  const [entries, setEntries] = useState<JudgeEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function addCand(c: BattleCandidate) {
    setCands((prev) => [...prev, c]);
  }
  function removeCand(key: string) {
    setCands((prev) => prev.filter((c) => c.key !== key));
  }
  function reset() {
    setCands([]);
    setEntries([]);
    setPhase("input");
    setErr(null);
  }

  async function startJudge() {
    if (cands.length < 2) return;
    setPhase("loading");
    setErr(null);
    try {
      const results = await Promise.all(
        cands.map(async (c) => {
          try {
            const d = await api.analyze({
              place_id: c.place_id ?? undefined,
              lat: c.place_id == null ? c.lat : undefined,
              lng: c.place_id == null ? c.lng : undefined,
              name: c.name,
              radius: 500,
            });
            return scoreEntry(c.name, d);
          } catch {
            return scoreEntry(c.name, null);
          }
        }),
      );
      setEntries(rank(results));
      setPhase("result");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase("input");
    }
  }

  const winner = entries[0];
  const losers = entries.slice(1);
  const worst = entries[entries.length - 1];

  return (
    <div className="judge-page">
      <header className="judge-page-head">
        <Link to="/" className="judge-page-back">
          ← 홈
        </Link>
        <h1 className="judge-page-title">약속 장소 심판</h1>
      </header>
      <p className="judge-page-intro">
        후보 2~5개를 입력하면 차량 방문 관점에서 가장 안전한 곳을
        골라드려요.
      </p>

      {phase === "input" && (
        <PlaceBattleInput
          candidates={cands}
          onAdd={addCand}
          onRemove={removeCand}
          onJudge={startJudge}
          max={5}
        />
      )}

      {phase === "loading" && (
        <div className="judge-loading">
          ⏳ {cands.length}곳 분석 중… 잠시만요
        </div>
      )}

      {err && <div className="battle-err">분석 실패: {err}</div>}

      {phase === "result" && winner && (
        <>
          <WinnerPlaceCard top={winner} />
          <ParkingJudgeRanking entries={entries} />
          {losers.length > 0 && (
            <section className="rejected-section">
              <h2 className="h2" style={{ marginBottom: 8 }}>
                탈락 후보
              </h2>
              {losers.map((e, i) => (
                <RejectedPlaceCard key={`${e.name}-${i}`} entry={e} />
              ))}
            </section>
          )}
          {worst && worst.safety < 45 && worst !== winner && (
            <DriverProtectionCard worst={worst} />
          )}
          <ShareJudgeResultCard entries={entries} />
          <button
            type="button"
            className="btn judge-reset"
            onClick={reset}
          >
            새로 비교하기
          </button>
        </>
      )}
    </div>
  );
}
