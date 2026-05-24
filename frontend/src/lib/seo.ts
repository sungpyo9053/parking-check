/** 동적 document.title + og 메타 설정 (client-side).
 *  SPA 라 크롤러가 JS 안 돌리면 못 잡지만 — Slack/Telegram 등 크롤러 일부는
 *  JS 실행. 카톡/페북 SDK는 server-rendered HTML 만 봄 (한계). */

type Meta = {
  title: string;
  description?: string;
  url?: string;
  image?: string;
};

function setMeta(name: string, content: string, isOg = false) {
  const attr = isOg ? "property" : "name";
  const selector = `meta[${attr}="${name}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function applySeo(meta: Meta) {
  if (meta.title) document.title = meta.title;
  if (meta.description) setMeta("description", meta.description);
  setMeta("og:title", meta.title, true);
  if (meta.description) setMeta("og:description", meta.description, true);
  if (meta.url) setMeta("og:url", meta.url, true);
  setMeta("og:type", "website", true);
  if (meta.image) setMeta("og:image", meta.image, true);
  // Twitter card
  setMeta("twitter:card", meta.image ? "summary_large_image" : "summary");
  setMeta("twitter:title", meta.title);
  if (meta.description) setMeta("twitter:description", meta.description);
  if (meta.image) setMeta("twitter:image", meta.image);
}

/** 페이지 unmount 시 / 다른 페이지 이동 시 원래 값으로 복원하고 싶을 때. */
export function resetSeo() {
  document.title = "주차될까";
}
