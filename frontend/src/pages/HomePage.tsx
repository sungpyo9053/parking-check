import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRecentSearches } from "../hooks/useRecentSearches";
import DiscoverHot from "../components/DiscoverHot";
import { Favorite, listFavorites, removeFavorite } from "../lib/favorites";

export default function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { items, clear } = useRecentSearches();
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    setFavorites(listFavorites());
  }, []);

  function openFavorite(f: Favorite) {
    const url = f.place_id
      ? `/analyze?place_id=${f.place_id}&name=${encodeURIComponent(f.name)}`
      : `/analyze?lat=${f.lat}&lng=${f.lng}&name=${encodeURIComponent(f.name)}`;
    navigate(url);
  }

  function removeFav(f: Favorite, e: React.MouseEvent) {
    e.stopPropagation();
    removeFavorite(f.place_id, f.lat, f.lng);
    setFavorites(listFavorites());
  }

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

      <DiscoverHot />

      {favorites.length > 0 && (
        <>
          <h2 className="h2">★ 즐겨찾기</h2>
          <ul className="list">
            {favorites.map(f => (
              <li
                key={`fav-${f.place_id ?? `${f.lat},${f.lng}`}`}
                className="list-item clickable"
                onClick={() => openFavorite(f)}
                style={{ position: "relative" }}
              >
                <span className="title">★ {f.name}</span>
                {f.address && <span className="sub">{f.address}</span>}
                <button
                  type="button"
                  onClick={e => removeFav(f, e)}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    background: "transparent",
                    border: "none",
                    color: "#9ca3af",
                    fontSize: 16,
                    cursor: "pointer",
                  }}
                  aria-label="즐겨찾기 제거"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

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
