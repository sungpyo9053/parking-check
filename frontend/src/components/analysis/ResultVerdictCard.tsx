import type { AnalyzeResponse } from "../../types/parking";
import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = {
  destName: string;
  verdict: VerdictInfo;
  data: AnalyzeResponse;
};

/** "검색 결과" 톤의 상단 판정 카드.
 *  - 장소명
 *  - 차량 방문 추천 / 주차 난이도 배지
 *  - 자체 주차 여부 / 주변 대안 주차장 여부
 *  - 한 줄 결론 (자연어 문장)
 */

const DIFFICULTY_BY_KIND: Record<
  VerdictInfo["kind"],
  { label: string; tone: "good" | "caution" | "tough" | "unknown" }
> = {
  good: { label: "쉬움", tone: "good" },
  caution: { label: "보통", tone: "caution" },
  bad: { label: "어려움", tone: "tough" },
  unknown: { label: "정보 부족", tone: "unknown" },
};

const VISIT_LABEL: Record<VerdictInfo["kind"], string> = {
  good: "차량 방문 추천",
  caution: "방문 전 주차 확인 권장",
  bad: "대중교통 추천",
  unknown: "방문 전 확인 필요",
};

function selfParkingLabel(status: string): { label: string; tone: "good" | "warn" | "unknown" } {
  if (status === "available" || status === "likely")
    return { label: "있음", tone: "good" };
  if (status === "unavailable") return { label: "없음", tone: "warn" };
  if (status === "uncertain") return { label: "엇갈림", tone: "warn" };
  return { label: "확인되지 않음", tone: "unknown" };
}

function buildOneLine(verdict: VerdictInfo, data: AnalyzeResponse, destName: string): string {
  const sp = data.self_parking.status;
  const ext = data.external_candidates || [];
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;
  const tr = data.top_recommendation;
  const trWalk = tr?.candidate.walking_minutes;
  const place = destName || data.destination.name || "이 장소";

  if (verdict.kind === "good") {
    if (sp === "available" || sp === "likely")
      return `${place}은(는) 자체 주차장 이용이 가능할 가능성이 높습니다. 방문 전 매장에 한 번 확인하면 더 안전합니다.`;
    return `${place} 주변에 검증된 주차장이 있어 차량 방문이 가능합니다.`;
  }
  if (verdict.kind === "caution") {
    if (tr && trWalk != null)
      return `${place}은(는) 자체 주차 정보가 명확하지 않아 도보 약 ${trWalk}분 거리의 추천 주차장을 먼저 확인하시는 것을 권장합니다.`;
    return `${place}은(는) 주차 정보가 엇갈려 차량 방문 시 주변 주차장을 먼저 확인하는 것을 추천합니다.`;
  }
  if (verdict.kind === "bad") {
    return `${place}은(는) 자체 주차가 어렵고 주변 일반 개방 주차장도 부족합니다. 대중교통 이용을 권장합니다.`;
  }
  if (usableNear > 0)
    return `${place}은(는) 자체 주차 정보가 확인되지 않지만 주변에 일반 개방 주차장 ${usableNear}곳이 있어 차량 방문은 가능합니다.`;
  return `${place}은(는) 현재 데이터로는 주차 가능성을 단정하기 어렵습니다. 방문 전 카카오맵·매장 문의가 필요합니다.`;
}

export default function ResultVerdictCard({ destName, verdict, data }: Props) {
  const diff = DIFFICULTY_BY_KIND[verdict.kind];
  const sp = selfParkingLabel(data.self_parking.status);
  const ext = data.external_candidates || [];
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;
  const altLabel =
    usableNear > 0
      ? `있음 (${usableNear}곳)`
      : ext.length > 0
        ? "확인 필요"
        : "없음";
  const altTone: "good" | "warn" | "unknown" = usableNear > 0 ? "good" : ext.length > 0 ? "warn" : "unknown";
  const oneLine = buildOneLine(verdict, data, destName);

  return (
    <div className={`rv-card rv-tone-${diff.tone}`}>
      <div className="rv-head">
        <div className="rv-place">{destName || data.destination.name || "분석 결과"}</div>
        <span className={`rv-difficulty rv-diff-${diff.tone}`}>
          주차 난이도 · {diff.label}
        </span>
      </div>

      <div className="rv-visit">
        <span className="rv-visit-icon" aria-hidden>🚗</span>
        <span className="rv-visit-label">{VISIT_LABEL[verdict.kind]}</span>
      </div>

      <div className="rv-grid">
        <div className="rv-grid-item">
          <span className="rv-grid-key">자체 주차장</span>
          <span className={`rv-grid-val rv-val-${sp.tone}`}>{sp.label}</span>
        </div>
        <div className="rv-grid-item">
          <span className="rv-grid-key">주변 대안 주차장</span>
          <span className={`rv-grid-val rv-val-${altTone}`}>{altLabel}</span>
        </div>
      </div>

      <div className="rv-oneline">{oneLine}</div>
    </div>
  );
}
