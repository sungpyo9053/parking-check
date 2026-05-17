"""전국주차장정보표준데이터 CSV 적재기.

원천: https://www.data.go.kr/data/15012890/standard.do
컬럼명은 시점에 따라 한국어/영문이 혼재할 수 있어 후보 컬럼명을 여러 개 시도한다.
실제 컬럼명이 다르면 COLUMN_CANDIDATES 를 수정해라.

사용:
    python scripts/load_parking_csv.py scripts/data/parking.csv
"""
from __future__ import annotations

import csv
import sys
from datetime import datetime, time as dtime
from pathlib import Path

# CSV 파일이 큰 경우(>50MB) field size 늘려야 한다
csv.field_size_limit(sys.maxsize)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402


COLUMN_CANDIDATES = {
    "source_id": ["관리번호", "주차장관리번호", "PRKPLCE_NO"],
    "name": ["주차장명", "PRKPLCE_NM"],
    "type": ["주차장구분", "PRKPLCE_SE"],
    "parking_type": ["주차장유형", "PRKPLCE_TYPE"],
    "road_address": ["소재지도로명주소", "ROAD_NM_ADDR"],
    "jibun_address": ["소재지지번주소", "LNM_ADDR"],
    "lat": ["위도", "LAT"],
    "lng": ["경도", "LOT", "LNG"],
    "capacity": ["주차구획수", "PRK_CMPRT_CO"],
    "weekday_open_time": ["평일운영시작시각", "WD_OPER_BGNG_TM"],
    "weekday_close_time": ["평일운영종료시각", "WD_OPER_END_TM"],
    "saturday_open_time": ["토요일운영시작시각", "SAT_OPER_BGNG_TM"],
    "saturday_close_time": ["토요일운영종료시각", "SAT_OPER_END_TM"],
    "holiday_open_time": ["공휴일운영시작시각", "HOLIDAY_OPER_BGNG_TM"],
    "holiday_close_time": ["공휴일운영종료시각", "HOLIDAY_OPER_END_TM"],
    "fee_type": ["요금정보", "PRK_TYPE"],
    "base_time": ["주차기본시간", "BSC_PRK_HM"],
    "base_fee": ["주차기본요금", "BSC_PRK_CRG"],
    "extra_time": ["추가단위시간", "ADD_UNIT_TM"],
    "extra_fee": ["추가단위요금", "ADD_UNIT_CRG"],
    "phone": ["전화번호", "TELNO"],
    "has_disabled_parking": ["장애인전용주차구역수", "DSBL_PWDBS_PRK_CMPRT_CO"],
    "data_reference_date": ["데이터기준일자", "REFER_DE"],
}


def pick(row: dict, key: str):
    for cand in COLUMN_CANDIDATES[key]:
        if cand in row and (row[cand] or "").strip() != "":
            return row[cand].strip()
    return None


def parse_time(v: str | None) -> dtime | None:
    if not v:
        return None
    v = v.replace(":", "").zfill(4)
    if len(v) < 4 or not v.isdigit():
        return None
    h, m = int(v[:2]), int(v[2:4])
    if not (0 <= h <= 24 and 0 <= m <= 59):
        return None
    if h == 24:
        h, m = 0, 0
    return dtime(h, m)


def parse_int(v: str | None) -> int | None:
    if not v:
        return None
    try:
        return int(float(v.replace(",", "")))
    except (ValueError, AttributeError):
        return None


def parse_float(v: str | None) -> float | None:
    if not v:
        return None
    try:
        return float(v)
    except (ValueError, AttributeError):
        return None


def parse_date(v: str | None):
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def upsert(conn, row: dict):
    lat = parse_float(pick(row, "lat"))
    lng = parse_float(pick(row, "lng"))
    if lat is None or lng is None:
        return False
    if not (33 <= lat <= 39) or not (124 <= lng <= 132):
        # 한반도 영역 밖이면 패스
        return False

    name = pick(row, "name")
    if not name:
        return False

    payload = {
        "source": "data.go.kr/standard",
        "source_id": pick(row, "source_id"),
        "name": name,
        "type": pick(row, "type"),
        "parking_type": pick(row, "parking_type"),
        "road_address": pick(row, "road_address"),
        "jibun_address": pick(row, "jibun_address"),
        "lat": lat,
        "lng": lng,
        "capacity": parse_int(pick(row, "capacity")),
        "weekday_open_time": parse_time(pick(row, "weekday_open_time")),
        "weekday_close_time": parse_time(pick(row, "weekday_close_time")),
        "saturday_open_time": parse_time(pick(row, "saturday_open_time")),
        "saturday_close_time": parse_time(pick(row, "saturday_close_time")),
        "holiday_open_time": parse_time(pick(row, "holiday_open_time")),
        "holiday_close_time": parse_time(pick(row, "holiday_close_time")),
        "fee_type": pick(row, "fee_type"),
        "base_time": parse_int(pick(row, "base_time")),
        "base_fee": parse_int(pick(row, "base_fee")),
        "extra_time": parse_int(pick(row, "extra_time")),
        "extra_fee": parse_int(pick(row, "extra_fee")),
        "phone": pick(row, "phone"),
        "has_disabled_parking": (parse_int(pick(row, "has_disabled_parking")) or 0) > 0,
        "data_reference_date": parse_date(pick(row, "data_reference_date")),
    }

    if payload["source_id"]:
        conn.execute(
            text(
                """
                INSERT INTO parking_lots (
                    source, source_id, name, type, parking_type,
                    road_address, jibun_address, lat, lng,
                    capacity,
                    weekday_open_time, weekday_close_time,
                    saturday_open_time, saturday_close_time,
                    holiday_open_time, holiday_close_time,
                    fee_type, base_time, base_fee, extra_time, extra_fee,
                    phone, has_disabled_parking, data_reference_date
                ) VALUES (
                    :source, :source_id, :name, :type, :parking_type,
                    :road_address, :jibun_address, :lat, :lng,
                    :capacity,
                    :weekday_open_time, :weekday_close_time,
                    :saturday_open_time, :saturday_close_time,
                    :holiday_open_time, :holiday_close_time,
                    :fee_type, :base_time, :base_fee, :extra_time, :extra_fee,
                    :phone, :has_disabled_parking, :data_reference_date
                )
                ON CONFLICT (source, source_id)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    type = EXCLUDED.type,
                    parking_type = EXCLUDED.parking_type,
                    road_address = EXCLUDED.road_address,
                    jibun_address = EXCLUDED.jibun_address,
                    lat = EXCLUDED.lat,
                    lng = EXCLUDED.lng,
                    capacity = EXCLUDED.capacity,
                    weekday_open_time = EXCLUDED.weekday_open_time,
                    weekday_close_time = EXCLUDED.weekday_close_time,
                    saturday_open_time = EXCLUDED.saturday_open_time,
                    saturday_close_time = EXCLUDED.saturday_close_time,
                    holiday_open_time = EXCLUDED.holiday_open_time,
                    holiday_close_time = EXCLUDED.holiday_close_time,
                    fee_type = EXCLUDED.fee_type,
                    base_time = EXCLUDED.base_time,
                    base_fee = EXCLUDED.base_fee,
                    extra_time = EXCLUDED.extra_time,
                    extra_fee = EXCLUDED.extra_fee,
                    phone = EXCLUDED.phone,
                    has_disabled_parking = EXCLUDED.has_disabled_parking,
                    data_reference_date = EXCLUDED.data_reference_date,
                    updated_at = now()
                """
            ),
            payload,
        )
    else:
        # source_id 가 없으면 그냥 insert
        conn.execute(
            text(
                """
                INSERT INTO parking_lots (
                    source, name, type, parking_type, road_address, jibun_address,
                    lat, lng, capacity, fee_type, base_time, base_fee, extra_time, extra_fee, phone
                ) VALUES (
                    :source, :name, :type, :parking_type, :road_address, :jibun_address,
                    :lat, :lng, :capacity, :fee_type, :base_time, :base_fee, :extra_time, :extra_fee, :phone
                )
                """
            ),
            payload,
        )
    return True


def main():
    if len(sys.argv) < 2:
        print("usage: python scripts/load_parking_csv.py <path-to-csv>", file=sys.stderr)
        sys.exit(1)
    csv_path = Path(sys.argv[1])
    if not csv_path.exists():
        print(f"file not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    inserted = 0
    skipped = 0
    # 공공데이터 CSV 는 보통 cp949 / utf-8-sig 둘 다 있다
    for enc in ("utf-8-sig", "cp949"):
        try:
            f = csv_path.open(newline="", encoding=enc)
            reader = csv.DictReader(f)
            _ = reader.fieldnames  # encoding 검증
            break
        except UnicodeDecodeError:
            continue
    else:
        print("CSV 인코딩 자동 감지 실패. utf-8 또는 cp949 로 저장된 파일을 사용하세요.")
        sys.exit(1)

    print(f"CSV columns: {reader.fieldnames}")
    with engine.begin() as conn:
        for i, row in enumerate(reader, 1):
            try:
                ok = upsert(conn, row)
                inserted += int(ok)
                skipped += int(not ok)
            except Exception as e:  # noqa: BLE001
                skipped += 1
                if skipped <= 5:
                    print(f"skip row {i}: {e}")
            if i % 5000 == 0:
                print(f"  ... processed {i} rows (ok={inserted}, skip={skipped})")
    f.close()
    print(f"done. inserted/updated={inserted}, skipped={skipped}")


if __name__ == "__main__":
    main()
