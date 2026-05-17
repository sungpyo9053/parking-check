# DB 스키마

PostgreSQL 17 + PostGIS 3 (3.6.x 검증됨). 모든 좌표는 WGS84 (SRID 4326). 정의는 `backend/db/init.sql` 이 정본.

## ER (텍스트)

```
places ─┐
        │ (선택 시점 스냅샷)
        ▼
parking_visit_logs ──▶ parking_lots ──◀── parking_realtime_status (시계열)
        │                    ▲
        ▼                    │
parking_feedbacks ───────────┘
```

## 테이블

### `places`
사용자가 검색한 목적지. Kakao Local 후보를 캐싱.

| column | type | note |
|---|---|---|
| id | bigserial pk | |
| external_source | text | 'kakao' 등 |
| external_id | text | Kakao place id |
| name | text | 장소명 |
| address | text | 지번 주소 |
| road_address | text | 도로명 주소 |
| category | text | Kakao category_name |
| lat | double precision | |
| lng | double precision | |
| geom | geometry(Point,4326) | generated from lat/lng |
| created_at | timestamptz default now() | |
| updated_at | timestamptz | |

- UNIQUE (`external_source`, `external_id`)
- GiST index on `geom`

### `parking_lots`
정적 주차장 마스터 (전국주차장정보표준데이터 + 부설 수집).

| column | type | note |
|---|---|---|
| id | bigserial pk | |
| source | text not null | 'data.go.kr/standard', 'kakao', 'manual' 등 |
| source_id | text | 원천 ID (관리번호 등) |
| name | text not null | |
| type | text | '공영' / '민영' / '부설' |
| parking_type | text | '노상' / '노외' / '부설' |
| road_address | text | |
| jibun_address | text | |
| lat | double precision | |
| lng | double precision | |
| geom | geometry(Point,4326) generated | |
| capacity | int | 총 주차면수 |
| weekday_open_time | time | |
| weekday_close_time | time | |
| saturday_open_time | time | |
| saturday_close_time | time | |
| holiday_open_time | time | |
| holiday_close_time | time | |
| fee_type | text | '유료'/'무료'/'혼합' |
| base_time | int | 분 |
| base_fee | int | 원 |
| extra_time | int | 분 |
| extra_fee | int | 원 |
| phone | text | |
| has_disabled_parking | boolean | |
| data_reference_date | date | 원천 기준일 |
| created_at | timestamptz default now() | |
| updated_at | timestamptz | |

- UNIQUE (`source`, `source_id`)
- GiST index on `geom`
- btree on (`name`)

### `parking_realtime_status`
시계열 실시간 잔여면수. 같은 lot의 직전 행을 덮어쓰지 않고 append.

| column | type | note |
|---|---|---|
| id | bigserial pk | |
| parking_lot_id | bigint fk parking_lots(id) on delete cascade | nullable (미매칭 원천일 수도) |
| source | text not null | 'seoul_opendata' 등 |
| source_lot_key | text | 원천 식별자 (매칭 보조용) |
| observed_at | timestamptz not null | |
| total_capacity | int | |
| available_count | int | |
| occupied_count | int generated (total - available) when both present | |
| raw_payload | jsonb | 원본 |

- btree on (`parking_lot_id`, `observed_at desc`)
- btree on (`source`, `source_lot_key`)

조회 패턴: 후보 lot id 집합에 대해 `DISTINCT ON (parking_lot_id) ... ORDER BY parking_lot_id, observed_at DESC`.

### `parking_visit_logs`
한 번의 "이 주차장으로 가본다"에 대응. 예측 스냅샷 + 실제 결과를 한 행에서 관리.

| column | type | note |
|---|---|---|
| id | bigserial pk | |
| destination_name | text | |
| destination_place_id | bigint fk places(id) | nullable |
| destination_lat | double precision | |
| destination_lng | double precision | |
| selected_parking_lot_id | bigint fk parking_lots(id) | nullable (수동 입력일 수 있음) |
| selected_parking_name | text | 스냅샷 (lot 이름 바뀌어도 보존) |
| searched_at | timestamptz default now() | |
| expected_arrival_at | timestamptz | nullable |
| predicted_status | text | 'available'/'uncertain'/'risky'/'full'/'unknown' |
| predicted_risk_score | numeric | 0~100 |
| api_available_count | int | 검색시점 스냅샷 |
| api_total_capacity | int | |
| actual_result | text | 'success'/'full'/'waited'/'entrance_lost'/'fee_mismatch'/'closed'/'etc' (nullable) |
| actual_wait_minutes | int | |
| actual_fee | int | 원 |
| entrance_difficulty | smallint | 1~5 |
| walking_difficulty | smallint | 1~5 |
| perceived_congestion | smallint | 1~5 |
| memo | text | |
| created_at | timestamptz default now() | |
| updated_at | timestamptz | |

- btree on (`destination_place_id`)
- btree on (`selected_parking_lot_id`)
- btree on (`searched_at desc`)

### `parking_feedbacks`
주차장 자체에 대한 가벼운 피드백 (방문로그와 별개로 "여긴 진짜 좁음" 같은 메모를 누적).

| column | type | note |
|---|---|---|
| id | bigserial pk | |
| parking_lot_id | bigint fk parking_lots(id) on delete cascade | |
| visit_log_id | bigint fk parking_visit_logs(id) on delete set null | nullable |
| feedback_type | text | 'narrow'/'cheap'/'expensive'/'hard_entrance'/'good_signage'/'etc' |
| comment | text | |
| created_at | timestamptz default now() | |

## 인덱스 요약

```
parking_lots(geom) USING GIST
parking_lots(source, source_id) UNIQUE
places(geom) USING GIST
places(external_source, external_id) UNIQUE
parking_realtime_status(parking_lot_id, observed_at DESC)
parking_realtime_status(source, source_lot_key)
parking_visit_logs(destination_place_id)
parking_visit_logs(selected_parking_lot_id)
parking_visit_logs(searched_at DESC)
```
