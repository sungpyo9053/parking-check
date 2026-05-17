/**
 * 카카오맵 외부 링크 유틸.
 *
 * 카카오맵의 공식 "도보 길찾기" REST API 는 제휴 파트너 전용이라 우리가 서버에서
 * 호출하지 않는다. 사용자에게 도보 경로를 보여주려면 카카오맵 앱/웹으로
 * 보내는 게 가장 확실한 방법이다.
 *
 * 시도 순서:
 *   1) 모바일에서는 kakaomap://route?... (앱 설치 시 도보 모드로 바로 열림)
 *   2) 데스크탑/앱 없음 → https://map.kakao.com/?sName=&sX=&sY=&eName=&eX=&eY=
 *      길찾기 페이지를 좌표 기반으로 띄움. 도보 모드 강제는 보장되지 않으니
 *      사용자가 도보 탭을 한 번 누르면 됨.
 *
 * TODO: 카카오모빌리티 도보 길찾기 API 제휴 가능 시 실제 도보 경로/시간 계산 적용.
 *       또는 Naver Directions / OpenRouteService 도보 경로 API 대안 검토.
 */

export type LatLng = { lat: number; lng: number };

export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** 카카오맵 도보 길찾기 (모바일 앱) URL */
export function kakaoMapRouteSchemeUrl(from: LatLng, to: LatLng): string {
  return `kakaomap://route?sp=${from.lat},${from.lng}&ep=${to.lat},${to.lng}&by=FOOT`;
}

/** 카카오맵 길찾기 웹 URL (도보 모드 강제는 보장 안 됨) */
export function kakaoMapRouteWebUrl(
  from: LatLng & { name?: string },
  to: LatLng & { name?: string },
): string {
  const params = new URLSearchParams({
    sName: from.name || "출발",
    sX: String(from.lng),
    sY: String(from.lat),
    eName: to.name || "도착",
    eX: String(to.lng),
    eY: String(to.lat),
  });
  return `https://map.kakao.com/?${params.toString()}`;
}

/** 안전 폴백: 카카오맵에서 특정 좌표/이름 검색 */
export function kakaoMapSearchUrl(query: string, center?: LatLng): string {
  const params = new URLSearchParams({ q: query });
  if (center) {
    params.set("map_type", "TYPE_MAP");
    params.set("MX", String(center.lng));
    params.set("MY", String(center.lat));
  }
  return `https://map.kakao.com/?${params.toString()}`;
}

/**
 * 도보 길찾기 열기 — 모바일이면 앱 scheme, 데스크탑/실패 시 웹 길찾기.
 *
 * 모바일에서 앱이 없는 경우 scheme 호출은 무반응이라 일정 시간 후 웹으로 폴백.
 */
export function openKakaoFootRoute(
  from: LatLng & { name?: string },
  to: LatLng & { name?: string },
): void {
  const web = kakaoMapRouteWebUrl(from, to);
  if (isMobile()) {
    const scheme = kakaoMapRouteSchemeUrl(from, to);
    // iframe hidden 으로 scheme 시도 + 일정 시간 후 웹으로 폴백
    const fallbackTimer = window.setTimeout(() => {
      window.open(web, "_blank", "noopener,noreferrer");
    }, 1200);
    const onHide = () => {
      // 앱이 열렸으면 페이지가 hidden 상태가 되므로 폴백 취소
      if (document.visibilityState === "hidden") {
        window.clearTimeout(fallbackTimer);
        document.removeEventListener("visibilitychange", onHide);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.location.href = scheme;
  } else {
    window.open(web, "_blank", "noopener,noreferrer");
  }
}
