// 도메인 타입 재노출 — 외부에서는 lib/api 가 아닌 이 모듈을 import 하도록.
// (lib/api 는 fetch wrapper, 도메인 타입은 의미상 별도 layer)
export type {
  AnalyzeResponse,
  Candidate,
  ExternalCandidate,
  SelfParking,
  SelfParkingEvidence,
  SelfParkingFeedbackStats,
  SelfParkingStatus,
  TopRecommendation,
  RealtimeBlock,
} from "../lib/api";

export type Verdict = "good" | "caution" | "bad" | "unknown";

export type UsabilityStatus = "usable" | "caution" | "private_restricted";
