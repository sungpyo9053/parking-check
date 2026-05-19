// 분석 화면에서 사용하는 표현/문구 헬퍼.
// "내부 용어 → 사용자 문구" 변환과 verdict 문구 빌드를 한곳에 모은다.
import type {
  AnalyzeResponse,
  ExternalCandidate,
  UsabilityStatus,
  Verdict,
} from "../types/parking";

export type StressLevel = "low" | "medium" | "high";

export type VerdictInfo = {
  kind: Verdict;
  /** 상태별 한 줄 결론 (큰 글씨) */
  title: string;
  /** 부연 한 줄 (작은 글씨) */
  detail: string;
  hint: string | null;
  /** 신뢰도 — UI 선형 bar 에 사용. confidence 점수 기반 매핑. */
  confidence: StressLevel;
  /** 주차 스트레스 지수 (0~100, 높을수록 어려움). */
  stress: { score: number; level: StressLevel; cue: string | null };
};

/** confidence 점수(0~) 를 사용자 신뢰도(low/med/high) 로 매핑. */
function _confidenceLevel(score: number | null | undefined): StressLevel {
  const s = score ?? 0;
  if (s >= 70) return "high";
  if (s >= 35) return "medium";
  return "low";
}

/** "주차 스트레스 지수" 산정 (0~100, 높을수록 어려움).
 *  - 자체 주차 가능/불가 비중이 가장 큼
 *  - 추천 주차장 도보 거리, 후보 수 보조
 *  - 임의 점수가 아니라 데이터 기반이지만, "정확한 측정"이 아닌 "체감 가이드".
 */
function _computeStress(data: AnalyzeResponse): {
  score: number;
  level: StressLevel;
  cue: string | null;
} {
  const sp = data.self_parking;
  const tr = data.top_recommendation;
  const trc = tr?.candidate;
  const usableCount =
    data.candidates.length +
    (data.external_candidates || []).filter((e) => e.usability === "usable")
      .length;

  let s = 50; // 출발점 = 보통

  // 자체주차 영향 (가장 큰 비중)
  if (sp.status === "available") s -= 35;
  else if (sp.status === "likely") s -= 25;
  else if (sp.status === "uncertain") s += 0;
  else if (sp.status === "unavailable") s += 20;
  else s += 10; // unknown

  // 추천 주차장 도보 시간
  if (trc) {
    const w = trc.walking_minutes ?? 99;
    if (w <= 3) s -= 10;
    else if (w <= 5) s -= 5;
    else if (w <= 10) s += 0;
    else s += 10;
  } else {
    s += 15;
  }

  // 추천 가능 후보 개수
  if (usableCount >= 3) s -= 5;
  else if (usableCount === 0) s += 5;

  const score = Math.max(0, Math.min(100, Math.round(s)));
  const level: StressLevel = score >= 61 ? "high" : score >= 31 ? "medium" : "low";

  let cue: string | null = null;
  if (score >= 80) cue = "초보 운전자에게 매우 어려움";
  else if (score >= 65) cue = "초보 운전자면 비추천";
  else if (score <= 20) cue = "차 가져가도 부담 없음";
  else if (score <= 35) cue = "차 가져가도 괜찮음";

  return { score, level, cue };
}

/** "차 가져가도 될까?" 최종 판단 — 단정 표현 없이 가능성/확인필요 톤.
 *  copy/색/아이콘은 self_parking.status 5단계와 1:1 매핑 (UI 가이드 스펙).
 */
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
  const conf = _confidenceLevel(sp.confidence);
  const stress = _computeStress(data);

  // 1. available — 차 가져가도 OK
  if (sp.status === "available") {
    return {
      kind: "good",
      title: "차 가져가도 괜찮아 보여요",
      detail: "자체주차 가능성이 높습니다",
      hint:
        excludedCount > 0
          ? `근처 타 매장 전용 주차장 ${excludedCount}곳은 추천에서 제외했습니다.`
          : null,
      confidence: conf === "low" ? "medium" : conf,
      stress,
    };
  }

  // 2. likely — 가능성 있음 (한번 확인 권장)
  if (sp.status === "likely") {
    return {
      kind: "good",
      title: "주차 가능성이 있어요",
      detail: "방문 전 한 번만 확인하세요",
      hint:
        excludedCount > 0
          ? `타 매장 전용 주차장 ${excludedCount}곳은 추천에서 제외했습니다.`
          : null,
      confidence: conf,
      stress,
    };
  }

  // 3. unavailable — 자체주차 X
  if (sp.status === "unavailable") {
    if (trc && trWalkMin != null && trWalkMin <= 7) {
      return {
        kind: "caution",
        title: "확인이 필요해요",
        detail: `자체주차는 어렵지만 도보 약 ${trWalkMin}분 거리의 추천 주차장이 있어요`,
        hint:
          cautionCount > 0
            ? `추가 확인이 필요한 후보 ${cautionCount}곳도 함께 표시했습니다.`
            : null,
        confidence: conf,
        stress,
      };
    }
    return {
      kind: "bad",
      title: "차 없이 가는 게 나아요",
      detail: "자체주차 가능성이 낮습니다",
      hint: trc ? null : "대중교통/택시 이용을 고려해 보세요.",
      confidence: conf,
      stress,
    };
  }

  // 4. uncertain — 정보 엇갈림
  if (sp.status === "uncertain") {
    return {
      kind: "caution",
      title: "확인이 필요해요",
      detail: "주차 정보가 엇갈리거나 근거가 부족합니다",
      hint:
        trc && trWalkMin != null
          ? `근처 추천 주차장까지 도보 약 ${trWalkMin}분`
          : null,
      confidence: conf,
      stress,
    };
  }

  // 5. unknown — 판단 보류
  return {
    kind: "unknown",
    title: "아직 판단하기 어려워요",
    detail: "주차 근거가 부족해서 카카오맵 확인이 필요합니다",
    hint:
      usableCount > 0 || trc
        ? `참고 후보 ${usableCount + (trc ? 1 : 0)}곳을 아래에서 확인하세요.`
        : null,
    confidence: "low",
    stress,
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
