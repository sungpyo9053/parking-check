export function naverSearchUrl(query: string): string {
  const q = new URLSearchParams({ query });
  return `https://search.naver.com/search.naver?${q.toString()}`;
}

export function openNaverSearch(query: string): void {
  window.open(naverSearchUrl(query), "_blank", "noopener,noreferrer");
}
