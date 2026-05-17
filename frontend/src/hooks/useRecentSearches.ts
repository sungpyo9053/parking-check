import { useCallback, useEffect, useState } from "react";

const KEY = "parking.recent_searches";
const MAX = 8;

export type RecentSearch = {
  query: string;
  name: string;
  lat: number;
  lng: number;
  place_id: number | null;
  ts: number;
};

export function useRecentSearches() {
  const [items, setItems] = useState<RecentSearch[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);

  const push = useCallback((item: Omit<RecentSearch, "ts">) => {
    setItems(prev => {
      const next = [
        { ...item, ts: Date.now() },
        ...prev.filter(p => !(p.place_id != null && p.place_id === item.place_id))
      ].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    localStorage.removeItem(KEY);
  }, []);

  return { items, push, clear };
}
