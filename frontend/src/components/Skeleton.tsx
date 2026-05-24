import { CSSProperties } from "react";

type Props = {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
};

/** 토스/배민 톤 shimmer skeleton. 회색 → 옅은 그레이로 흐르는 그라데이션이 좌→우 반복.
 *  width/height 둘 다 줘서 진짜 카드 모양으로 placeholder 만듦.
 */
export default function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  className,
  style,
}: Props) {
  return (
    <span
      className={`sk-shimmer ${className || ""}`}
      style={{
        width,
        height,
        borderRadius: radius,
        display: "inline-block",
        ...style,
      }}
      aria-hidden
    />
  );
}

/** 분석 결과 로딩 — VerdictCard / PlanACard 모양으로 미리 깔아두면 layout shift 없음. */
export function AnalysisSkeleton() {
  return (
    <div className="sk-analysis">
      <div className="sk-analysis-row">
        <Skeleton width={120} height={14} radius={7} />
      </div>
      <Skeleton width="78%" height={28} radius={10} style={{ marginTop: 8 }} />
      <Skeleton width="55%" height={28} radius={10} style={{ marginTop: 6 }} />
      <div className="sk-analysis-meta">
        <Skeleton width={80} height={12} radius={6} />
        <Skeleton width={120} height={12} radius={6} />
      </div>
      <div className="sk-analysis-detail">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="sk-analysis-detail-row" key={i}>
            <Skeleton width={50} height={11} radius={6} />
            <Skeleton width={120} height={13} radius={6} />
          </div>
        ))}
      </div>
      <div className="sk-analysis-btns">
        <Skeleton height={40} radius={12} />
        <Skeleton height={40} radius={12} />
      </div>
    </div>
  );
}
