import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, HotPlaceItem } from "../lib/api";
import {
  BasecampPark,
  WalkableCategory,
  asPark,
} from "../utils/basecampPresentation";
import ParkingBasecampCard from "../components/basecamp/ParkingBasecampCard";
import WalkablePlaceCluster from "../components/basecamp/WalkablePlaceCluster";
import BasecampRouteSuggestion from "../components/basecamp/BasecampRouteSuggestion";
import BasecampShareCard from "../components/basecamp/BasecampShareCard";

/** 베이스캠프 모드 (/basecamp).
 *  현위치(또는 지정 좌표) 주변에서:
 *  1) 가장 가까운 주차장(낮은 stress) = 베이스캠프
 *  2) 그 베이스캠프 주변 도보권 카페/맛집/관광지 cluster
 *  3) 추천 동선 + 공유 카드
 */
export default function BasecampPage() {
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [loadingCoord, setLoadingCoord] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [park, setPark] = useState<BasecampPark | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [byCategory, setByCategory] = useState<
    Record<WalkableCategory, HotPlaceItem[]>
  >({ cafe: [], food: [], sights: [] });
  const [loadingPark, setLoadingPark] = useState(false);
  const [loadingWalk, setLoadingWalk] = useState(false);

  function getLocation() {
    setErr(null);
    if (!navigator.geolocation) {
      setErr("브라우저가 위치 권한을 지원하지 않습니다.");
      return;
    }
    setLoadingCoord(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoadingCoord(false);
      },
      (e) => {
        setLoadingCoord(false);
        setErr(`위치 권한 거부: ${e.message}`);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  // 1) 좌표가 잡히면 카카오 keyword 로 주변 주차장 후보 한번 조회 → 베이스캠프 선정
  useEffect(() => {
    if (!coord) return;
    let cancelled = false;
    setLoadingPark(true);
    setPark(null);
    // 주차장은 discover/hot 의 카테고리 시스템엔 없어서 별도 호출이 필요.
    // 임시: cafe 결과 안에 섞이는 "주차장" 카테고리가 있을 수 있음. 더 정확하게
    // 하려면 backend 에 /api/parking/nearby 같은 endpoint 가 필요한데, 일단
    // analyze 의 외부 후보(=주변 주차장)를 빌려쓴다.
    api
      .analyze({ lat: coord.lat, lng: coord.lng, radius: 1000 })
      .then((d) => {
        if (cancelled) return;
        // top_recommendation 이 가장 가까운 추천 주차장
        const tr = d.top_recommendation?.candidate;
        if (tr && tr.lat != null && tr.lng != null) {
          setPark({
            name: tr.name,
            lat: tr.lat,
            lng: tr.lng,
            distanceM: tr.walking_route_distance_m ?? tr.distance_m ?? 0,
            walkingMinutes: tr.walking_minutes,
            url: tr.url,
            category: tr.category,
            stress: "low", // 일단 가장 가까운 후보를 best로 가정
          });
        }
        setLoadingPark(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setLoadingPark(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coord]);

  // 2) 베이스캠프 좌표 기준으로 카테고리별 도보권 후보 가져오기
  useEffect(() => {
    if (!park) return;
    let cancelled = false;
    setLoadingWalk(true);
    const cats: WalkableCategory[] = ["cafe", "food", "sights"];
    Promise.all(
      cats.map((c) =>
        api
          .discoverHot({
            lat: park.lat,
            lng: park.lng,
            category: c,
            limit: 5,
          })
          .then((d) => ({ c, items: d.items || [], region: d.region }))
          .catch(() => ({ c, items: [] as HotPlaceItem[], region: null })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<WalkableCategory, HotPlaceItem[]> = {
        cafe: [],
        food: [],
        sights: [],
      };
      let regionLabel: string | null = null;
      for (const r of results) {
        next[r.c] = r.items;
        if (!regionLabel && (r as any).region) regionLabel = (r as any).region;
      }
      setByCategory(next);
      if (regionLabel) setRegion(regionLabel);
      setLoadingWalk(false);
    });
    return () => {
      cancelled = true;
    };
  }, [park?.lat, park?.lng]);

  const walkableCount = useMemo(() => {
    return (
      byCategory.cafe.length +
      byCategory.food.length +
      byCategory.sights.length
    );
  }, [byCategory]);

  return (
    <div className="basecamp-page">
      <header className="judge-page-head">
        <Link to="/" className="judge-page-back">
          ← 홈
        </Link>
        <h1 className="judge-page-title">베이스캠프 모드</h1>
      </header>
      <p className="judge-page-intro">
        차는 한 번만 대고, 나머지는 걸어서 해결. 주차하기 좋은 곳부터 정해드려요.
      </p>

      {!coord && (
        <button
          type="button"
          className="btn primary basecamp-locate"
          onClick={getLocation}
          disabled={loadingCoord}
        >
          {loadingCoord ? "현위치 확인 중…" : "📍 현위치로 시작"}
        </button>
      )}
      {err && <div className="battle-err">{err}</div>}

      {coord && loadingPark && !park && (
        <div className="judge-loading">⏳ 베이스캠프 찾는 중…</div>
      )}

      {coord && !loadingPark && !park && (
        <div className="walkable-empty">
          주변에서 적당한 주차장을 찾지 못했어요. 다른 지역에서 시도해보세요.
        </div>
      )}

      {park && (
        <>
          <ParkingBasecampCard park={park} walkableCount={walkableCount} />
          <WalkablePlaceCluster
            byCategory={byCategory}
            loading={loadingWalk}
          />
          {!loadingWalk && walkableCount > 0 && (
            <BasecampRouteSuggestion byCategory={byCategory} />
          )}
          {!loadingWalk && walkableCount > 0 && (
            <BasecampShareCard
              park={park}
              regionLabel={region}
              walkableCount={walkableCount}
            />
          )}
        </>
      )}
    </div>
  );
}
