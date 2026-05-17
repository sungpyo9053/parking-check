# 아키텍처

## 한 줄 요약

목적지(Kakao Local) → 좌표 → 백엔드(PostGIS 반경검색) → 정적 주차장 + 서울 실시간 정보 + 내 방문기록을 합쳐 추천 리스트와 신뢰도 기반 판단을 돌려준다.

## 시스템 다이어그램

```
┌──────────────────────────┐         ┌────────────────────────────────────────┐
│   Frontend (React PWA)   │         │           Backend (FastAPI)            │
│                          │         │                                        │
│  HomePage                │  HTTP   │  /api/places/search   ─┐               │
│  PlaceSelectPage         │ ──────▶ │  /api/parking/analyze  ├─ services/    │
│  AnalysisPage            │         │  /api/parking/nearby   │   kakao       │
│  VisitLogPage            │         │  /api/visits/*         │   seoul_rt    │
│  VisitListPage           │ ◀────── │  /api/health           │   recommend   │
│                          │  JSON   │                        │   self_park   │
│  KakaoMap (JS SDK)       │         └───────────┬────────────┴──────┬────────┘
│  (브라우저에서 직접 로드)│                     │                   │
└─────────┬────────────────┘                     │                   │
          │ Kakao Maps JS SDK                    │                   │
          ▼                                      ▼                   ▼
   Kakao 지도 타일/마커            ┌─────────────────────┐   ┌─────────────────┐
                                   │ PostgreSQL+PostGIS  │   │ Kakao Local /   │
                                   │  places             │   │ 서울 OpenAPI    │
                                   │  parking_lots       │   │ (서버에서 호출) │
                                   │  parking_realtime…  │   └─────────────────┘
                                   │  parking_visit_logs │
                                   │  parking_feedbacks  │
                                   └─────────────────────┘
```

## 컴포넌트 책임

### Frontend (React PWA)
- 사용자가 직접 만지는 모든 UI.
- 지도/마커는 **Kakao Maps JS SDK**로 브라우저에서 직접 렌더 (JS Key 필요).
- 장소 검색, 주차장 분석, 방문로그 저장/조회는 **모두 백엔드 API 경유**. (REST Key는 노출 금지)
- 최근 검색 / 사용자 입력 임시 상태는 localStorage. 회원/로그인 없음.

### Backend (FastAPI)
- **places/search**: Kakao Local API 키워드 검색을 백엔드에서 프록시. 응답은 그대로 전달하고 필요시 `places` 테이블에 캐싱.
- **parking/nearby**: 좌표 + 반경을 받아 PostGIS `ST_DWithin` 으로 정적 주차장 후보를 반환.
- **parking/analyze**: nearby + 자체주차 추정 + 실시간 매칭 + 추천 점수 계산 + 만차 위험 판단을 하나의 응답으로 묶음. 프론트의 "분석 화면" 한 번 호출이면 끝.
- **visits**: 사용자가 선택한 목적지/주차장/예측 스냅샷을 저장하고 사후 실제 결과를 PATCH로 채움.

### DB (PostgreSQL + PostGIS)
- `parking_lots.geom` (`GEOMETRY(POINT, 4326)`) + GiST 인덱스로 반경 검색.
- 실시간 상태는 `parking_realtime_status` 에 시계열로 쌓되 조회는 보통 lot별 최신만 사용 (DISTINCT ON).
- 방문로그는 단일 사용자 가정으로 user_id 컬럼 없이 시작. 나중에 추가.

## 데이터 흐름: "성수동 디올"

1. 사용자가 `홈`에서 "성수동 디올" 입력.
2. 프론트가 `GET /api/places/search?query=성수동 디올` 호출.
3. 백엔드가 Kakao Local 키워드 검색을 프록시하여 후보 5~10개 반환. 동시에 `places` 캐시.
4. 프론트 `PlaceSelectPage` 가 후보를 보여줌. 유저가 한 곳 선택 → `place_id`(또는 좌표) 확보.
5. 프론트가 `GET /api/parking/analyze?place_id=...&radius=500` 호출.
6. 백엔드:
   - `places` 에서 좌표 조회.
   - `services/parking_search.py`: PostGIS 반경검색 → 후보 주차장 N개.
   - `services/seoul_realtime.py`: 후보 lot id 집합에 대한 최신 실시간 상태 join.
   - `services/self_parking.py`: 목적지 주소·이름과 부설주차장 매칭 → 자체주차 신뢰도.
   - `services/recommendation.py`: 룰 기반 점수 산정 → 정렬.
   - `services/visit_history.py` (옵션): 같은 목적지/주차장 과거 방문로그 요약.
7. 프론트 `AnalysisPage` 렌더 → 사용자가 주차장 선택 → `POST /api/visits` (예측 스냅샷 저장).
8. 다녀온 뒤 `VisitLogPage` 에서 실제 결과 입력 → `PATCH /api/visits/{id}/result`.
9. 다음번 같은 장소 검색 시 백엔드가 `parking_visit_logs` 도 함께 응답 → "지난번 토요일 만차였음" 카드 표시.

## 운영 시 주의 (개인 MVP 기준)

- 단일 사용자, 단일 노트북에서 docker-compose. HTTPS/인증 없음.
- PWA는 localhost http에선 일부 PWA 기능이 제한적; 휴대폰에서 테스트하려면 같은 LAN + `vite --host` + `http://<내 IP>:5173` 또는 ngrok 등.
- 서울 실시간 API는 호출 quota가 있으므로 5분 단위 cron + 응답 raw JSON 저장.
- Kakao 일일 quota 초과 시 검색 실패 → 프론트에서 에러 메시지 표시.

## 확장 포인트 (Phase 2 이후)

- 회원/디바이스ID 분리 → visit_logs.user_id
- 비-서울 지역 실시간 정보 (LH / 지자체별 OpenAPI)
- Naver Local 보조 검색, 공휴일 API, 기상청 API
- 카카오모빌리티 길찾기로 ETA 기반 도착시각 만차예측
- 학습 기반 추천 점수 (개인 로그가 충분히 쌓이면)
