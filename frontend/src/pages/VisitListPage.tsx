import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Visit } from "../lib/api";

const RESULT_LABEL: Record<string, string> = {
  success: "성공",
  full: "만차",
  waited: "대기 후",
  entrance_lost: "입구 못 찾음",
  fee_mismatch: "요금 오류",
  closed: "운영 안 함",
  etc: "기타",
};

export default function VisitListPage() {
  const [items, setItems] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listVisits()
      .then((res) => setItems(res.items))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="h1">방문 기록</h1>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted">불러오는 중...</p>}
      {items && items.length === 0 && (
        <p className="muted">아직 방문 기록이 없습니다.</p>
      )}
      <ul className="list">
        {items?.map((v) => (
          <li key={v.id} className="list-item clickable">
            <Link to={`/visits/new?id=${v.id}`} style={{ display: "block" }}>
              <span className="title">
                {v.destination_name || "(이름 없음)"} →{" "}
                {v.selected_parking_name || "-"}
              </span>
              <span className="sub">
                {new Date(v.searched_at).toLocaleString("ko-KR")} · 예측{" "}
                {v.predicted_status || "?"} · 결과{" "}
                {v.actual_result
                  ? RESULT_LABEL[v.actual_result] || v.actual_result
                  : "미입력"}
              </span>
              {v.memo && <span className="sub">메모: {v.memo}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
