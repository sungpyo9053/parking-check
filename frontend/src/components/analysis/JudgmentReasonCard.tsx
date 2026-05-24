import type { AnalyzeResponse } from "../../types/parking";
import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = {
  data: AnalyzeResponse;
  verdict: VerdictInfo;
};

type ReasonRow = { key: string; label: string; tone: "good" | "warn" | "unknown" };

function buildReasons(data: AnalyzeResponse, verdict: VerdictInfo): ReasonRow[] {
  const sp = data.self_parking.status;
  const ext = data.external_candidates || [];
  const dbCount = data.candidates?.length ?? 0;
  const tr = data.top_recommendation;
  const usableNear = ext.filter(
    (e) => e.usability === "usable" && (e.distance_m ?? 9999) <= 600,
  ).length;

  // 1. 장소 자체 주차장 정보
  let selfRow: ReasonRow;
  if (sp === "available" || sp === "likely")
    selfRow = { key: "자체 주차장 정보", label: "자체 주차 가능성 확인됨", tone: "good" };
  else if (sp === "unavailable")
    selfRow = { key: "자체 주차장 정보", label: "자체 주차 어려움 (블로그/리뷰 다수)", tone: "warn" };
  else if (sp === "uncertain")
    selfRow = { key: "자체 주차장 정보", label: "리뷰가 엇갈려 단정 어려움", tone: "warn" };
  else
    selfRow = { key: "자체 주차장 정보", label: "정보 없음 — 매장 문의 권장", tone: "unknown" };

  // 2. 주변 주차장 접근성
  let accessRow: ReasonRow;
  if (usableNear >= 2)
    accessRow = { key: "주변 주차장 접근성", label: `근거리 일반 개방 ${usableNear}곳`, tone: "good" };
  else if (usableNear === 1)
    accessRow = { key: "주변 주차장 접근성", label: "근거리 일반 개방 1곳 — 만차 대비 필요", tone: "warn" };
  else if (ext.length > 0)
    accessRow = { key: "주변 주차장 접근성", label: "회사/빌딩 주차장 위주 — 출입 가능 여부 확인", tone: "warn" };
  else
    accessRow = { key: "주변 주차장 접근성", label: "근거리 주차장 정보 부족", tone: "unknown" };

  // 3. 도보 이동 가능성
  let walkRow: ReasonRow;
  const walk = tr?.candidate.walking_minutes;
  if (walk != null) {
    if (walk <= 3)
      walkRow = { key: "도보 이동 가능성", label: `1순위 추천까지 도보 약 ${walk}분`, tone: "good" };
    else if (walk <= 8)
      walkRow = { key: "도보 이동 가능성", label: `1순위까지 도보 ${walk}분 — 무난`, tone: "good" };
    else
      walkRow = { key: "도보 이동 가능성", label: `1순위까지 도보 ${walk}분 — 좀 멀음`, tone: "warn" };
  } else {
    walkRow = { key: "도보 이동 가능성", label: "추천 주차장 미선정", tone: "unknown" };
  }

  // 4. 정보 신뢰도
  let trustRow: ReasonRow;
  const totalEvidence = dbCount + ext.length;
  if (dbCount > 0)
    trustRow = { key: "정보 신뢰도", label: `공공데이터 ${dbCount}건 + 카카오·웹 ${ext.length}건`, tone: "good" };
  else if (totalEvidence >= 5)
    trustRow = { key: "정보 신뢰도", label: `카카오·웹 기반 ${totalEvidence}건 (공공데이터 없음)`, tone: "warn" };
  else if (totalEvidence > 0)
    trustRow = { key: "정보 신뢰도", label: `보조 데이터 ${totalEvidence}건 — 표본 적음`, tone: "warn" };
  else
    trustRow = { key: "정보 신뢰도", label: "참고 데이터 부족", tone: "unknown" };

  // 5. 방문 전 확인 필요 여부
  let checkRow: ReasonRow;
  if (verdict.kind === "good" && (sp === "available" || sp === "likely"))
    checkRow = { key: "방문 전 확인 필요", label: "매장 자체 주차 운영 시간만 한 번 확인", tone: "good" };
  else if (verdict.kind === "good")
    checkRow = { key: "방문 전 확인 필요", label: "추천 주차장 운영 시간 확인 권장", tone: "good" };
  else if (verdict.kind === "caution")
    checkRow = { key: "방문 전 확인 필요", label: "현장 만차/요금 변동 가능 — 출발 전 확인", tone: "warn" };
  else if (verdict.kind === "bad")
    checkRow = { key: "방문 전 확인 필요", label: "대중교통 경로 미리 확인", tone: "warn" };
  else
    checkRow = { key: "방문 전 확인 필요", label: "카카오맵에서 추가 확인 필수", tone: "unknown" };

  return [selfRow, accessRow, walkRow, trustRow, checkRow];
}

export default function JudgmentReasonCard({ data, verdict }: Props) {
  const rows = buildReasons(data, verdict);
  return (
    <section className="rcard">
      <header className="rcard-head">
        <span className="rcard-tag">판단 근거</span>
        <h3 className="rcard-title">이렇게 판단했어요</h3>
      </header>
      <ul className="rcard-list">
        {rows.map((r) => (
          <li key={r.key} className="rcard-row">
            <span className="rcard-row-key">{r.key}</span>
            <span className={`rcard-row-val rcard-val-${r.tone}`}>
              {r.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
