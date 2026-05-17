import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, Visit } from "../lib/api";

const RESULTS: Array<{ value: string; label: string }> = [
  { value: "success", label: "주차 성공" },
  { value: "full", label: "만차" },
  { value: "waited", label: "대기 후 성공" },
  { value: "entrance_lost", label: "입구 못 찾음" },
  { value: "fee_mismatch", label: "요금 정보 틀림" },
  { value: "closed", label: "운영 안 함" },
  { value: "etc", label: "기타" }
];

export default function VisitLogPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const id = Number(sp.get("id"));
  const [visit, setVisit] = useState<Visit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState("success");
  const [wait, setWait] = useState<string>("");
  const [fee, setFee] = useState<string>("");
  const [entrance, setEntrance] = useState("3");
  const [walking, setWalking] = useState("3");
  const [perceived, setPerceived] = useState("3");
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (!id) return;
    api
      .listVisits()
      .then(res => {
        const v = res.items.find(v => v.id === id) || null;
        setVisit(v);
        if (v?.actual_result) {
          setResult(v.actual_result);
          setWait(v.actual_wait_minutes != null ? String(v.actual_wait_minutes) : "");
          setFee(v.actual_fee != null ? String(v.actual_fee) : "");
          setEntrance(v.entrance_difficulty?.toString() || "3");
          setWalking(v.walking_difficulty?.toString() || "3");
          setPerceived(v.perceived_congestion?.toString() || "3");
          setMemo(v.memo || "");
        }
      })
      .catch(e => setError(e.message));
  }, [id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    api
      .updateVisitResult(id, {
        actual_result: result,
        actual_wait_minutes: wait ? Number(wait) : null,
        actual_fee: fee ? Number(fee) : null,
        entrance_difficulty: Number(entrance),
        walking_difficulty: Number(walking),
        perceived_congestion: Number(perceived),
        memo: memo || null
      } as any)
      .then(() => navigate("/visits"))
      .catch(e => setError(e.message));
  }

  return (
    <div>
      <h1 className="h1">방문 결과 기록</h1>
      {error && <p className="error">{error}</p>}
      {!visit && !error && <p className="muted">불러오는 중...</p>}

      {visit && (
        <>
          <div className="summary-card">
            <div className="row">
              <span className="label">목적지</span>
              <span>{visit.destination_name || "-"}</span>
            </div>
            <div className="row">
              <span className="label">선택 주차장</span>
              <span>{visit.selected_parking_name || "-"}</span>
            </div>
            <div className="row">
              <span className="label">예측 상태</span>
              <span>
                {visit.predicted_status} ({visit.predicted_risk_score})
                {visit.api_available_count != null &&
                  ` / 잔여 ${visit.api_available_count}/${visit.api_total_capacity ?? "?"}`}
              </span>
            </div>
            <div className="row">
              <span className="label">검색 시각</span>
              <span>{new Date(visit.searched_at).toLocaleString("ko-KR")}</span>
            </div>
          </div>

          <form onSubmit={submit}>
            <div className="form-row">
              <label>실제 결과</label>
              <select value={result} onChange={e => setResult(e.target.value)}>
                {RESULTS.map(r => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>대기 시간 (분)</label>
              <input
                inputMode="numeric"
                value={wait}
                onChange={e => setWait(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>실제 요금 (원)</label>
              <input
                inputMode="numeric"
                value={fee}
                onChange={e => setFee(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>입구 난이도 (1쉬움 ~ 5어려움)</label>
              <input
                type="range"
                min={1}
                max={5}
                value={entrance}
                onChange={e => setEntrance(e.target.value)}
              />
              <span className="muted">{entrance}</span>
            </div>
            <div className="form-row">
              <label>도보 난이도 (1쉬움 ~ 5어려움)</label>
              <input
                type="range"
                min={1}
                max={5}
                value={walking}
                onChange={e => setWalking(e.target.value)}
              />
              <span className="muted">{walking}</span>
            </div>
            <div className="form-row">
              <label>체감 혼잡도 (1여유 ~ 5만차)</label>
              <input
                type="range"
                min={1}
                max={5}
                value={perceived}
                onChange={e => setPerceived(e.target.value)}
              />
              <span className="muted">{perceived}</span>
            </div>
            <div className="form-row">
              <label>메모</label>
              <textarea value={memo} onChange={e => setMemo(e.target.value)} />
            </div>
            <button className="btn primary" type="submit" style={{ width: "100%" }}>
              저장
            </button>
          </form>
        </>
      )}
    </div>
  );
}
