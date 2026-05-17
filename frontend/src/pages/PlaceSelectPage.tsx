import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, PlaceItem } from "../lib/api";
import { useRecentSearches } from "../hooks/useRecentSearches";

export default function PlaceSelectPage() {
  const [sp] = useSearchParams();
  const q = sp.get("q") || "";
  const navigate = useNavigate();
  const { push } = useRecentSearches();

  const [items, setItems] = useState<PlaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q) return;
    setError(null);
    setItems(null);
    api
      .searchPlaces(q)
      .then((res) => setItems(res.items))
      .catch((e) => setError(e.message));
  }, [q]);

  function choose(p: PlaceItem) {
    push({
      query: q,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      place_id: p.place_id,
    });
    if (p.place_id != null) {
      navigate(
        `/analyze?place_id=${p.place_id}&name=${encodeURIComponent(p.name)}`,
      );
    } else {
      navigate(
        `/analyze?lat=${p.lat}&lng=${p.lng}&name=${encodeURIComponent(p.name)}`,
      );
    }
  }

  return (
    <div>
      <h1 className="h1">장소 선택</h1>
      <p className="tagline">"{q}" 검색 결과</p>

      {error && <p className="error">검색 실패: {error}</p>}
      {!items && !error && <p className="muted">불러오는 중...</p>}
      {items && items.length === 0 && (
        <p className="muted">결과가 없습니다. 다른 키워드로 시도해보세요.</p>
      )}

      <ul className="list">
        {items?.map((p) => (
          <li
            key={`${p.external_id}-${p.name}`}
            className="list-item clickable"
            onClick={() => choose(p)}
          >
            <span className="title">{p.name}</span>
            <span className="sub">{p.road_address || p.address}</span>
            {p.category && <span className="sub">{p.category}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
