# 구현 태스크 체크리스트

체크리스트는 Phase 단위. 각 Phase의 마지막 항목까지 끝나면 "직접 한 번 써본다" 가 종료 조건.

## Phase 1. 프로젝트 뼈대 (이 스캐폴드)
- [x] frontend Vite + React + TS 생성
- [x] backend FastAPI 생성
- [x] docker-compose (postgis 16)
- [x] init.sql (확장 + 테이블 + 인덱스)
- [x] .env.example
- [x] README

## Phase 2. 지도 + 장소 검색
- [ ] Kakao Maps JS SDK 로더 (`src/lib/kakao.ts`)
- [ ] HomePage 검색 입력
- [ ] `GET /api/places/search` 백엔드 프록시 동작 확인
- [ ] PlaceSelectPage 결과 리스트
- [ ] AnalysisPage 지도 + 목적지 마커
- [ ] 최근 검색 localStorage

## Phase 3. 주차장 DB
- [ ] 공공데이터포털 CSV 다운로드 (수동)
- [ ] `scripts/load_parking_csv.py` 컬럼 매핑 확정 (TODO 표시된 부분)
- [ ] 적재 후 `SELECT count(*) FROM parking_lots` 확인
- [ ] `GET /api/parking/nearby` 동작 확인
- [ ] AnalysisPage 마커 표시

## Phase 4. 주차 분석 화면
- [ ] `GET /api/parking/analyze` 응답 조립
- [ ] 자체주차 추정 룰 (`services/self_parking.py`)
- [ ] 룰 기반 추천 점수 (`services/recommendation.py`)
- [ ] 운영시간/요금 표시 컴포넌트
- [ ] 신뢰도 배지 (available/uncertain/risky/full/unknown)

## Phase 5. 방문 로그
- [ ] POST /api/visits
- [ ] PATCH /api/visits/{id}/result
- [ ] VisitLogPage (선택한 주차장 + 결과 입력 UI)
- [ ] VisitListPage 목록
- [ ] AnalysisPage → 방문 시작 흐름

## Phase 6. 서울 실시간 정보
- [ ] `services/seoul_realtime.py` API 호출 (TODO: endpoint 확인)
- [ ] `scripts/collect_seoul_realtime.py` 5분 cron
- [ ] parking_lots 매칭 룰 (이름/좌표 휴리스틱)
- [ ] analyze 응답에 realtime 병합
- [ ] AnalysisPage 혼잡도 배지

## Phase 7. 개인 경험 기반 보정
- [ ] `GET /api/visits/by-place`
- [ ] `GET /api/visits/by-parking-lot`
- [ ] AnalysisPage 과거 카드
- [ ] 추천 점수에 personal_history 가/감점

## Backlog (나중에)
- [ ] Alembic 도입
- [ ] Redis 캐시 (Kakao 검색 결과)
- [ ] 카카오모빌리티 길찾기 ETA → 도착 시점 만차 예측
- [ ] 회원/멀티 디바이스
- [ ] 비-서울 실시간 정보
- [ ] 푸시 알림 (만차→다른 주차장 추천)
