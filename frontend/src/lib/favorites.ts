/**
 * 즐겨찾기 — localStorage 기반 (서버 의존성 X).
 * 같은 브라우저에서만 유지됨. 추후 서버 DB로 옮길 때는 user_token 기반으로.
 */

const KEY = "pk_favorites";
const MAX = 30;

export type Favorite = {
  place_id: number | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  added_at: number; // epoch ms
};

function safeParse(raw: string | null): Favorite[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function listFavorites(): Favorite[] {
  try {
    return safeParse(localStorage.getItem(KEY)).sort(
      (a, b) => b.added_at - a.added_at,
    );
  } catch {
    return [];
  }
}

export function isFavorite(
  place_id: number | null,
  lat: number,
  lng: number,
): boolean {
  return listFavorites().some((f) => sameKey(f, place_id, lat, lng));
}

function sameKey(
  f: Favorite,
  place_id: number | null,
  lat: number,
  lng: number,
): boolean {
  if (place_id != null && f.place_id === place_id) return true;
  // place_id 없으면 좌표 매우 가까이 (소수점 4자리, ~11m)
  return Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lng - lng) < 0.0001;
}

export function addFavorite(fav: Omit<Favorite, "added_at">): void {
  try {
    const list = listFavorites().filter(
      (f) => !sameKey(f, fav.place_id, fav.lat, fav.lng),
    );
    list.unshift({ ...fav, added_at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* ignore quota */
  }
}

export function removeFavorite(
  place_id: number | null,
  lat: number,
  lng: number,
): void {
  try {
    const list = listFavorites().filter((f) => !sameKey(f, place_id, lat, lng));
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function toggleFavorite(fav: Omit<Favorite, "added_at">): boolean {
  if (isFavorite(fav.place_id, fav.lat, fav.lng)) {
    removeFavorite(fav.place_id, fav.lat, fav.lng);
    return false;
  }
  addFavorite(fav);
  return true;
}
