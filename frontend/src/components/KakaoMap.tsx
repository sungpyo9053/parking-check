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

    markers.forEach(m => {
      const marker = new k.maps.Marker({
        position: new k.maps.LatLng(m.lat, m.lng),
        title: m.label
      });
      marker.setMap(mapRef.current);

      if (m.label) {
        const overlay = new k.maps.CustomOverlay({
          position: new k.maps.LatLng(m.lat, m.lng),
          content:
            `<div style="background:#fff;border:1px solid #d1d5db;border-radius:10px;` +
            `padding:2px 6px;font-size:11px;transform:translateY(-32px);white-space:nowrap;` +
            `box-shadow:0 1px 2px rgba(0,0,0,.08)">${m.label}</div>`,
          yAnchor: 1
        });
        overlay.setMap(mapRef.current);
      }
      if (onMarkerClick) {
        k.maps.event.addListener(marker, "click", () => onMarkerClick(m.id));
      }
      markersRef.current.push(marker);
    });
  }, [markers, onMarkerClick]);

  return <div ref={ref} className="map-wrap" />;
}
