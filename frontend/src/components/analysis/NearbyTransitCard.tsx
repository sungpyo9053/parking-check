import { useEffect, useState } from "react";
import { api, NearbyPoi } from "../../lib/api";

type Props = { destLat: number; destLng: number };

/** 대중교통 추천 시 보여줄 주변 지하철역 + 버스정류장 (피드백 6). */
export default function NearbyTransitCard({ destLat, destLng }: Props) {
  const [subway, setSubway] = useState<NearbyPoi[] | null>(null);
  const [bus, setBus] = useState<NearbyPoi[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.nearbyPois({ lat: destLat, lng: destLng, category: "subway", radius_m: 800 }).catch(() => ({ items: [] })),
      api.nearbyPois({ lat: destLat, lng: destLng, category: "bus", radius_m: 500 }).catch(() => ({ items: [] })),
    ]).then(([s, b]) => {
      if (cancelled) return;
      setSubway(s.items.slice(0, 3));
      setBus(b.items.slice(0, 4));
    });
    return () => {
      cancelled = true;
    };
  }, [destLat, destLng]);

  const sCount = subway?.length ?? 0;
  const bCount = bus?.length ?? 0;
  if (sCount === 0 && bCount === 0 && subway !== null && bus !== null) return null;

  return (
    <section className="rcard">
      <header className="rcard-head">
        <span className="rcard-tag">대중교통</span>
        <h3 className="rcard-title">주변 정류장</h3>
      </header>

      {subway === null || bus === null ? (
        <div className="rcard-row">
          <span className="rcard-row-key">불러오는 중…</span>
        </div>
      ) : (
        <>
          {sCount > 0 && (
            <div className="poi-group">
              <div className="poi-group-title">🚇 지하철</div>
              <ul className="poi-list">
                {subway!.map((p, i) => (
                  <li key={`s-${i}`} className="poi-item">
                    <span className="poi-name">{p.name}</span>
                    <span className="poi-meta">
                      {p.distance_m != null ? `${p.distance_m}m` : ""}
                      {p.url && (
                        <>
                          {" · "}
                          <a href={p.url} target="_blank" rel="noopener noreferrer">길찾기</a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bCount > 0 && (
            <div className="poi-group">
              <div className="poi-group-title">🚌 버스 정류장</div>
              <ul className="poi-list">
                {bus!.map((p, i) => (
                  <li key={`b-${i}`} className="poi-item">
                    <span className="poi-name">{p.name}</span>
                    <span className="poi-meta">
                      {p.distance_m != null ? `${p.distance_m}m` : ""}
                      {p.url && (
                        <>
                          {" · "}
                          <a href={p.url} target="_blank" rel="noopener noreferrer">위치</a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
