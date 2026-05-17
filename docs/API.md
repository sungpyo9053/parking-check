# API 명세

base URL: `http://localhost:8000` (개발). 모든 응답은 JSON, UTF-8.

공통 에러:
```json
{ "detail": "에러 메시지" }
```

## GET /api/health
```json
{ "status": "ok", "db": "ok", "time": "2026-05-17T12:00:00+09:00" }
```

## GET /api/places/search
Kakao Local 키워드 검색을 백엔드에서 프록시.

Query:
- `query` (required, str) — 검색어
- `size` (optional, int, default 10) — 1~15

Response 200:
```json
{
  "items": [
    {
      "external_source": "kakao",
      "external_id": "27329885",
      "place_id": 12,                  // 캐시된 places.id (없으면 null)
      "name": "디올 성수",
      "address": "서울 성동구 성수동2가 ...",
      "road_address": "서울 성동구 연무장길 ...",
      "category": "패션잡화 > 명품관",
      "lat": 37.5443,
      "lng": 127.0556
    }
  ]
}
```

## GET /api/parking/nearby
좌표 + 반경 기준 정적 주차장.

Query:
- `lat` (required, float)
- `lng` (required, float)
- `radius` (optional, int meters, default 500, max 3000)
- `limit` (optional, int, default 30)

Response 200:
```json
{
  "count": 7,
  "radius": 500,
  "items": [
    {
      "id": 81234,
      "name": "성수동공영주차장",
      "type": "공영",
      "parking_type": "노외",
      "distance_m": 142,
      "lat": 37.5440, "lng": 127.0561,
      "capacity": 60,
      "fee_type": "유료",
      "base_time": 30, "base_fee": 1500,
      "extra_time": 10, "extra_fee": 500,
      "road_address": "..."
    }
  ]
}
```

## GET /api/parking/analyze
프론트 분석 화면의 한방 호출.

Query (둘 중 하나):
- `place_id` (int) — `places.id`
- 또는 `lat`+`lng` (float, float)
- `radius` (optional, int meters, default 500)

Response 200:
```json
{
  "destination": {
    "place_id": 12,
    "name": "디올 성수",
    "address": "...",
    "lat": 37.5443, "lng": 127.0556
  },
  "self_parking": {
    "status": "uncertain",
    "confidence": 42,
    "reason": "같은 주소의 부설주차장 데이터가 확인되지 않았습니다. 다만 도보 5분 이내 대체 주차장이 3개 있습니다.",
    "matched_lot_id": null
  },
  "summary": {
    "nearby_count": 7,
    "nearest_distance_m": 142,
    "any_full_risk": true,
    "data_quality": "partial"      // 'rich' / 'partial' / 'sparse'
  },
  "candidates": [
    {
      "id": 81234,
      "name": "성수동공영주차장",
      "type": "공영",
      "distance_m": 142,
      "walk_minutes": 2,
      "capacity": 60,
      "fee_summary": "30분 1500원 / 10분당 500원",
      "is_open_now": true,
      "realtime": {
        "available_count": 3,
        "total_capacity": 60,
        "observed_at": "2026-05-17T11:55:00+09:00",
        "source": "seoul_opendata",
        "stale_seconds": 120
      },
      "congestion": "risky",          // 'easy'/'moderate'/'busy'/'risky'/'full'/'unknown'
      "score": 78.4,
      "reasons": ["거리 142m", "실시간 잔여 3면", "주말 만차 위험"],
      "history": {
        "my_visits": 2,
        "my_success_rate": 0.5,
        "last_visit": { "result": "full", "visited_at": "2026-05-10T15:40:00+09:00" }
      }
    }
  ],
  "history_for_destination": [
    {
      "visit_id": 9,
      "selected_parking_name": "성수타워 주차장",
      "searched_at": "2026-05-10T15:30:00+09:00",
      "actual_result": "success",
      "memo": "토요일 오후, 한 바퀴 돌고 들어감"
    }
  ],
  "disclaimers": [
    "실시간 정보는 현장과 5분 이상 차이가 날 수 있습니다."
  ]
}
```

## POST /api/visits
방문 계획 저장 (예측 스냅샷).

Request:
```json
{
  "destination_name": "디올 성수",
  "destination_place_id": 12,
  "destination_lat": 37.5443,
  "destination_lng": 127.0556,
  "selected_parking_lot_id": 81234,
  "selected_parking_name": "성수동공영주차장",
  "expected_arrival_at": "2026-05-17T19:00:00+09:00",
  "predicted_status": "risky",
  "predicted_risk_score": 78.4,
  "api_available_count": 3,
  "api_total_capacity": 60
}
```

Response 201:
```json
{ "id": 42, "created_at": "..." }
```

## PATCH /api/visits/{visit_id}/result
실제 결과 기록.

Request:
```json
{
  "actual_result": "full",       // 'success'/'full'/'waited'/'entrance_lost'/'fee_mismatch'/'closed'/'etc'
  "actual_wait_minutes": 15,
  "actual_fee": null,
  "entrance_difficulty": 2,
  "walking_difficulty": 1,
  "perceived_congestion": 5,
  "memo": "토요일 저녁 19시. 줄 김."
}
```

Response 200: 변경된 visit 전체.

## GET /api/visits
전체 방문 로그 (최신순).

Query:
- `limit` (default 50)
- `offset` (default 0)

Response 200:
```json
{
  "count": 12,
  "items": [ /* visit_log row */ ]
}
```

## GET /api/visits/by-place
같은 목적지 과거 방문.

Query:
- `place_id` (required, int)
- 또는 `lat`+`lng`+`tolerance_m` (좌표 근접 일치)

Response 200: `items` 배열.

## GET /api/visits/by-parking-lot
같은 주차장 과거 방문.

Query: `parking_lot_id` (required, int)

Response 200: `items` 배열.

## (TODO)
- POST /api/feedbacks — 주차장 가벼운 피드백
- DELETE /api/visits/{id}
- 인증/멀티유저 — 단일 사용자 가정으로 생략
