import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import type { ParkingResult } from "../../utils/parkingResult";

type Props = {
  placeName: string;
  result: ParkingResult;
  topRecName?: string | null;
  topWalkMin?: number | null;
};

const SUGGESTIONS = [
  "주말 점심에 가도 주차될까요?",
  "차량 방문이 어렵다면 가장 가까운 지하철은?",
  "1순위 주차장 만차일 때 대안은?",
];

export default function AskAiCard({ placeName, result, topRecName, topWalkMin }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string) {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.askAboutPlace({
        place_name: placeName,
        question: text.trim(),
        visit_label: result.visitRecommendationLabel,
        dedicated: result.hasDedicatedParkingLabel,
        nearby_count: result.nearbyParkingCount,
        top_rec_name: topRecName,
        top_walk_min: topWalkMin,
      });
      if (res.answer) {
        setHistory((h) => [...h, { q: text.trim(), a: res.answer! }]);
        setQ("");
      } else {
        setError(res.error || "답변을 가져오지 못했어요.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(q);
  }

  return (
    <section className="rcard ask-card">
      <header className="rcard-head">
        <span className="rcard-tag">자유 질문</span>
        <h3 className="rcard-title">궁금한 점이 있다면</h3>
      </header>

      {history.length === 0 && (
        <div className="ask-suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="ask-suggestion"
              onClick={() => submit(s)}
              disabled={loading}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {history.map((h, i) => (
        <div key={i} className="ask-turn">
          <div className="ask-q">{h.q}</div>
          <div className="ask-a">{h.a}</div>
        </div>
      ))}

      {loading && <div className="ask-loading">답변을 생성하는 중…</div>}
      {error && <div className="ask-error">{error}</div>}

      <form className="ask-form" onSubmit={onSubmit}>
        <input
          type="text"
          inputMode="text"
          placeholder="이 장소에 대해 질문해 보세요"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="ask-submit" disabled={loading || !q.trim()}>
          전송
        </button>
      </form>
      <div className="ask-foot">
        답변은 자동 생성된 참고용 정보이며, 실제와 다를 수 있습니다.
      </div>
    </section>
  );
}
