/**
 * 그룹 모드 즐겨찾기 — 서버 동기화. 가입 X, group code 만 공유.
 * localStorage 에 group code 만 저장 (서버가 진실의 출처).
 */
const KEY = "pk_fav_group";

export type StoredGroup = {
  code: string;
  name: string | null;
  joined_at: number;
};

export function getGroup(): StoredGroup | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.code === "string") return v as StoredGroup;
  } catch {
    /* ignore */
  }
  return null;
}

export function setGroup(g: StoredGroup): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

export function clearGroup(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function shareUrl(code: string): string {
  return `${window.location.origin}/?fav=${encodeURIComponent(code)}`;
}
