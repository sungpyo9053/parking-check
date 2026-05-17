import { useEffect, useRef, useState } from "react";
import { loadKakaoSDK } from "../lib/kakao";
import { openKakaoFootRoute } from "../lib/maps";

export type MapMarkerDetail = {
  name: string;
  usability?: "usable" | "caution" | "private_restricted";
  usabilityLabel?: string;
  distanceM?: number | null;
  walkingMinutes?: number | null;
};

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  kind?: "destination" | "parking" | "hot" | "current" | "recommended";
  detail?: MapMarkerDetail;
};

type Props = {
  center: { lat: number; lng: number };
  markers?: MapMarker[];
  level?: number;
  /** 목적지 좌표 — 마커 팝업의 "카카오맵 도보 길찾기" 버튼에 사용 */
  destinationLat?: number;
  destinationLng?: number;
  destinationName?: string;
};

const USABILITY_COLOR: Record<string, { bg: string; fg: string; bd: string }> = {
  usable: { bg: "#bbf7d0", fg: "#14532d", bd: "#16a34a" },
  caution: { bg: "#fed7aa", fg: "#9a3412", bd: "#ea580c" },
  private_restricted: { bg: "#fecaca", fg: "#7f1d1d", bd: "#dc2626" },
};

// 전역 핸들러 — 팝업 HTML 안의 버튼/링크가 호출. window 로 노출해야 inline onclick 동작.
declare global {
  interface Window {
    __pkOpenFootRoute?: (fromLat: number, fromLng: number, fromName: string) => void;
    __pkClosePopup?: () => void;
  }
}

export default function KakaoMap({
  center,
  markers = [],
  level = 4,
  destinationLat,
  destinationLng,
  destinationName,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const popupRef = useRef<any>(null);
  // SDK 로드 + Map 인스턴스 준비 완료 신호 — markers effect 의 의존성으로 사용해서
  // race condition (data 가 SDK 보다 먼저 도착해 첫 markers effect 가 mapRef=null
  // 로 빠지는 케이스) 방지
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadKakaoSDK()
      .then(() => {
        if (cancelled || !ref.current) return;
        const k = window.kakao;
        mapRef.current = new k.maps.Map(ref.current, {
          center: new k.maps.LatLng(center.lat, center.lng),
          level,
        });
        setMapReady(true);
      })
      .catch(err => {
        if (!ref.current) return;
        ref.current.innerHTML = `<div style="padding:12px;color:#dc2626">${err.message}</div>`;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // center 변경 시 이동
  useEffect(() => {
    const k = window.kakao;
    if (!mapRef.current || !k) return;
    mapRef.current.setCenter(new k.maps.LatLng(center.lat, center.lng));
  }, [center.lat, center.lng, mapReady]);

  // 전역 핸들러 바인딩 (마운트 한 번)
  useEffect(() => {
    window.__pkClosePopup = () => {
      if (popupRef.current) {
        popupRef.current.setMap(null);
        popupRef.current = null;
      }
    };
    window.__pkOpenFootRoute = (fromLat, fromLng, fromName) => {
      if (destinationLat == null || destinationLng == null) return;
      openKakaoFootRoute(
        { lat: fromLat, lng: fromLng, name: fromName },
        { lat: destinationLat, lng: destinationLng, name: destinationName || "목적지" }
      );
    };
    return () => {
      window.__pkClosePopup = undefined;
      window.__pkOpenFootRoute = undefined;
    };
  }, [destinationLat, destinationLng, destinationName]);

  // markers 변경 시 다시 그리기
  useEffect(() => {
    const k = window.kakao;
    if (!mapReady || !mapRef.current || !k) return;
    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current = [];
    if (popupRef.current) {
      popupRef.current.setMap(null);
      popupRef.current = null;
    }

    const bounds = new k.maps.LatLngBounds();
    let added = 0;

    markers.forEach(m => {
      const pos = new k.maps.LatLng(m.lat, m.lng);
      const isDest = m.kind === "destination";
      const isHot = m.kind === "hot";
      const isCurrent = m.kind === "current";
      const isRec = m.kind === "recommended";

      const u = m.detail?.usability;
      const c = (u && USABILITY_COLOR[u]) || USABILITY_COLOR.usable;

      let pinHtml: string;
      if (isRec) {
        pinHtml = `<div data-marker-id="${escapeHtml(m.id)}" style="display:flex;align-items:center;gap:4px;transform:translate(-50%,-100%);cursor:pointer;">
             <div style="background:#fef3c7;color:#92400e;border:2px solid #f59e0b;
                         border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800;
                         box-shadow:0 2px 6px rgba(245,158,11,.35);white-space:nowrap;">
               ⭐ 추천${m.label ? ` · ${escapeHtml(m.label)}` : ""}
             </div>
           </div>`;
      } else if (isDest) {
        pinHtml = `<div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-100%);">
             <div style="background:#0b6cff;color:#fff;border-radius:999px;padding:6px 10px;
                         font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.18);
                         border:2px solid #fff;">📍 목적지${m.label ? ` · ${escapeHtml(m.label)}` : ""}</div>
           </div>`;
      } else if (isCurrent) {
        pinHtml = `<div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-100%);">
             <div style="background:#3b82f6;color:#fff;border-radius:999px;padding:5px 9px;
                         font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.18);
                         border:2px solid #fff;">📡 현위치</div>
           </div>`;
      } else if (isHot) {
        pinHtml = `<div style="display:flex;align-items:center;gap:4px;transform:translate(-50%,-100%);cursor:pointer;">
             <div style="background:#fef3c7;color:#92400e;border:2px solid #f59e0b;
                         border-radius:999px;padding:3px 8px;font-size:11px;font-weight:800;
                         box-shadow:0 1px 3px rgba(0,0,0,.12);white-space:nowrap;">
               ⭐ ${m.label ? escapeHtml(m.label) : "핫플"}
             </div>
           </div>`;
      } else {
        pinHtml = `<div data-marker-id="${escapeHtml(m.id)}" style="display:flex;align-items:center;gap:4px;transform:translate(-50%,-100%);cursor:pointer;">
             <div style="background:${c.bg};color:${c.fg};border:2px solid ${c.bd};border-radius:6px;
                         padding:2px 6px;font-size:11px;font-weight:800;
                         box-shadow:0 1px 3px rgba(0,0,0,.12);white-space:nowrap;">
               P${m.label ? ` ${escapeHtml(m.label)}` : ""}
             </div>
           </div>`;
      }

      const overlay = new k.maps.CustomOverlay({
        position: pos,
        content: pinHtml,
        yAnchor: 1,
        xAnchor: 0.5,
        zIndex: isRec ? 7 : isDest ? 5 : 3,
      });
      overlay.setMap(mapRef.current);
      overlaysRef.current.push(overlay);

      // 주차장 마커 클릭 → CustomOverlay 팝업 (current/dest 제외)
      if (!isDest && !isCurrent && m.detail) {
        // CustomOverlay 의 content 가 DOM 일 때 직접 이벤트 바인딩 가능
        // 여기서는 HTML 문자열이므로 inline onclick + 전역 핸들러 사용
        const el = (overlay as any).getContent
          ? (overlay as any).getContent()
          : null;
        // Kakao CustomOverlay 의 getContent 는 환경에 따라 string 일 수 있음.
        // 대안: 보이지 않는 Marker 를 추가해서 클릭 이벤트만 받음.
        const clickMarker = new k.maps.Marker({
          position: pos,
          opacity: 0.001, // 거의 안 보이지만 클릭 가능
        });
        clickMarker.setMap(mapRef.current);
        k.maps.event.addListener(clickMarker, "click", () => {
          showPopup(k, mapRef.current, m);
        });
        overlaysRef.current.push(clickMarker);
        void el; // unused
      }

      bounds.extend(pos);
      added += 1;
    });

    if (added >= 2) {
      mapRef.current.setBounds(bounds, 24, 24, 24, 24);
    }

    function showPopup(kk: any, map: any, marker: MapMarker) {
      if (popupRef.current) {
        popupRef.current.setMap(null);
        popupRef.current = null;
      }
      const d = marker.detail!;
      const u = d.usability || "usable";
      const cl = USABILITY_COLOR[u] || USABILITY_COLOR.usable;
      const distText =
        d.distanceM != null && d.walkingMinutes != null
          ? `${d.distanceM}m · 직선거리 기준 도보 약 ${d.walkingMinutes}분`
          : d.distanceM != null
          ? `${d.distanceM}m`
          : "거리 정보 없음";

      const canRoute = destinationLat != null && destinationLng != null;
      const popupHtml = `
        <div class="map-popup" style="
          background:#fff; border:1px solid #d1d5db; border-radius:10px;
          box-shadow:0 4px 12px rgba(0,0,0,.18);
          padding:10px 12px; min-width:220px; max-width:280px;
          font-family:inherit; transform:translate(-50%,calc(-100% - 14px));
        ">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
            <strong style="font-size:13px;line-height:1.3;">${escapeHtml(d.name)}</strong>
            <button onclick="window.__pkClosePopup && window.__pkClosePopup()"
              style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;padding:0 2px;">×</button>
          </div>
          <div style="display:inline-block;background:${cl.bg};color:${cl.fg};border-radius:999px;
                      padding:2px 8px;font-size:11px;font-weight:700;margin-bottom:6px;">
            ${escapeHtml(d.usabilityLabel || "")}
          </div>
          <div style="font-size:12px;color:#4b5563;margin-bottom:8px;">
            ${escapeHtml(distText)}
          </div>
          ${
            canRoute
              ? `<button
                  onclick="window.__pkOpenFootRoute && window.__pkOpenFootRoute(${marker.lat},${marker.lng},'${escapeJsString(d.name)}')"
                  style="width:100%;background:#0b6cff;color:#fff;border:none;border-radius:8px;
                         padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer;">
                  카카오맵 도보 길찾기
                </button>`
              : ""
          }
          <div style="font-size:10px;color:#9ca3af;margin-top:6px;line-height:1.4;">
            실제 도보 경로는 도로/횡단보도/경사에 따라 달라질 수 있습니다.
          </div>
        </div>`;
      const popup = new kk.maps.CustomOverlay({
        position: new kk.maps.LatLng(marker.lat, marker.lng),
        content: popupHtml,
        yAnchor: 1,
        xAnchor: 0.5,
        zIndex: 100,
      });
      popup.setMap(map);
      popupRef.current = popup;
    }
  }, [markers, destinationLat, destinationLng, destinationName, mapReady]);

  return <div ref={ref} className="map-wrap" />;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}
