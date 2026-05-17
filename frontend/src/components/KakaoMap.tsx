import { useEffect, useRef } from "react";
import { loadKakaoSDK } from "../lib/kakao";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  kind?: "destination" | "parking";
};

type Props = {
  center: { lat: number; lng: number };
  markers?: MapMarker[];
  level?: number;
  onMarkerClick?: (id: string) => void;
};

export default function KakaoMap({ center, markers = [], level = 4, onMarkerClick }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadKakaoSDK()
      .then(() => {
        if (cancelled || !ref.current) return;
        const k = window.kakao;
        mapRef.current = new k.maps.Map(ref.current, {
          center: new k.maps.LatLng(center.lat, center.lng),
          level
        });
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
  }, [center.lat, center.lng]);

  // markers 변경 시 다시 그리기
  useEffect(() => {
    const k = window.kakao;
    if (!mapRef.current || !k) return;
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const bounds = new k.maps.LatLngBounds();
    let added = 0;

    markers.forEach(m => {
      const pos = new k.maps.LatLng(m.lat, m.lng);
      const isDest = m.kind === "destination";

      // CustomOverlay 로 직접 핀을 그려서 목적지/주차장을 시각 구분
      const pinHtml = isDest
        ? `<div style="display:flex;align-items:center;gap:6px;transform:translate(-50%,-100%);">
             <div style="background:#0b6cff;color:#fff;border-radius:999px;padding:6px 10px;
                         font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.18);
                         border:2px solid #fff;">📍 목적지${m.label ? ` · ${m.label}` : ""}</div>
           </div>`
        : `<div style="display:flex;align-items:center;gap:4px;transform:translate(-50%,-100%);">
             <div style="background:#fff;color:#0b6cff;border:2px solid #0b6cff;border-radius:6px;
                         padding:2px 6px;font-size:11px;font-weight:800;
                         box-shadow:0 1px 3px rgba(0,0,0,.12);white-space:nowrap;">
               P${m.label ? ` ${m.label}` : ""}
             </div>
           </div>`;

      const overlay = new k.maps.CustomOverlay({
        position: pos,
        content: pinHtml,
        yAnchor: 1,
        xAnchor: 0.5,
        zIndex: isDest ? 5 : 3,
      });
      overlay.setMap(mapRef.current);
      markersRef.current.push(overlay);

      // 클릭 가능성 위해 보이지 않는 마커도 같이 (이벤트 바인딩용)
      if (onMarkerClick) {
        const marker = new k.maps.Marker({ position: pos, title: m.label });
        marker.setMap(mapRef.current);
        k.maps.event.addListener(marker, "click", () => onMarkerClick(m.id));
        markersRef.current.push(marker);
      }

      bounds.extend(pos);
      added += 1;
    });

    // 마커가 2개 이상이면 모두 보이게 자동 맞춤
    if (added >= 2) {
      mapRef.current.setBounds(bounds, 24, 24, 24, 24);
    }
  }, [markers, onMarkerClick]);

  return <div ref={ref} className="map-wrap" />;
}
