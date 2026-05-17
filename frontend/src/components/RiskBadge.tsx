import type { Congestion } from "../lib/api";

const LABEL: Record<Congestion, string> = {
  easy: "여유",
  moderate: "보통",
  busy: "혼잡",
  risky: "만차 위험",
  full: "만차",
  unknown: "정보 부족"
};

export default function RiskBadge({ value }: { value: Congestion }) {
  return <span className={`badge ${value}`}>{LABEL[value]}</span>;
}
