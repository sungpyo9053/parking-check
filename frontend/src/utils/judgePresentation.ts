// 약속 장소 심판 — 차량 방문 관점 랭킹.
// 후보 장소들의 analyze 결과를 받아 안전도 점수 + 이유 산정.

import type { AnalyzeResponse } from "../types/parking";
import { buildVerdict, VerdictInfo } from "./parkingPresentation";

export type JudgeEntry = {
  /** 사용자가 입력했을 때 표시한 매장명 (검색 결과의 name). */
  name: string;
  /** 분석 결과. 없으면 fallback. */
  data: AnalyzeResponse | null;
  /** 0~100, 높을수록 차량 방문 안전. */
  safety: number;
  /** 한 줄 결론. */
  badge: string;
  /** 주요 reasons (탈락 카드 용). */
  reasons: string[];
  /** verdict 캐시. */
  verdict: VerdictInfo | null;
};

const SAFETY_LABEL = (s: number) => {
  if (s >= 75) return "차 가져가기 안전";
  if (s >= 55) return "방문 가능";
  if (s >= 35) return "주의 필요";
  return "운전자 비추천";
};

export function scoreEntry(name: string, data: AnalyzeResponse | null): JudgeEntry {
  if (!data) {
    return {
      name,
      data: null,
      safety: 50,
      badge: "정보 부족",
      reasons: ["분석 결과를 받지 못했습니다."],
      verdict: null,
    };
  }
  const v = buildVerdict(data);
  const sp = data.self_parking;
  const tr = data.top_recommendation?.candidate;
  const usableCount =
    data.candidates.length +
    (data.external_candidates || []).filter((e) => e.usability === "usable")
      .length;

  // safety = 100 - stress*0.6 + bonuses
  let s = 100 - Math.round(v.stress.score * 0.6);
  if (sp.status === "available") s += 12;
  else if (sp.status === "likely") s += 8;
  else if (sp.status === "unavailable") s -= 6;
  else if (sp.status === "unknown") s -= 4;

  // 추천 도보 시간
  const walk = tr?.walking_minutes ?? null;
  if (walk != null) {
    if (walk <= 3) s += 6;
    else if (walk <= 5) s += 3;
    else if (walk >= 10) s -= 6;
    else if (walk >= 8) s -= 3;
  } else if (!tr) {
    s -= 6;
  }
  // 후보 풀
  if (usableCount >= 3) s += 4;
  if (usableCount === 0) s -= 6;

  s = Math.max(0, Math.min(100, s));

  // 이유 모음
  const reasons: string[] = [];
  if (sp.status === "available") reasons.push("자체주차 가능성 확인");
  else if (sp.status === "likely") reasons.push("자체주차 가능성 높음 (웹 근거)");
  else if (sp.status === "unavailable") reasons.push("자체주차 어려움");
  else if (sp.status === "unknown") reasons.push("자체주차 근거 부족");
  else reasons.push("자체주차 정보 엇갈림");

  if (tr && walk != null) {
    if (walk <= 5) reasons.push(`근처 추천 주차장 도보 ${walk}분`);
    else if (walk <= 10) reasons.push(`추천 주차장까지 도보 ${walk}분 (보통)`);
    else reasons.push(`추천 주차장까지 도보 ${walk}분 (긴 편)`);
  } else if (!tr) {
    reasons.push("주변 추천 주차장 없음");
  }
  if (usableCount >= 3) reasons.push(`추천 후보 ${usableCount}곳 확보`);
  else if (usableCount === 0) reasons.push("일반 개방 후보 0곳");

  return {
    name,
    data,
    safety: s,
    badge: SAFETY_LABEL(s),
    reasons,
    verdict: v,
  };
}

export function rank(entries: JudgeEntry[]): JudgeEntry[] {
  return [...entries].sort((a, b) => b.safety - a.safety);
}

/** 우승 카드 한 줄 카피. */
export function winnerCaption(top: JudgeEntry): string {
  if (top.safety >= 75) return "오늘 차 가져가는 사람 기준 우승";
  if (top.safety >= 55) return "이 중에선 가장 무난한 선택";
  return "최선이지만 모두 운전자에겐 부담";
}

/** 탈락 카드 한 줄. */
export function rejectedCaption(e: JudgeEntry): string {
  if (e.safety < 35) return "이 사람을 주차 지옥에 보내지 마세요";
  if (e.safety < 55) return "차 가져가면 고생할 가능성이 높아요";
  return "조금 더 확인이 필요한 후보";
}

/** 보호 카드 (가장 위험한 후보 강조용). */
export function protectionLines(worst: JudgeEntry): string[] {
  return worst.reasons.slice(0, 3);
}
