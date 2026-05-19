import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, DiscoverHotResponse, HotPlaceItem } from "../../lib/api";

type Props = {
  destLat: number;
  destLng: number;
  destCategoryGroup: string | null;
  destName: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  cafe: "카페",
  food: "음식점",
  sights: "가볼곳",
};

function inferCategory(group: string | null): "cafe" | "food" | "sights" {
  if (!group) return "cafe";
  if (group.includes("CE7")) return "cafe";
  if (group.includes("FD6")) return "food";
  if (group.includes("AT4")) return "sights";
  return "cafe";
}

/** 흐름 5: 주차 쉬운 대체 장소.
 *  - 현재 verdict 가 uncertain/unavailable 일 때만 부모가 노출
 *  - 같은 카테고리에서 주변 후보 가져와 거리 가까운 순 3개 표시
 *  - "주차 스트레스가 낮은 후보" 라고 명시 (단정적인 인기 순위 X)
 */
export default function AlternativePlaceSection({
  destLat,
  destLng,
  destCategoryGroup,
  destName,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DiscoverHotResponse | null>(null);
  const cat = inferCategory(destCategoryGroup);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .discoverHot({ lat: destLat, lng: destLng, category: cat, limit: 5 })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || "주변 후보 조회 실패");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [destLat, destLng, cat]);

  function openInParking(it: HotPlaceItem) {
    navigate(
      `/analyze?lat=${it.lat}&lng=${it.lng}&name=${encodeURIComponent(it.name)}`,
    );
  }

  // 거리 가까운 순 3개 (현재 매장 본인 제외)
  const top: HotPlaceItem[] = (data?.items || [])
    .filter((it) => it.name !== destName)
    .slice()
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 3);

  return (
    <div className="easy-alt">
      <div className="easy-alt-head">
        <div className="easy-alt-title">여긴 주차가 애매해요</div>
        <div className="easy-alt-sub">
          근처에 차 가져가기 쉬운 {CATEGORY_LABEL[cat]}를 같이 볼까요?
        </div>
      </div>

      {loading && <div className="easy-alt-empty">주변 후보 찾는 중…</div>}
      {error && <div className="easy-alt-empty">조회 실패: {error}</div>}
      {!loading && !error && top.length === 0 && (
        <div className="easy-alt-empty">
          근처에서 대체 후보를 찾지 못했습니다.
        </div>
      )}

      {top.length > 0 && (
        <ul className="easy-alt-list">
          {top.map((it, idx) => (
            <li key={`${it.name}-${idx}`} className="easy-alt-item">
              <div className="easy-alt-rank">{idx + 1}</div>
              <div className="easy-alt-body">
                <div className="easy-alt-name">{it.name}</div>
                <div className="easy-alt-meta">
                  도보 약 {it.walking_minutes}분 · {it.distance_m}m
                </div>
                <div className="easy-alt-chip">주차 스트레스 낮은 후보</div>
              </div>
              <button
                type="button"
                className="btn primary easy-alt-cta"
                onClick={() => openInParking(it)}
              >
                여기로 분석
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
