import { useState } from "react";
import type {
  AnalyzeResponse,
  Candidate,
  ExternalCandidate,
} from "../../types/parking";
import { openKakaoFootRoute } from "../../lib/maps";

type Props = {
  data: AnalyzeResponse;
  destName: string;
};

type AltCandidate = {
  key: string;
  name: string;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
  walkingMinutes: number | null;
  url: string | null;
};

function fromDb(c: Candidate): AltCandidate {
  return {
    key: `db-${c.id}`,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    distanceM: c.walking_route_distance_m ?? c.distance_m,
    walkingMinutes: c.walk_minutes,
    url: null,
  };
}

function fromExt(e: ExternalCandidate, i: number): AltCandidate {
  return {
    key: `ext-${i}`,
    name: e.name,
    lat: e.lat,
    lng: e.lng,
    distanceM: e.walking_route_distance_m ?? e.distance_m,
    walkingMinutes: e.walking_minutes,
    url: e.url,
  };
}

/** 흐름 4: "주차 실패했어요" 플랜 B.
 *  - 사용자가 매장 도착 후 자체주차/1순위 추천이 실패했을 때 누르는 CTA
 *  - 토글하면 가장 가까운 대체 주차장 후보들이 펼쳐짐
 *  - 각 후보별 도보 분 + 카카오맵 길찾기/도보 길찾기 버튼
 */
export default function PlanBPanel({ data, destName }: Props) {
  const [open, setOpen] = useState(false);

  // 1순위 추천 후보는 제외 (이미 위에서 노출됨)
  const topCandName = data.top_recommendation?.candidate?.name;
  const alts: AltCandidate[] = [
    ...data.candidates.map(fromDb),
    ...(data.external_candidates || [])
      .filter((e) => e.usability === "usable" && e.lat != null && e.lng != null)
      .map(fromExt),
  ]
    .filter((a) => a.name !== topCandName)
    .sort((a, b) => {
      const aw = a.walkingMinutes ?? 99;
      const bw = b.walkingMinutes ?? 99;
      return aw - bw;
    })
    .slice(0, 3);

  function onRoute(a: AltCandidate) {
    if (a.lat == null || a.lng == null) return;
    openKakaoFootRoute(
      { lat: a.lat, lng: a.lng, name: a.name },
      { lat: data.destination.lat, lng: data.destination.lng, name: destName },
    );
  }

  return (
    <div className={`planb ${open ? "planb-open" : ""}`}>
      <button
        type="button"
        className="planb-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="planb-trigger-icon">🚧</span>
        <span className="planb-trigger-text">
          <strong>주차 실패했어요</strong>
          <span className="planb-trigger-sub">
            {open ? "닫기" : "근처 대체 주차장 바로 보기"}
          </span>
        </span>
        <span className="planb-trigger-caret">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="planb-body">
          {alts.length === 0 ? (
            <div className="planb-empty">
              근처에 대체 가능한 주차장 후보를 더 찾지 못했습니다.
              <br />
              대중교통/택시 이용을 고려해 보세요.
            </div>
          ) : (
            <ul className="planb-list">
              {alts.map((a) => (
                <li key={a.key} className="planb-item">
                  <div className="planb-item-head">
                    <span className="planb-item-name">{a.name}</span>
                    {a.walkingMinutes != null && (
                      <span className="planb-item-walk">
                        도보 <strong>{a.walkingMinutes}</strong>분
                      </span>
                    )}
                  </div>
                  {a.distanceM != null && (
                    <div className="planb-item-meta">{a.distanceM}m</div>
                  )}
                  <div className="planb-item-actions">
                    {a.lat != null && a.lng != null && (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => onRoute(a)}
                      >
                        도보 길찾기
                      </button>
                    )}
                    {a.url && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          window.open(a.url!, "_blank", "noopener,noreferrer")
                        }
                      >
                        카카오맵에서 보기
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="planb-foot">
            ※ 도착 후에도 바로 다음 행동을 할 수 있게 미리 보여드려요.
          </div>
        </div>
      )}
    </div>
  );
}
