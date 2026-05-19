// 결과 페이지의 "재미 카드" 4종 (car compat / hell level / scenario / punchline) 공통 유틸.
// 모두 frontend fallback 으로 동작. 백엔드 응답이 부족해도 빌드/UX 깨지지 않게 보수적.

import type { AnalyzeResponse } from "../types/parking";
import type { VerdictInfo } from "./parkingPresentation";

// ============================================================
// 차 타입 / 운전 성향 (localStorage 영구 저장)
// ============================================================

export type CarType = "compact" | "midsize" | "suv" | "large_suv";
export type DriveStyle = "novice" | "confident";

export const CAR_LABEL: Record<CarType, string> = {
  compact: "경차",
  midsize: "준중형",
  suv: "SUV",
  large_suv: "대형 SUV",
};

export const DRIVE_LABEL: Record<DriveStyle, string> = {
  novice: "초보 운전자",
  confident: "운전 자신 있음",
};

const CAR_KEY = "pk_car_type";
const DRIVE_KEY = "pk_drive_style";

export function loadCarPref(): {
  car: CarType | null;
  drive: DriveStyle | null;
} {
  try {
    const c = localStorage.getItem(CAR_KEY) as CarType | null;
    const d = localStorage.getItem(DRIVE_KEY) as DriveStyle | null;
    return { car: c || null, drive: d || null };
  } catch {
    return { car: null, drive: null };
  }
}

export function saveCarPref(car: CarType | null, drive: DriveStyle | null) {
  try {
    if (car) localStorage.setItem(CAR_KEY, car);
    else localStorage.removeItem(CAR_KEY);
    if (drive) localStorage.setItem(DRIVE_KEY, drive);
    else localStorage.removeItem(DRIVE_KEY);
  } catch {
    /* ignore */
  }
}

// ============================================================
// 1) 내 차 궁합 점수 (0~100, 높을수록 좋음)
// ============================================================

export type CompatLevel = "good" | "okay" | "warn" | "bad";

export type CarCompat = {
  score: number;
  level: CompatLevel;
  /** 한 줄 결론 */
  label: string;
  /** 부연 */
  hint: string;
};

export function computeCarCompat(
  data: AnalyzeResponse,
  verdict: VerdictInfo,
  car: CarType | null,
  drive: DriveStyle | null,
): CarCompat | null {
  if (!car && !drive) return null;
  const sp = data.self_parking;
  const tr = data.top_recommendation?.candidate;
  const walk = tr?.walking_minutes ?? null;
  const usableCount =
    data.candidates.length +
    (data.external_candidates || []).filter((e) => e.usability === "usable")
      .length;

  // 기본 출발점 — verdict 와 stress 를 반영
  // stress 가 높을수록 궁합 점수 낮아짐. 50 - stress*0.4 ≈ 50 - 30
  let s = 80 - Math.round(verdict.stress.score * 0.45);

  // 자체주차 가능성에 비례 가산
  if (sp.status === "available") s += 12;
  else if (sp.status === "likely") s += 6;
  else if (sp.status === "unavailable") s -= 8;
  else if (sp.status === "unknown") s -= 4;

  // 차 타입 영향
  if (car === "compact") s += 6;
  if (car === "suv") s -= 4;
  if (car === "large_suv") s -= 12;

  // SUV 류는 자체주차 없으면 더 페널티 (큰 차 노상/공영 진입 부담)
  if ((car === "suv" || car === "large_suv") && !["available", "likely"].includes(sp.status)) {
    s -= 6;
  }

  // 초보 운전자: stress 와 도보 영향 가중
  if (drive === "novice") {
    s -= Math.min(15, Math.round(verdict.stress.score * 0.15));
    if (walk != null && walk >= 7) s -= 6;
  }
  if (drive === "confident") s += 4;

  // 대체 주차장 수 → 후보 많을수록 안심
  if (usableCount >= 3) s += 4;
  if (usableCount === 0) s -= 6;

  // clamp
  s = Math.max(0, Math.min(100, s));

  const level: CompatLevel =
    s >= 75 ? "good" : s >= 55 ? "okay" : s >= 35 ? "warn" : "bad";

  const carLabel = car ? CAR_LABEL[car] : null;
  const driveLabel = drive ? DRIVE_LABEL[drive] : null;

  let label: string;
  let hint: string;
  if (level === "good") {
    label = "잘 어울려요";
    hint = carLabel
      ? `${carLabel}로 부담 없이 도전 가능합니다.`
      : "운전 부담은 낮을 거예요.";
  } else if (level === "okay") {
    label = "도전 가능";
    hint = driveLabel === "초보 운전자"
      ? "초보 운전자라면 한 번 더 확인이 좋아요."
      : `${carLabel ?? "현재 설정"} 기준 무난한 편입니다.`;
  } else if (level === "warn") {
    label = "주의가 필요해요";
    hint = (car === "suv" || car === "large_suv")
      ? `${carLabel} 기준 자체주차가 없고 진입이 좁을 수 있어요.`
      : "주차에 시간이 더 들 가능성이 있어요.";
  } else {
    label = drive === "novice" ? "초보 운전자라면 비추천" : "이 차로는 부담돼요";
    hint = (car === "large_suv")
      ? "대형 SUV 기준 노상/공영 진입과 출차가 매우 까다로울 수 있어요."
      : "주차로 시간을 많이 쓸 가능성이 있어요. 대체 장소를 고려해보세요.";
  }

  return { score: s, level, label, hint };
}

// ============================================================
// 2) 주차 헬 난이도 (Hell Level)
// ============================================================

export type HellLevel = "mild" | "regular" | "spicy" | "hell";

export type HellInfo = {
  level: HellLevel;
  /** 등급명 — "순한맛" / "보통맛" / "매운맛" / "지옥맛" */
  label: string;
  /** 결과 문구 (큰 카드 본문) */
  copy: string;
  /** 별 점수 (1~4) — 게임성 UI 용 */
  stars: number;
};

export function buildHellLevel(verdict: VerdictInfo): HellInfo {
  const s = verdict.stress.score;
  if (s <= 25) {
    return {
      level: "mild",
      label: "순한맛",
      copy: "차 가져가도 무난해요",
      stars: 1,
    };
  }
  if (s <= 50) {
    return {
      level: "regular",
      label: "보통맛",
      copy: "방문 전 확인하면 좋아요",
      stars: 2,
    };
  }
  if (s <= 75) {
    return {
      level: "spicy",
      label: "매운맛",
      copy: "도착해서 한 바퀴 돌 가능성이 있어요",
      stars: 3,
    };
  }
  return {
    level: "hell",
    label: "지옥맛",
    copy: "초행길이면 차 두고 가는 게 나아요",
    stars: 4,
  };
}

// ============================================================
// 3) 차 가져가면 예상 시나리오 (3~5 단계 타임라인)
// ============================================================

export type ScenarioStep = {
  emoji: string;
  title: string;
  note: string | null;
  tone: "good" | "neutral" | "warn" | "bad";
};

export function buildScenario(
  data: AnalyzeResponse,
  verdict: VerdictInfo,
): ScenarioStep[] {
  const sp = data.self_parking;
  const tr = data.top_recommendation?.candidate;
  const walk = tr?.walking_minutes ?? null;
  const isSelf = sp.status === "available" || sp.status === "likely";

  // 긍정 시나리오 (자체주차 OK)
  if (isSelf) {
    return [
      { emoji: "🚗", title: "매장 앞 도착", note: null, tone: "neutral" },
      {
        emoji: "🅿️",
        title: "매장 자체 주차장 이용",
        note: sp.label || "자체 주차 가능",
        tone: "good",
      },
      {
        emoji: "✅",
        title: "주차 완료 후 매장 입장",
        note: "바로 약속 시작",
        tone: "good",
      },
    ];
  }

  // 중간 시나리오 — 1순위 추천 도보 5분 이내
  if (tr && walk != null && walk <= 5) {
    return [
      { emoji: "🚗", title: "매장 앞 도착", note: null, tone: "neutral" },
      {
        emoji: "❌",
        title: "자체주차 어려움",
        note: sp.label || "현장 확인 필요",
        tone: "warn",
      },
      {
        emoji: "🅿️",
        title: `근처 ${tr.name} 이동`,
        note: `도보 약 ${walk}분`,
        tone: "neutral",
      },
      {
        emoji: "🚶",
        title: "도보로 매장 복귀",
        note: "여유 시간 권장",
        tone: "neutral",
      },
    ];
  }

  // 리스크 시나리오 — 추천 멀거나 없음
  const steps: ScenarioStep[] = [
    { emoji: "🚗", title: "매장 앞 도착", note: null, tone: "neutral" },
    {
      emoji: "❓",
      title: "자체주차 정보 부족",
      note: verdict.detail,
      tone: "warn",
    },
  ];
  if (tr && walk != null) {
    steps.push({
      emoji: "🅿️",
      title: `근처 ${tr.name} 검색`,
      note: `도보 약 ${walk}분`,
      tone: walk >= 8 ? "bad" : "warn",
    });
    if (walk >= 7) {
      steps.push({
        emoji: "⏱️",
        title: "약속 시간 지연 가능",
        note: "여유 있게 출발하세요",
        tone: "bad",
      });
    }
  } else {
    steps.push({
      emoji: "🔍",
      title: "주차장 현장 검색 필요",
      note: "대중교통 고려 권장",
      tone: "bad",
    });
  }
  return steps;
}

// ============================================================
// 4) 공유용 한 줄 밈 (Punchline)
// ============================================================

export function buildPunchline(
  verdict: VerdictInfo,
  car: CarType | null,
  drive: DriveStyle | null,
): string {
  const s = verdict.stress.level;
  const k = verdict.kind;

  // 자체주차 + 자신있음
  if (k === "good" && s === "low") {
    if (drive === "confident") return "오늘은 차로 가도 멘탈 무사 ✌️";
    return "차는 가능, 운전도 가뿐";
  }
  if (k === "good") return "근처 주차장이 살렸다 🙌";

  // 매운맛/지옥맛
  if (s === "high") {
    if (drive === "novice") return "초보 운전자는 오늘 쉬자";
    if (car === "large_suv") return "대형 SUV는 신중히… 🅿️";
    return "주차 지옥 입구입니다";
  }

  // caution / uncertain
  if (k === "caution") return "차는 가능, 멘탈은 선택";
  if (k === "bad") return "오늘은 택시가 정답";
  return "차 가져갈지 동전 던지기 🪙";
}
