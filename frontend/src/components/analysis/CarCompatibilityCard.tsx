import { useEffect, useState } from "react";
import type { AnalyzeResponse } from "../../types/parking";
import type { VerdictInfo } from "../../utils/parkingPresentation";
import {
  CAR_LABEL,
  CarType,
  DRIVE_LABEL,
  DriveStyle,
  computeCarCompat,
  loadCarPref,
  saveCarPref,
} from "../../utils/funCardPresentation";

type Props = {
  data: AnalyzeResponse;
  verdict: VerdictInfo;
};

const CAR_KEYS: CarType[] = ["compact", "midsize", "suv", "large_suv"];
const DRIVE_KEYS: DriveStyle[] = ["novice", "confident"];

/** 흐름 신박 1: 내 차랑 이 장소 궁합.
 *  - 차 타입 + 운전 성향 선택 → 궁합 점수 산정.
 *  - localStorage 영구 저장. 다음 분석에서 자동 적용.
 *  - 점수는 fallback 계산 (data 부족해도 동작).
 */
export default function CarCompatibilityCard({ data, verdict }: Props) {
  const [car, setCar] = useState<CarType | null>(null);
  const [drive, setDrive] = useState<DriveStyle | null>(null);

  useEffect(() => {
    const { car: c, drive: d } = loadCarPref();
    setCar(c);
    setDrive(d);
  }, []);

  function pickCar(c: CarType) {
    const next = car === c ? null : c;
    setCar(next);
    saveCarPref(next, drive);
  }
  function pickDrive(d: DriveStyle) {
    const next = drive === d ? null : d;
    setDrive(next);
    saveCarPref(car, next);
  }

  const compat = computeCarCompat(data, verdict, car, drive);

  return (
    <section className="car-compat">
      <div className="car-compat-head">
        <span className="car-compat-icon">🚗</span>
        <span className="car-compat-title">내 차 궁합</span>
      </div>

      <div className="car-compat-chips">
        {CAR_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`compat-chip${car === k ? " compat-chip-on" : ""}`}
            onClick={() => pickCar(k)}
          >
            {CAR_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="car-compat-chips car-compat-chips-2">
        {DRIVE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`compat-chip${drive === k ? " compat-chip-on" : ""}`}
            onClick={() => pickDrive(k)}
          >
            {DRIVE_LABEL[k]}
          </button>
        ))}
      </div>

      {!compat ? (
        <div className="car-compat-empty">
          차 타입이나 운전 성향을 선택하면 궁합 점수를 보여드려요.
        </div>
      ) : (
        <div className={`car-compat-result car-compat-result-${compat.level}`}>
          <div className="car-compat-score">
            <strong>{compat.score}</strong>
            <span className="car-compat-score-unit">점 / 100</span>
            <span className={`car-compat-tag car-compat-tag-${compat.level}`}>
              {compat.label}
            </span>
          </div>
          <div className="car-compat-hint">{compat.hint}</div>
          <div className="car-compat-meta">
            {car && <span>{CAR_LABEL[car]}</span>}
            {car && drive && <span> · </span>}
            {drive && <span>{DRIVE_LABEL[drive]}</span>}
            <span className="car-compat-foot"> 기준 (현재 설정)</span>
          </div>
        </div>
      )}
    </section>
  );
}
