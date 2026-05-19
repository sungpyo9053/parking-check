import { forwardRef } from "react";
import type { AnalyzeResponse } from "../../types/parking";
import type { VerdictInfo } from "../../utils/parkingPresentation";

type Props = {
  destName: string;
  verdict: VerdictInfo;
  data: AnalyzeResponse;
};

const VERDICT_ICON: Record<VerdictInfo["kind"], string> = {
  good: "✓",
  caution: "!",
  bad: "×",
  unknown: "?",
};

const VERDICT_BG: Record<VerdictInfo["kind"], string> = {
  good: "#dcfce7",
  caution: "#fef3c7",
  bad: "#fee2e2",
  unknown: "#e2e8f0",
};

const VERDICT_FG: Record<VerdictInfo["kind"], string> = {
  good: "#14532d",
  caution: "#92400e",
  bad: "#991b1b",
  unknown: "#334155",
};

const STRESS_FG: Record<VerdictInfo["stress"]["level"], string> = {
  low: "#16a34a",
  medium: "#f59e0b",
  high: "#dc2626",
};

const STRESS_LABEL: Record<VerdictInfo["stress"]["level"], string> = {
  low: "주차 스트레스 낮음",
  medium: "주차 스트레스 보통",
  high: "주차 스트레스 높음",
};

/** html2canvas 로 캡처해 공유할 단일 카드 컴포넌트.
 *  - 카메라가 inline-style 만 읽으므로 모든 디자인을 inline 으로 유지
 *  - 480 x 720 px 고정 사이즈 (인스타 스토리/카톡 미리보기 모두 적합)
 */
const ShareImageCard = forwardRef<HTMLDivElement, Props>(
  function ShareImageCard({ destName, verdict, data }, ref) {
    const sp = data.self_parking;
    const tr = data.top_recommendation?.candidate;
    const stress = verdict.stress;
    const v = verdict.kind;

    return (
      <div
        ref={ref}
        style={{
          width: 480,
          height: 720,
          padding: 36,
          boxSizing: "border-box",
          background:
            "linear-gradient(180deg, #f8fafc 0%, #e0f2fe 100%)",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', Pretendard, sans-serif",
          color: "#0f172a",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#475569",
            letterSpacing: 0.4,
          }}
        >
          parking-check · reviewdr.kr
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 22,
            padding: 22,
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.10)",
            border: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: VERDICT_BG[v],
              color: VERDICT_FG[v],
              fontSize: 28,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {VERDICT_ICON[v]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#94a3b8",
                marginBottom: 4,
              }}
            >
              차 가져가도 될까?
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: -0.4,
                lineHeight: 1.25,
                color: VERDICT_FG[v],
              }}
            >
              {verdict.title}
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#475569",
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              {verdict.detail}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 22,
            padding: 22,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#94a3b8",
              marginBottom: 6,
            }}
          >
            방문지
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#0f172a",
              letterSpacing: -0.2,
            }}
          >
            {destName}
          </div>

          <div style={{ marginTop: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: STRESS_FG[stress.level],
                }}
              >
                {STRESS_LABEL[stress.level]}
              </span>
              <span style={{ fontSize: 14, color: "#0f172a" }}>
                <strong style={{ fontSize: 20, fontWeight: 800 }}>
                  {stress.score}
                </strong>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>
                  점 / 100
                </span>
              </span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: "rgba(15, 23, 42, 0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(4, Math.min(100, stress.score))}%`,
                  height: "100%",
                  background: STRESS_FG[stress.level],
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        </div>

        {tr && (
          <div
            style={{
              background: "linear-gradient(180deg, #ffffff 0%, #dbeafe 100%)",
              border: "1px solid #bfdbfe",
              borderRadius: 22,
              padding: 22,
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                background: "#2563eb",
                color: "#fff",
                fontSize: 12,
                fontWeight: 800,
                padding: "5px 11px",
                borderRadius: 999,
                marginBottom: 10,
              }}
            >
              ⭐ 1순위 추천
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                color: "#1d4ed8",
                marginBottom: 4,
              }}
            >
              <span
                style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6 }}
              >
                도보 {tr.walking_minutes ?? "?"}
              </span>
              <span style={{ fontSize: 16, fontWeight: 600 }}>분</span>
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a",
                letterSpacing: -0.2,
              }}
            >
              {tr.name}
            </div>
          </div>
        )}

        {!tr && sp.status !== "available" && sp.status !== "likely" && (
          <div
            style={{
              background: "#ffffff",
              borderRadius: 22,
              padding: 22,
              border: "1px solid #e2e8f0",
              color: "#475569",
              fontSize: 14,
            }}
          >
            추천 가능한 주차장을 찾지 못했습니다. 대중교통/택시 이용을 고려해
            보세요.
          </div>
        )}

        <div
          style={{
            marginTop: "auto",
            fontSize: 11,
            color: "#94a3b8",
            textAlign: "center",
          }}
        >
          ※ 운영/요금/실시간 정보는 카카오맵에서 확인하세요.
        </div>
      </div>
    );
  },
);

export default ShareImageCard;
