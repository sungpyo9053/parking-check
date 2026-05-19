// 베이스캠프 모드 — 주차장 우선 → 그 주변에서 놀기.
// 도보권 카페/맛집/관광지 클러스터링.

import type { HotPlaceItem } from "../lib/api";

export type WalkableCategory = "cafe" | "food" | "sights";

export const CATEGORY_LABEL: Record<WalkableCategory, string> = {
  cafe: "카페",
  food: "맛집",
  sights: "가볼곳",
};

export const CATEGORY_EMOJI: Record<WalkableCategory, string> = {
  cafe: "☕",
  food: "🍽",
  sights: "📍",
};

export type BasecampPark = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  walkingMinutes: number | null;
  url: string | null;
  category: string | null;
  /** stress 추정 (낮을수록 좋음). 베이스캠프는 stress 낮은 곳이 좋음. */
  stress: "low" | "medium" | "high";
};

/** Hot place item 1건이 주차장 후보로 적합한지 (베이스캠프 후보). */
export function asPark(it: HotPlaceItem): BasecampPark | null {
  const cat = (it.category || "").toLowerCase();
  if (!cat.includes("주차")) return null;
  const cong = it.congestion?.level ?? "medium";
  return {
    name: it.name,
    lat: it.lat,
    lng: it.lng,
    distanceM: it.distance_m,
    walkingMinutes: it.walking_minutes,
    url: it.place_url,
    category: it.category,
    stress: cong === "low" ? "low" : cong === "high" ? "high" : "medium",
  };
}

/** 베이스캠프 카드용 한 줄 카피. */
export function basecampCaption(p: BasecampPark, walkableCount: number): string {
  if (walkableCount >= 8) return "여기 차 대고 동네 놀이 가능";
  if (walkableCount >= 4) return "오늘은 차 여기 대세요";
  if (walkableCount >= 2) return "주변에 갈만한 곳 몇 개 있어요";
  return "일단 차 대기엔 무난";
}

/** 추천 동선 (mock): 카페 → 맛집 → 산책 */
export type RouteStop = {
  emoji: string;
  label: string;
  name: string;
  walkingMinutes: number | null;
};

export function buildSuggestedRoute(
  byCategory: Record<WalkableCategory, HotPlaceItem[]>,
): RouteStop[] {
  const stops: RouteStop[] = [];
  const cafe = byCategory.cafe?.[0];
  const food = byCategory.food?.[0];
  const sights = byCategory.sights?.[0];

  stops.push({ emoji: "🅿️", label: "주차", name: "베이스캠프 도착", walkingMinutes: null });
  if (cafe)
    stops.push({
      emoji: "☕",
      label: "오전",
      name: cafe.name,
      walkingMinutes: cafe.walking_minutes,
    });
  if (food)
    stops.push({
      emoji: "🍽",
      label: "점심",
      name: food.name,
      walkingMinutes: food.walking_minutes,
    });
  if (sights)
    stops.push({
      emoji: "📍",
      label: "산책/구경",
      name: sights.name,
      walkingMinutes: sights.walking_minutes,
    });
  return stops;
}

/** 베이스캠프 공유 펀치라인. */
export function basecampPunchline(regionLabel: string | null): string {
  if (!regionLabel) return "차는 한 번만 대고 나머지는 걸어서 해결";
  return `${regionLabel}는 여기 차 대고 움직이면 편해요`;
}
