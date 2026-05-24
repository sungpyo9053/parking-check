import type { AnalyzeResponse } from "../types/parking";

export type VisitRecommendation =
  | "recommended"
  | "conditional"
  | "not_recommended"
  | "unknown";
export type Difficulty = "easy" | "normal" | "hard" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low";
export type Tone = "good" | "warn" | "unknown";

export type ScorePart = {
  key: string;
  label: string;
  value: number;
  max: number;
};
export type ReasonRow = {
  key: string;
  label: string;
  tone: Tone;
};
export type RecommendedAction = {
  id: string;
  label: string;
  sub: string;
  icon: string;
};

export type ParkingResult = {
  placeName: string;
  /** 0~100 — 주차 가능성 종합 점수. 실시간 보장이 아닌 참고 지표. */
  score: number;
  scoreBreakdown: ScorePart[];
  visitRecommendation: VisitRecommendation;
  visitRecommendationLabel: string;
  difficulty: Difficulty;
  difficultyLabel: string;
  summary: string;
  hasDedicatedParking: "yes" | "no" | "unknown";
  hasDedicatedParkingLabel: string;
  nearbyParkingAvailable: boolean;
  nearbyParkingCount: number;
  confidenceLevel: ConfidenceLevel;
  confidenceLabel: string;
  reasons: ReasonRow[];
  cautions: string[];
  recommendedActions: RecommendedAction[];
};

const VISIT_LABEL: Record<VisitRecommendation, string> = {
  recommended: "차량 방문 추천",
  conditional: "조건부 추천",
  not_recommended: "차량 비추천",
  unknown: "방문 전 확인 필요",
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
  unknown: "정보 부족",
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

function selfParkingDedicated(status: string): { v: "yes" | "no" | "unknown"; label: string } {
  if (status === "available" || status === "likely")
    return { v: "yes", label: "있음" };
  if (status === "unavailable") return { v: "no", label: "없음" };
  if (status === "uncertain") return { v: "unknown", label: "엇갈림" };
  return { v: "unknown", label: "확인되지 않음" };
}

/** 100점 만점 점수 + 항목별 breakdown.
 *  실시간 가능 대수가 아닌, 방문 전 참고용 지표. */
function computeScore(data: AnalyzeResponse): { score: number; parts: ScorePart[] } {
  const sp = data.self_parking.status;
  const ext = data.external_candidates || [];
  const dbCount = data.candidates?.length ?? 0;
  const tr = data.top_recommendation;

  // 1) 전용 주차장 여부 (max 30)
  let selfScore = 0;
  if (sp === "available" || sp === "likely") selfScore = 30;
  else if (sp === "uncertain") selfScore = 14;
  else if (sp === "unavailable") selfScore = 4;
  else selfScore = 10; // unknown

  // 2) 주변 주차장 거리 — 1순위 도보 분 (max 20)
  let distScore = 0;
  const walk = tr?.candidate.walking_minutes;
  if (walk != null) {
    if (walk <= 3) distScore = 20;
    else if (walk <= 6) distScore = 16;
    else if (walk <= 10) distScore = 11;
    else if (walk <= 15) distScore = 6;
    else distScore = 2;
  } else if (dbCount > 0 || ext.length > 0) distScore = 8;
  else distScore = 0;

  // 3) 주변 주차장 개수 — usable 근거리 (max 20)
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;
  let countScore = 0;
  if (usableNear >= 3) countScore = 20;
  else if (usableNear === 2) countScore = 15;
  else if (usableNear === 1) countScore = 10;
  else if (ext.length > 0) countScore = 5;

  // 4) 장소 주변 혼잡 가능성 (max 15) — 휴리스틱
  //    카카오 후보 多 + 자체주차 X 패턴이면 혼잡 위험 ↑
  let congestionScore = 12; // 기본 보통
  if (sp === "available" || sp === "likely") congestionScore = 13;
  if (usableNear === 0 && ext.length >= 5) congestionScore = 6;
  if (usableNear === 0 && ext.length >= 3 && sp !== "available" && sp !== "likely")
    congestionScore = 8;

  // 5) 정보 신뢰도 (max 15)
  let trustScore = 0;
  if (dbCount >= 3) trustScore = 15;
  else if (dbCount >= 1) trustScore = 12;
  else if (ext.length >= 5) trustScore = 9;
  else if (ext.length >= 1) trustScore = 6;
  else trustScore = 2;

  const parts: ScorePart[] = [
    { key: "self", label: "전용 주차장", value: selfScore, max: 30 },
    { key: "distance", label: "근처 주차장 거리", value: distScore, max: 20 },
    { key: "count", label: "근처 주차장 개수", value: countScore, max: 20 },
    { key: "congestion", label: "주변 혼잡 가능성", value: congestionScore, max: 15 },
    { key: "trust", label: "정보 신뢰도", value: trustScore, max: 15 },
  ];
  const score = parts.reduce((a, p) => a + p.value, 0);
  return { score, parts };
}

function decideVisit(score: number): VisitRecommendation {
  if (score >= 75) return "recommended";
  if (score >= 50) return "conditional";
  if (score >= 30) return "not_recommended";
  return "unknown";
}

function decideDifficulty(score: number, hasDataAtAll: boolean): Difficulty {
  if (!hasDataAtAll) return "unknown";
  if (score >= 75) return "easy";
  if (score >= 50) return "normal";
  if (score >= 30) return "hard";
  return "unknown";
}

function decideConfidence(parts: ScorePart[]): ConfidenceLevel {
  const trust = parts.find((p) => p.key === "trust")?.value ?? 0;
  if (trust >= 12) return "high";
  if (trust >= 6) return "medium";
  return "low";
}

function buildReasons(
  data: AnalyzeResponse,
  visit: VisitRecommendation,
  parts: ScorePart[],
): ReasonRow[] {
  const sp = data.self_parking.status;
  const ext = data.external_candidates || [];
  const dbCount = data.candidates?.length ?? 0;
  const tr = data.top_recommendation;
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;
  const congestion = parts.find((p) => p.key === "congestion")?.value ?? 0;
  const walk = tr?.candidate.walking_minutes;

  const rows: ReasonRow[] = [];

  // 1. 전용 주차장 정보
  if (sp === "available" || sp === "likely")
    rows.push({ key: "전용 주차장", label: "자체 주차 가능성 확인됨", tone: "good" });
  else if (sp === "unavailable")
    rows.push({ key: "전용 주차장", label: "자체 주차 어려움 (블로그/리뷰 다수)", tone: "warn" });
  else if (sp === "uncertain")
    rows.push({ key: "전용 주차장", label: "리뷰가 엇갈려 단정 어려움", tone: "warn" });
  else
    rows.push({ key: "전용 주차장", label: "정보 없음 — 매장 문의 권장", tone: "unknown" });

  // 2. 주변 주차장 접근성
  if (usableNear >= 2)
    rows.push({ key: "주변 접근성", label: `근거리 일반 개방 ${usableNear}곳`, tone: "good" });
  else if (usableNear === 1)
    rows.push({ key: "주변 접근성", label: "근거리 일반 개방 1곳 — 만차 대비 필요", tone: "warn" });
  else if (ext.length > 0)
    rows.push({ key: "주변 접근성", label: "회사/빌딩 주차장 위주 — 출입 가능 여부 확인", tone: "warn" });
  else
    rows.push({ key: "주변 접근성", label: "근거리 주차장 정보 부족", tone: "unknown" });

  // 3. 도보 이동 가능성
  if (walk != null) {
    if (walk <= 5)
      rows.push({ key: "도보 가능성", label: `1순위까지 도보 ${walk}분 — 무난`, tone: "good" });
    else if (walk <= 10)
      rows.push({ key: "도보 가능성", label: `1순위까지 도보 ${walk}분 — 가벼운 거리`, tone: "warn" });
    else
      rows.push({ key: "도보 가능성", label: `1순위까지 도보 ${walk}분 — 좀 멀음`, tone: "warn" });
  } else {
    rows.push({ key: "도보 가능성", label: "추천 주차장 미선정", tone: "unknown" });
  }

  // 4. 주변 혼잡 가능성
  if (congestion >= 12)
    rows.push({ key: "주변 혼잡 가능성", label: "특별한 혼잡 신호 없음", tone: "good" });
  else if (congestion >= 8)
    rows.push({ key: "주변 혼잡 가능성", label: "시간대에 따라 자리 변동 가능", tone: "warn" });
  else
    rows.push({ key: "주변 혼잡 가능성", label: "혼잡 위험 — 시간대 신중 선택", tone: "warn" });

  // 5. 정보 신뢰도
  if (dbCount >= 3)
    rows.push({ key: "정보 신뢰도", label: `공공데이터 ${dbCount}건 + 카카오·웹 ${ext.length}건`, tone: "good" });
  else if (dbCount > 0)
    rows.push({ key: "정보 신뢰도", label: `공공데이터 ${dbCount}건 + 보조 ${ext.length}건`, tone: "good" });
  else if (ext.length >= 5)
    rows.push({ key: "정보 신뢰도", label: `카카오·웹 ${ext.length}건 (공공데이터 없음)`, tone: "warn" });
  else if (ext.length > 0)
    rows.push({ key: "정보 신뢰도", label: `보조 데이터 ${ext.length}건 — 표본 적음`, tone: "warn" });
  else
    rows.push({ key: "정보 신뢰도", label: "참고 데이터 부족", tone: "unknown" });

  // 6. 방문 전 확인 필요 여부
  if (visit === "recommended" && (sp === "available" || sp === "likely"))
    rows.push({ key: "방문 전 확인", label: "매장 자체 주차 운영 시간만 한 번 확인", tone: "good" });
  else if (visit === "recommended")
    rows.push({ key: "방문 전 확인", label: "추천 주차장 운영 시간 확인 권장", tone: "good" });
  else if (visit === "conditional")
    rows.push({ key: "방문 전 확인", label: "현장 만차/요금 변동 가능 — 출발 전 확인", tone: "warn" });
  else if (visit === "not_recommended")
    rows.push({ key: "방문 전 확인", label: "대중교통 경로 미리 확인", tone: "warn" });
  else
    rows.push({ key: "방문 전 확인", label: "카카오맵에서 추가 확인 필수", tone: "unknown" });

  return rows;
}

function buildSummary(
  placeName: string,
  visit: VisitRecommendation,
  data: AnalyzeResponse,
): string {
  const sp = data.self_parking.status;
  const ext = data.external_candidates || [];
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;
  const tr = data.top_recommendation;
  const walk = tr?.candidate.walking_minutes;
  const place = placeName || data.destination.name || "이 장소";

  if (visit === "recommended") {
    if (sp === "available" || sp === "likely")
      return `${place}은(는) 자체 주차장 이용이 가능할 가능성이 높습니다. 방문 전 매장에 한 번 확인하면 더 안전합니다.`;
    return `${place} 주변에 일반 개방 주차장이 충분히 있어 차량 방문이 가능합니다. 방문 시간대에 따라 자리 변동 가능.`;
  }
  if (visit === "conditional") {
    if (walk != null)
      return `${place}은(는) 차량 방문이 가능할 수 있지만, 방문 시간대에 따라 주차 난이도가 달라질 수 있어 도보 약 ${walk}분 거리의 근처 주차장을 함께 확인하는 것이 좋습니다.`;
    return `${place}은(는) 주차 정보가 명확하지 않아 차량 방문 전 주변 주차장을 먼저 확인하는 것을 추천합니다.`;
  }
  if (visit === "not_recommended") {
    return `${place}은(는) 자체 주차가 어렵고 주변 일반 개방 주차장도 부족합니다. 대중교통 또는 택시 이용을 추천합니다.`;
  }
  if (usableNear > 0)
    return `${place}은(는) 자체 주차 정보는 확인되지 않지만 주변에 일반 개방 주차장 ${usableNear}곳이 있어 차량 방문은 가능합니다. 방문 전 한 번 더 확인해 주세요.`;
  return `${place}은(는) 현재 데이터로는 주차 가능성을 단정하기 어렵습니다. 방문 전 카카오맵·매장 문의를 함께 확인해 주세요.`;
}

function buildActions(visit: VisitRecommendation, usableNear: number): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  if (visit === "conditional" || (visit === "unknown" && usableNear > 0)) {
    actions.push({
      id: "check_nearby",
      icon: "🅿️",
      label: "근처 주차장 먼저 확인",
      sub: "후보 리스트에서 거리·요금 비교",
    });
  } else if (visit === "recommended") {
    actions.push({
      id: "set_nearby",
      icon: "🅿️",
      label: "근처 주차장을 목적지로",
      sub: "추천 주차장으로 길찾기 시작",
    });
  }

  if (visit === "not_recommended") {
    actions.push({
      id: "public_transport",
      icon: "🚇",
      label: "대중교통 또는 택시",
      sub: "카카오맵 길찾기로 빠르게 비교",
    });
  } else if (visit === "unknown") {
    actions.push({
      id: "verify",
      icon: "🗺️",
      label: "지도 앱에서 한 번 더 확인",
      sub: "매장 안내·카카오맵 주차 정보 확인",
    });
  }

  actions.push({
    id: "search_other",
    icon: "🔎",
    label: "다른 장소 검색",
    sub: "비슷한 장소도 함께 비교",
  });
  actions.push({
    id: "share",
    icon: "📤",
    label: "결과 공유",
    sub: "동승자에게 한 번에 전달",
  });
  return actions;
}

export function buildParkingResult(
  data: AnalyzeResponse,
  placeName: string,
): ParkingResult {
  const { score, parts } = computeScore(data);
  const ext = data.external_candidates || [];
  const dbCount = data.candidates?.length ?? 0;
  const hasDataAtAll = dbCount + ext.length > 0;
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;

  const visit = decideVisit(score);
  const difficulty = decideDifficulty(score, hasDataAtAll);
  const confidence = decideConfidence(parts);
  const sp = selfParkingDedicated(data.self_parking.status);
  const place = placeName || data.destination.name || "분석 결과";
  const summary = buildSummary(place, visit, data);
  const reasons = buildReasons(data, visit, parts);
  const actions = buildActions(visit, usableNear);

  const cautions = [
    "방문 전 참고용 정보입니다.",
    "실시간 주차 가능 대수, 요금, 운영 여부는 실제 현장 상황과 다를 수 있습니다.",
    "정확한 주차 가능 여부는 방문 전 지도 앱, 주차장 운영 정보, 매장 안내를 함께 확인해 주세요.",
  ];

  return {
    placeName: place,
    score,
    scoreBreakdown: parts,
    visitRecommendation: visit,
    visitRecommendationLabel: VISIT_LABEL[visit],
    difficulty,
    difficultyLabel: DIFFICULTY_LABEL[difficulty],
    summary,
    hasDedicatedParking: sp.v,
    hasDedicatedParkingLabel: sp.label,
    nearbyParkingAvailable: usableNear > 0,
    nearbyParkingCount: usableNear,
    confidenceLevel: confidence,
    confidenceLabel: CONFIDENCE_LABEL[confidence],
    reasons,
    cautions,
    recommendedActions: actions,
  };
}
