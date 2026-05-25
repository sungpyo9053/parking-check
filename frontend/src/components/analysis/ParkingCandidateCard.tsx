import { useEffect, useState } from "react";
import type { UsabilityStatus } from "../../types/parking";
import {
  distanceSourceLabel,
  usabilityTagClass,
  usabilityUserLabel,
} from "../../utils/parkingPresentation";
import { openKakaoFootRoute } from "../../lib/maps";
import { api, KakaoPlaceDetail } from "../../lib/api";
import Skeleton from "../Skeleton";

function extractKakaoPid(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/place\.map\.kakao\.com\/(\d+)/);
  return m ? m[1] : null;
}

function DetailExpandable({ kakaoPid }: { kakaoPid: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<KakaoPlaceDetail | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!open || detail !== undefined) return;
    let cancelled = false;
    api
      .kakaoDetail(kakaoPid)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null));
    return () => {
      cancelled = true;
    };
  }, [open, kakaoPid, detail]);

  const hasAny =
    detail &&
    (detail.open_status ||
      detail.hours ||
      detail.base_fee_text ||
      detail.daily_max_text ||
      detail.capacity ||
      detail.payment_methods);

  return (
    <details
      className="pcard-detail-exp"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>💰 요금 · 운영시간 보기</summary>
      <div className="pcard-detail-body">
        {detail === undefined && (
          <div className="pcard-detail-skel">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="pcard-detail-skel-row">
                <Skeleton width={48} height={11} radius={6} />
                <Skeleton width={120 + (i % 3) * 18} height={13} radius={6} />
              </div>
            ))}
          </div>
        )}
        {detail === null && (
          <div className="pcard-detail-empty">
            이 주차장의 요금·운영시간 정보를 카카오맵에서 가져오지 못했어요.
            <br />
            상세 페이지 자체가 등록되지 않았거나 일시적 오류일 수 있습니다.
          </div>
        )}
        {detail && !hasAny && (
          <div className="pcard-detail-empty">
            카카오맵에 이 주차장은 등록되어 있지만,{" "}
            <strong>운영자가 요금·운영시간을 입력하지 않았어요.</strong>
            <br />
            보통 사설 소형 주차장이나 노상공영주차장 일부에서 발생합니다.
            방문 전 주차장 입구 안내판이나 매장 문의가 필요합니다.
          </div>
        )}
        {detail && hasAny && (
          <ul className="pcard-detail-list">
            {detail.open_status && (
              <li>
                <span className="pcard-detail-key">상태</span>
                <span className="pcard-detail-val">{detail.open_status}</span>
              </li>
            )}
            {detail.hours && (
              <li>
                <span className="pcard-detail-key">운영시간</span>
                <span className="pcard-detail-val">{detail.hours}</span>
              </li>
            )}
            {detail.base_fee_text && (
              <li>
                <span className="pcard-detail-key">기본요금</span>
                <span className="pcard-detail-val">{detail.base_fee_text}</span>
              </li>
            )}
            {detail.extra_fee_text && (
              <li>
                <span className="pcard-detail-key">추가요금</span>
                <span className="pcard-detail-val">
                  {detail.extra_fee_text}
                </span>
              </li>
            )}
            {detail.daily_max_text && (
              <li>
                <span className="pcard-detail-key">일 최대</span>
                <span className="pcard-detail-val">
                  {detail.daily_max_text}
                </span>
              </li>
            )}
            {detail.capacity && (
              <li>
                <span className="pcard-detail-key">총면수</span>
                <span className="pcard-detail-val">{detail.capacity}</span>
              </li>
            )}
            {detail.payment_methods && (
              <li>
                <span className="pcard-detail-key">결제</span>
                <span className="pcard-detail-val">
                  {detail.payment_methods}
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
    </details>
  );
}

/** ParkingCard(공식 DB) + ExternalCard(지도/웹 검색) 를 흡수한 통합 카드.
 *  호출 측에서 source/원본 데이터를 보고 props 를 normalize 해서 넘긴다. */
export type ParkingCandidateCardProps = {
  name: string;
  usability: UsabilityStatus;
  /** 출처 라벨 — "공식 주차장 데이터" / "지도 검색 후보" / "웹 검색 후보" 등 */
  sourceLabel: string;
  /** "공영주차장" / "민영/유료주차장" / "지도 검색 기반" 등 */
  kindLabel: string;
  walkingMinutes: number | null;
  distanceM: number | null;
  routeSource: "osrm" | "haversine" | null;
  address?: string | null;
  feeLabel?: string | null;
  realtimeLabel?: string | null;
  lat: number | null;
  lng: number | null;
  externalUrl?: string | null;
  /** 추천 제외 후보의 이유 한 줄. usability=private_restricted 일 때만 사용. */
  excludedReason?: string | null;

  destinationLat: number;
  destinationLng: number;
  destinationName: string;
  /** DB 후보일 때만 — "이 주차장으로 가기" 버튼 (방문 로그 시작). */
  onSelectVisit?: () => void;
};

export default function ParkingCandidateCard(props: ParkingCandidateCardProps) {
  const {
    name,
    usability,
    sourceLabel,
    kindLabel,
    walkingMinutes,
    distanceM,
    routeSource,
    address,
    feeLabel,
    realtimeLabel,
    lat,
    lng,
    externalUrl,
    excludedReason,
    destinationLat,
    destinationLng,
    destinationName,
    onSelectVisit,
  } = props;

  const isExcluded = usability === "private_restricted";
  const hasCoords = lat != null && lng != null;

  function onFootRoute() {
    if (!hasCoords) return;
    openKakaoFootRoute(
      { lat: lat!, lng: lng!, name },
      { lat: destinationLat, lng: destinationLng, name: destinationName },
    );
  }

  return (
    <div className={`pcard pcard-${usability}`}>
      <div className="head">
        <span className={usabilityTagClass(usability)}>
          {usabilityUserLabel(usability)}
        </span>
        <span
          className="tag"
          style={{ background: "#f3f4f6", color: "#6b7280" }}
        >
          {sourceLabel}
        </span>
      </div>

      <div
        className="name"
        style={{
          fontWeight: 700,
          marginTop: 4,
          ...(isExcluded
            ? { textDecoration: "line-through", color: "#9ca3af" }
            : null),
        }}
      >
        {name}
      </div>

      {!isExcluded && hasCoords && walkingMinutes != null && (
        <div className="meta meta-walk">
          <strong>목적지까지 도보 약 {walkingMinutes}분</strong>
          {distanceM != null && (
            <span style={{ marginLeft: 6 }}>
              · {distanceM}m ({distanceSourceLabel(routeSource)})
            </span>
          )}
        </div>
      )}
      {!isExcluded && !hasCoords && (
        <div className="meta meta-walk" style={{ color: "#9a3412" }}>
          위치 정보가 없는 참고 후보입니다. 방문 전 매장 확인이 필요합니다.
        </div>
      )}

      {!isExcluded && (
        <div className="meta">
          <span>{kindLabel}</span>
          {address && <span>· {address}</span>}
        </div>
      )}

      {!isExcluded && hasCoords && (feeLabel || realtimeLabel) && (
        <div className="meta muted">
          {feeLabel || "요금 확인 필요"}
          {realtimeLabel ? ` · ${realtimeLabel}` : ""}
        </div>
      )}

      {excludedReason && (
        <div
          className="meta"
          style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}
        >
          {excludedReason}
        </div>
      )}

      {/* 카카오 detail expand — lazy fetch (펼치면 그 카드만 호출) */}
      {!isExcluded && externalUrl && extractKakaoPid(externalUrl) && (
        <DetailExpandable kakaoPid={extractKakaoPid(externalUrl)!} />
      )}

      {!isExcluded && (
        <div className="actions">
          {hasCoords && (
            <button className="btn primary" onClick={onFootRoute}>
              도보 길찾기
            </button>
          )}
          {externalUrl && (
            <button
              className="btn"
              onClick={() =>
                window.open(externalUrl!, "_blank", "noopener,noreferrer")
              }
            >
              카카오맵에서 열기
            </button>
          )}
          {onSelectVisit && (
            <button className="btn" onClick={onSelectVisit}>
              이 주차장으로 가기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
