// 분석 화면에서 사용하는 표현/문구 헬퍼.
// "내부 용어 → 사용자 문구" 변환과 verdict 문구 빌드를 한곳에 모은다.
import type {
  AnalyzeResponse,
  ExternalCandidate,
  UsabilityStatus,
  Verdict,
} from "../types/parking";

export type VerdictInfo = {
  kind: Verdict;
  title: string;
  detail: string;
  hint: string | null;
};

/** "차 가져가도 될까?" 최종 판단 — 단정 표현 없이 가능성/확인필요 톤. */
export function buildVerdict(data: AnalyzeResponse): VerdictInfo {
  const sp = data.self_parking;
  const tr = data.top_recommendation;
  const trc = tr?.candidate;
  const usableCount =
    data.candidates.length +
    (data.external_candidates || []).filter((e) => e.usability === "usable")
      .length;
  const cautionCount = (data.external_candidates || []).filter(
    (e) => e.usability === "caution",
  ).length;
  const excludedCount = data.fallback?.excluded_items?.length ?? 0;
  const trWalkMin = trc?.walking_minutes ?? null;

  if (sp.status === "available" || sp.status === "likely") {
    return {
      kind: "good",
      title: "차로 가도 될 가능성이 있습니다",
      detail:
        "목적지에 자체 주차가 가능한 것으로 보입니다. 현장에서 한 번 더 확인이 필요합니다.",
      hint:
        excludedCount > 0
          ? `근처 타 매장 전용 주차장 ${excludedCount}곳은 추천에서 제외했습니다.`
          : null,
    };
  }
  if (
    sp.status === "unavailable" &&
    trc &&
    trWalkMin != null &&
    trWalkMin <= 7
  ) {
    return {
      kind: "good",
      title: "차로 가도 될 가능성이 있습니다",
      detail: `자체 주차장은 없는 것으로 보이지만, 도보 약 ${trWalkMin}분 거리의 추천 주차장이 있습니다.`,
      hint:
        excludedCount > 0
          ? `타 매장 전용 주차장 ${excludedCount}곳은 추천에서 제외했습니다.`
          : null,
    };
  }
  if (sp.status === "unavailable") {
    if (trc) {
      return {
        kind: "caution",
        title: "주차 후 좀 걸어야 할 수 있습니다",
        detail: `자체 주차장은 없는 것으로 보입니다. 가까운 추천 주차장까지 도보 약 ${trWalkMin ?? "?"}분.`,
        hint:
          cautionCount > 0
            ? `추가 확인이 필요한 후보 ${cautionCount}곳도 함께 표시했습니다.`
            : null,
      };
    }
    return {
      kind: "bad",
      title: "차로 가는 것은 권장하지 않습니다",
      detail:
        "자체 주차장이 없는 것으로 보이고, 가까운 공용 주차장도 찾지 못했습니다.",
      hint: "대중교통/택시 이용을 고려해 보세요.",
    };
  }
  if (sp.status === "uncertain" && trc && trWalkMin != null && trWalkMin <= 7) {
    return {
      kind: "good",
      title: "차로 가도 될 가능성이 있습니다",
      detail: `자체 주차는 확인이 필요하지만, 도보 약 ${trWalkMin}분 거리의 추천 주차장이 있습니다.`,
      hint: null,
    };
  }
  if (sp.status === "uncertain") {
    if (trc) {
      return {
        kind: "caution",
        title: "확인이 필요합니다",
        detail: `목적지 자체 주차는 매장 확인이 필요합니다. 추천 주차장까지 도보 약 ${trWalkMin ?? "?"}분.`,
        hint: null,
      };
    }
    return {
      kind: "caution",
      title: "확인이 필요합니다",
      detail:
        "자체 주차 여부를 확실히 판단하기 어렵습니다. 매장에 문의하거나 현장에서 확인하세요.",
      hint: null,
    };
  }
  if (usableCount === 0 && cautionCount === 0 && !trc) {
    return {
      kind: "unknown",
      title: "정보가 부족합니다",
      detail:
        "이 위치 주변의 주차장 정보를 충분히 찾지 못했습니다. 현장 확인이 필요합니다.",
      hint: null,
    };
  }
  return {
    kind: "unknown",
    title: "정보가 부족합니다",
    detail: trc
      ? `자체 주차 정보를 확인할 수 없습니다. 참고 후보로 도보 약 ${trWalkMin ?? "?"}분 거리의 주차장이 있습니다.`
      : "자체 주차 정보를 확인할 수 없습니다.",
    hint: null,
  };
}

export type SelfParkingCopy = {
  tag: string;
  tagKind: Verdict;
  line: string;
};

export function selfParkingCopy(data: AnalyzeResponse): SelfParkingCopy {
  const sp = data.self_parking;
  switch (sp.status) {
    case "available":
      return {
        tag: "가능성 높음",
        tagKind: "good",
        line: "매장 자체 주차 이용 가능성이 있습니다. 주차 위치는 현장에서 확인하세요.",
      };
    case "likely":
      return {
        tag: "가능성 높음",
        tagKind: "good",
        line: "후기/지도 정보 기준으로 매장 자체 주차가 가능한 것으로 보입니다. 현장 확인이 필요합니다.",
      };
    case "uncertain":
      return {
        tag: "확인 필요",
        tagKind: "caution",
        line: "매장 자체 주차 여부를 확실히 판단하기 어렵습니다. 방문 전 매장에 확인하는 것이 좋습니다.",
      };
    case "unavailable":
      return {
        tag: "가능성 낮음",
        tagKind: "bad",
        line: "후기 기준으로 매장 자체 주차는 어려운 것으로 보입니다. 아래 추천 주차장을 참고하세요.",
      };
    default:
      return {
        tag: "정보 부족",
        tagKind: "unknown",
        line: "지도/후기에서 자체 주차 정보를 찾지 못했습니다. 현장 확인이 필요합니다.",
      };
  }
}

/** 도보 거리 출처 라벨 — 실 도보 경로 / 직선거리 기준 통일. */
export function distanceSourceLabel(
  source: "osrm" | "haversine" | null | undefined,
): string {
  return source === "osrm" ? "실 도보 경로" : "직선거리 기준";
}

/** "목적지까지 도보 약 N분 · 304m (직선거리 기준)" 같은 한 줄 문구. */
export function walkLine(
  walkingMinutes: number | null | undefined,
  distanceM: number | null | undefined,
  source: "osrm" | "haversine" | null | undefined,
): string | null {
  if (walkingMinutes == null && distanceM == null) return null;
  const parts: string[] = [];
  if (walkingMinutes != null) parts.push(`도보 약 ${walkingMinutes}분`);
  if (distanceM != null)
    parts.push(`${distanceM}m (${distanceSourceLabel(source)})`);
  return parts.join(" · ");
}

/** usability → 사용자 라벨. */
export function usabilityUserLabel(u: UsabilityStatus): string {
  if (u === "usable") return "추천 가능";
  if (u === "caution") return "확인 필요";
  return "추천 제외";
}

export function usabilityTagClass(u: UsabilityStatus): string {
  if (u === "usable") return "tag tag-verdict-good";
  if (u === "caution") return "tag tag-verdict-caution";
  return "tag tag-verdict-bad";
}

/** Kakao 카테고리 → 사용자 친화 분류. */
export function kindLabel(category: string | null | undefined): string {
  const cat = category || "";
  if (cat.includes("공영")) return "공영주차장";
  if (cat.includes("노상")) return "공영(노상)주차장";
  if (cat.includes("주차")) return "민영/유료주차장";
  return "주차장";
}

/** 외부 후보 소스 → 사용자 라벨. */
export function externalSourceLabel(
  source: ExternalCandidate["source"],
): string {
  if (source === "kakao_fallback") return "지도 검색 후보";
  if (source === "web_search") return "웹 검색 후보";
  return "참고 후보";
}
