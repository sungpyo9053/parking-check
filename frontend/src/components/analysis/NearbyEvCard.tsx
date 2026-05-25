import { useEffect, useState } from "react";
import { api, NearbyPoi } from "../../lib/api";

type Props = { destLat: number; destLng: number };

/** 전기차 충전소 표기 (피드백 5). 카카오 키워드 "전기차충전소" 검색. */
export default function NearbyEvCard({ destLat, destLng }: Props) {
  const [items, setItems] = useState<NearbyPoi[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .nearbyPois({ lat: destLat, lng: destLng, category: "ev", radius_m: 1500 })
      .then((r) => {
        if (!cancelled) setItems(r.items.slice(0, 5));
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [destLat, destLng]);

  return (
    <section className="rcard">
      <header className="rcard-head">
        <span className="rcard-tag">EV</span>
        <h3 className="rcard-title">⚡ 주변 전기차 충전소</h3>
      </header>

      {items === null ? (
        <div className="rcard-row">
          <span className="rcard-row-key">불러오는 중…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rcard-row">
          <span className="rcard-row-key">근처 충전소 정보를 찾지 못했습니다.</span>
        </div>
      ) : (
        <ul className="poi-list">
          {items.map((p, i) => (
            <li key={i} className="poi-item">
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
      )}

      <div className="rcard-ev-foot">
        충전기 종류·실시간 가용 상태는{" "}
        <a
          href="https://www.modu-ev.com"
          target="_blank"
          rel="noopener noreferrer"
          className="rcard-link"
        >
          모두의전기차
        </a>{" "}
        앱 또는 환경부 공식 앱에서 확인이 정확합니다.
      </div>
    </section>
  );
}
