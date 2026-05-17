/**
 * 공유 헬퍼 — Web Share API (모바일에서 OS 공유 시트 → 카카오톡/메시지/링크 다 포함)
 * 데스크탑/미지원 환경: 클립보드 복사 fallback.
 */

export type ShareData = {
  title: string;
  text: string;
  url: string;
};

export type ShareResult =
  | { kind: "shared" }
  | { kind: "copied" }
  | { kind: "error"; message: string };

export async function sharePage(data: ShareData): Promise<ShareResult> {
  // Web Share API
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({
        title: data.title,
        text: data.text,
        url: data.url,
      });
      return { kind: "shared" };
    } catch (e: unknown) {
      // AbortError = 사용자가 취소한 거. 에러 아님.
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === "AbortError")
        return { kind: "error", message: "취소됨" };
      // share 실패 시 복사로 폴백 시도
    }
  }
  // Clipboard 복사 폴백
  const fallbackText = `${data.title}\n${data.text}\n${data.url}`;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(fallbackText);
      return { kind: "copied" };
    }
  } catch {
    /* fall through */
  }
  // 마지막 폴백: textarea + execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = fallbackText;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return { kind: "copied" };
  } catch {
    /* ignore */
  }
  return { kind: "error", message: "공유/복사 모두 실패" };
}
