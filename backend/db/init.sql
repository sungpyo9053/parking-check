-- 주차될까 - PostgreSQL 초기 스키마
-- docker-compose 가 최초 부팅 시 /docker-entrypoint-initdb.d/ 에서 1회 실행
-- 멱등하게 작성해서 수동 재실행도 가능

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- places
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS places (
    id              BIGSERIAL PRIMARY KEY,
    external_source TEXT,
    external_id     TEXT,
    name            TEXT NOT NULL,
    address         TEXT,
    road_address    TEXT,
    category        TEXT,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    geom            GEOMETRY(POINT, 4326)
                    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_places_external
    ON places (external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_places_geom ON places USING GIST (geom);

-- ---------------------------------------------------------------------------
-- parking_lots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_lots (
    id                      BIGSERIAL PRIMARY KEY,
    source                  TEXT NOT NULL,
    source_id               TEXT,
    name                    TEXT NOT NULL,
    type                    TEXT,                   -- 공영/민영/부설
    parking_type            TEXT,                   -- 노상/노외/부설
    road_address            TEXT,
    jibun_address           TEXT,
    lat                     DOUBLE PRECISION NOT NULL,
    lng                     DOUBLE PRECISION NOT NULL,
    geom                    GEOMETRY(POINT, 4326)
                            GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
    capacity                INTEGER,
    weekday_open_time       TIME,
    weekday_close_time      TIME,
    saturday_open_time      TIME,
    saturday_close_time     TIME,
    holiday_open_time       TIME,
    holiday_close_time      TIME,
    fee_type                TEXT,
    base_time               INTEGER,
    base_fee                INTEGER,
    extra_time              INTEGER,
    extra_fee               INTEGER,
    phone                   TEXT,
    has_disabled_parking    BOOLEAN,
    data_reference_date     DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_lots_source
    ON parking_lots (source, source_id)
    WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_parking_lots_geom ON parking_lots USING GIST (geom);
CREATE INDEX IF NOT EXISTS ix_parking_lots_name ON parking_lots (name);

-- ---------------------------------------------------------------------------
-- parking_realtime_status (시계열, append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_realtime_status (
    id              BIGSERIAL PRIMARY KEY,
    parking_lot_id  BIGINT REFERENCES parking_lots(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,
    source_lot_key  TEXT,
    observed_at     TIMESTAMPTZ NOT NULL,
    total_capacity  INTEGER,
    available_count INTEGER,
    occupied_count  INTEGER,
    raw_payload     JSONB
);

CREATE INDEX IF NOT EXISTS ix_parking_realtime_lot_time
    ON parking_realtime_status (parking_lot_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_parking_realtime_source_key
    ON parking_realtime_status (source, source_lot_key);

-- ---------------------------------------------------------------------------
-- parking_visit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_visit_logs (
    id                          BIGSERIAL PRIMARY KEY,
    destination_name            TEXT,
    destination_place_id        BIGINT REFERENCES places(id) ON DELETE SET NULL,
    destination_lat             DOUBLE PRECISION,
    destination_lng             DOUBLE PRECISION,
    selected_parking_lot_id     BIGINT REFERENCES parking_lots(id) ON DELETE SET NULL,
    selected_parking_name       TEXT,
    searched_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    expected_arrival_at         TIMESTAMPTZ,
    predicted_status            TEXT,
    predicted_risk_score        NUMERIC,
    api_available_count         INTEGER,
    api_total_capacity          INTEGER,
    actual_result               TEXT,
    actual_wait_minutes         INTEGER,
    actual_fee                  INTEGER,
    entrance_difficulty         SMALLINT,
    walking_difficulty          SMALLINT,
    perceived_congestion        SMALLINT,
    memo                        TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_visit_destination_place
    ON parking_visit_logs (destination_place_id);
CREATE INDEX IF NOT EXISTS ix_visit_selected_lot
    ON parking_visit_logs (selected_parking_lot_id);
CREATE INDEX IF NOT EXISTS ix_visit_searched_at
    ON parking_visit_logs (searched_at DESC);

-- ---------------------------------------------------------------------------
-- parking_feedbacks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_feedbacks (
    id              BIGSERIAL PRIMARY KEY,
    parking_lot_id  BIGINT REFERENCES parking_lots(id) ON DELETE CASCADE,
    visit_log_id    BIGINT REFERENCES parking_visit_logs(id) ON DELETE SET NULL,
    feedback_type   TEXT,
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_feedbacks_lot ON parking_feedbacks (parking_lot_id);

-- ---------------------------------------------------------------------------
-- place_self_parking_feedback (사용자가 직접 답하는 자체 주차 ground truth)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS place_self_parking_feedback (
    id          BIGSERIAL PRIMARY KEY,
    place_id    BIGINT REFERENCES places(id) ON DELETE CASCADE,
    answer      TEXT NOT NULL,   -- 'yes' | 'no' | 'unknown'
    note        TEXT,
    user_token  TEXT,            -- 익명 클라이언트 토큰 (브라우저 localStorage)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sp_feedback_place
    ON place_self_parking_feedback (place_id);
CREATE INDEX IF NOT EXISTS ix_sp_feedback_created
    ON place_self_parking_feedback (created_at DESC);
