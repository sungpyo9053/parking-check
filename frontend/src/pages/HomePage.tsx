import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRecentSearches } from "../hooks/useRecentSearches";

export default function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { items, clear } = useRecentSearches();

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate(`/places?q=${encodeURIComponent(query)}`);
  }

  return (
    <div>
      <h1 className="h1">주차될까</h1>
      <p className="tagline">목적지를 입력하면 주차 가능성을 먼저 확인합니다.</p>

      <form className="search-box" onSubmit={submit}>
        <input
          inputMode="search"
          placeholder="예: 성수동 디올"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
        <button type="submit">검색</button>
      </form>

      <h2 className="h2">최근 검색</h2>
      {items.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>아직 검색 기록이 없습니다.</p>
      ) : (
        <ul className="list">
          {items.map(it => (
            <li
              key={`${it.place_id ?? it.name}-${it.ts}`}
              className="list-item clickable"
              onClick={() => {
                const url = it.place_id
                  ? `/analyze?place_id=${it.place_id}&name=${encodeURIComponent(it.name)}`
                  : `/analyze?lat=${it.lat}&lng=${it.lng}&name=${encodeURIComponent(it.name)}`;
                navigate(url);
              }}
            >
              <span className="title">{it.name}</span>
              <span className="sub">{it.query}</span>
            </li>
          ))}
          <li>
            <button className="btn" onClick={clear} style={{ width: "100%" }}>
              최근 검색 지우기
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
