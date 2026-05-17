/**
 * Kakao Maps JS SDK 를 1회만 로드.
 * 호출: await loadKakaoSDK(); const map = new window.kakao.maps.Map(...)
 */
let loader: Promise<void> | null = null;

export function loadKakaoSDK(): Promise<void> {
  if (loader) return loader;
  const key = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;
  if (!key) {
    return Promise.reject(new Error("VITE_KAKAO_JAVASCRIPT_KEY가 비어 있음"));
  }

  loader = new Promise<void>((resolve, reject) => {
    // 이미 로드돼있으면 services 까지 로드 후 resolve
    if (window.kakao?.maps?.load) {
      window.kakao.maps.load(() => resolve());
      return;
    }
    const src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`;
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.onerror = (event) => {
      // 카카오 Developers Web 플랫폼에 현재 origin(예: http://localhost:5173,
      // http://127.0.0.1:5173)이 등록돼 있지 않으면 여기로 빠진다.
      console.error("[Kakao SDK 로드 실패]", {
        src,
        origin: window.location.origin,
        event,
      });
      reject(new Error("Kakao SDK 로드 실패"));
    };
    script.onload = () => {
      window.kakao.maps.load(() => resolve());
    };
    document.head.appendChild(script);
  });

  return loader;
}
