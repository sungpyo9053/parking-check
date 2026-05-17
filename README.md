# 주차될까 / Parking Check

목적지를 입력하면 **"차를 가져가도 되는지"**, **"어디에 주차하면 되는지"**, **"주차 후 얼마나 걸어야 하는지"** 를 판단해주는 주차 판단 PWA.

---

## Demo

- **Web**: <https://reviewdr.kr>
- **API Health**: <https://reviewdr.kr/api/health>
- **Note**: 현재는 기존 테스트 도메인(`reviewdr.kr`)에 임시 배포되어 있습니다. 운영 도메인은 추후 분리 예정.

---

## Problem

낯선 장소에 차로 가려고 할 때 사용자가 마주치는 실제 문제는 단순하지 않습니다.

- **자체 주차장이 있는지 모른다.** 매장 공식 페이지에 표기되지 않은 경우가 많고, 카카오맵에도 별도 POI 로 잡히지 않는 경우가 흔합니다.
- **지도 검색으로 나오는 "근처 주차장" 의 절반은 타 매장 전용 / 오피스텔 입주민 전용 / 학교 전용 입니다.** 일반 방문자가 못 쓰는 후보가 추천 1순위에 올라옵니다.
- **공공데이터에 등록된 공영주차장은 전국 모든 매장 주변에 충분히 있지 않습니다.** 데이터 누락 지역은 결과가 비어 보입니다.
- **주차장을 찾았다 해도 "거기서 매장까지 얼마나 걸어야 하는지"** 가 한눈에 보이지 않습니다.

기존 지도 앱은 "주차장 POI 목록"은 보여주지만 **"그래서 차 가져가도 돼?"** 라는 질문에 답하지 않습니다.

---

## Solution

본 프로젝트는 4가지 판단을 한 화면에 통합합니다.

- **목적지 자체 주차 가능성 판단** — 카카오 POI + 후기 텍스트 분석으로 매장 자체 주차 가능성을 4단계로 분류 (가능성 높음 / 확인 필요 / 가능성 낮음 / 정보 부족).
- **주변 대체 주차장 후보 검색** — 공공 주차장 DB (PostGIS 반경 검색) + Kakao Local API 결과 통합.
- **타 매장 전용주차장 추천 제외** — 카테고리·이름 휴리스틱으로 일반 방문자가 못 쓰는 후보를 자동 격리.
- **추천 가능 / 확인 필요 / 추천 제외 분류** — 후보를 3섹션으로 분리, 추천 제외는 기본 접힘 상태.
- **주차 후 도보 예상 시간 표시** — 좌표 기반 거리 + 도보 시간 추정 표시.
- **실제 방문 결과 기록** — 사용자가 주차 성공/만차/입구 못 찾음 등 결과를 기록하면 재방문 시 과거 데이터를 노출.

판단 결과는 화면 최하단 바텀시트의 **"차 가져가도 될까?" 카드** 한 줄로 요약되며, 그 위로 1순위 추천 → 자체 주차 카드 → 후보 리스트 순으로 정리됩니다.

---

## Key Features

- **Kakao Local API** 기반 장소 검색
- **Kakao Maps JavaScript SDK** 지도 표시 (목적지 / 추천 가능 / 확인 필요 마커 구분)
- **PostgreSQL + PostGIS** 반경 기반 주차장 검색 (`ST_DWithin`)
- **공공데이터 주차장 DB** (전국주차장정보표준데이터 CSV 적재)
- **Kakao 주차장 fallback** — 공공 데이터 누락 시 카카오 지도 검색으로 보조 후보 추출
- **사용 가능성 분류** (`usability`: usable / caution / private_restricted)
- **방문 로그** — 사용자가 실제 결과 기록, 재검색 시 과거 결과 노출

---

## Architecture

```
   User
    │
    ▼
┌─────────────────────────┐
│  React / Vite PWA       │
│  - 분석 화면 (지도+시트) │
│  - PWA 캐시             │
└──────────┬──────────────┘
           │ HTTPS (JSON)
           ▼
┌─────────────────────────┐
│  FastAPI                │
│  - /api/places/search   │
│  - /api/parking/analyze │
│  - /api/visits          │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│  Parking Analysis       │
│  Engine                 │
│  - usability 분류       │
│  - top-1 추천 점수      │
│  - 도보 거리 계산       │
└──────────┬──────────────┘
           │
   ┌───────┼───────────────┐
   ▼       ▼               ▼
┌────────┐ ┌────────────┐ ┌──────────────┐
│ PG /   │ │ Kakao      │ │ Kakao Maps   │
│ PostGIS│ │ Local API  │ │ JS SDK       │
│ (공식) │ │ (fallback) │ │ (frontend)   │
└────────┘ └────────────┘ └──────────────┘
```

---

## Technical Decisions

설계 단계에서 고민한 의사결정.

### 1. PostGIS 를 사용한 반경 기반 공간 검색

목적지 좌표 기준 300m / 500m / 1km 반경 검색은 단순 좌표 비교로도 흉내낼 수 있지만, 정확한 거리 계산과 인덱스 활용을 위해 PostGIS 의 geography 타입 + `ST_DWithin` 을 사용했습니다. 대량 주차장 데이터에서도 일정한 응답시간을 보장합니다.

### 2. 공공데이터 누락 보완을 위한 Kakao Local fallback

전국 어떤 매장이든 결과가 비지 않도록, 공식 주차장 데이터가 부족할 경우 Kakao Local PK6 카테고리 검색으로 보조 후보를 추가합니다. fallback 후보는 별도 카드로 표시하고 "지도 검색 후보 — 운영/요금 확인 필요" 라는 명확한 라벨을 붙여 사용자가 신뢰도를 구분할 수 있게 했습니다.

### 3. 타 매장 전용주차장 오추천을 줄이기 위한 usability classification

초기 버전 가장 큰 사용성 문제는 "근처 다른 매장 전용주차장"이 1순위로 올라오는 것이었습니다. 해결을 위해:

- 주차장 이름·카테고리 기반 휴리스틱으로 `usable` / `caution` / `private_restricted` 분류
- 오피스텔 / 학교 / 교회 / 다른 매장명 패턴이 들어가면 `private_restricted` 로 자동 격리
- UI 에서 추천 가능 / 확인 필요 / 추천 제외 3섹션으로 시각 분리, 제외 후보는 기본 접힘

### 4. 자체 주차와 주변 대체 주차장 판단 분리

사용자가 진짜로 알고 싶은 건 "이 매장에 자체 주차가 있는지" 와 "없으면 어디로 갈지" 두 가지입니다. 두 정보를 섞으면 결정에 오히려 방해가 됩니다. 그래서:

- **자체 주차 카드** — 카카오 POI + 후기 텍스트 신호로 가능성 4단계 분류
- **1순위 추천 카드** — 자체가 가능하면 "자체 이용", 안 되면 가장 합리적인 외부 1곳만 단독 강조
- **후보 리스트** — 그 외 모든 옵션을 3섹션으로 분리

### 5. 실시간 정보가 없을 때 단정 대신 "확인 필요"로 표현

공영주차장 일부만 실시간 API 가 있고, Kakao fallback 후보는 운영 여부조차 보장되지 않습니다. 정보가 없을 때 "주차 가능" / "주차 불가" 같은 단정 표현은 사용자를 오도하므로, "확인 필요" / "실시간 정보 없음" / "방문 전 확인 권장" 같은 모호하지만 정확한 문구를 사용합니다.

### 6. GENERATED ALWAYS geom 컬럼과 SQLAlchemy Computed 매핑 문제 해결

`parking_lots.geom` 은 DB 레벨에서 `GENERATED ALWAYS AS (...) STORED` 컬럼으로 정의해 좌표 변환 누락을 막았습니다. 다만 SQLAlchemy 2.x 매핑에서 `Computed(...)` 를 그대로 사용하면 INSERT 문에 `geom` 컬럼이 포함돼 PostgreSQL 이 거부합니다. 이를 위해:

- 모델에서 `geom = mapped_column(Geometry(...), Computed("...", persisted=True))` 로 선언
- ORM INSERT 시 `geom` 을 명시적으로 빼고, 적재 스크립트는 `INSERT ... RETURNING geom` 으로 자동 생성된 값을 받아 확인
- 결과: 적재 코드가 좌표 변환을 신경 쓸 필요 없고, GENERATED 컬럼 무결성이 깨질 여지가 없음

---

## Screenshots

> 실제 이미지는 `docs/images/` 경로에 추가 예정입니다.

| 화면 | 경로 |
|---|---|
| 홈 화면 (검색 + 즐겨찾기) | `docs/images/home.png` |
| 분석 화면 (지도 + 판단 바텀시트) | `docs/images/analysis.png` |
| 후보 리스트 (추천/확인/제외) | `docs/images/map-candidates.png` |

---

## Tech Stack

**Frontend**

- React 18 + TypeScript
- Vite
- vite-plugin-pwa
- React Router 6

**Backend**

- Python 3.11 / FastAPI
- SQLAlchemy 2.0 (sync) + GeoAlchemy2
- Pydantic v2 / pydantic-settings
- httpx

**Database**

- PostgreSQL 17
- PostGIS 3.6.x

**External APIs**

- Kakao Local API — 장소 검색, 주차장 POI fallback
- Kakao Maps JavaScript API — 지도 표시
- 공공데이터포털 — 전국주차장정보표준데이터 (CSV 적재)
- 서울시 시영주차장 실시간 주차대수 API (일부 후보)

**Deployment**

- AWS Lightsail (Ubuntu)
- Nginx (TLS 종료 + 정적 파일 + API 리버스 프록시)
- systemd (FastAPI uvicorn 데몬화)

---

## Current Status

**완료**

- ✅ 장소 검색 (Kakao Local API)
- ✅ 지도 표시 (Kakao Maps JS SDK, 마커 분류)
- ✅ PostGIS 반경 기반 주차장 검색
- ✅ Kakao Local fallback (공식 데이터 누락 보완)
- ✅ Usability 3단계 분류 (추천 가능 / 확인 필요 / 추천 제외)
- ✅ 도보 시간 + 거리 표시
- ✅ 방문 로그 기록 / 과거 결과 노출
- ✅ 판단 중심 UI (최종 판단 카드 + 1순위 추천 카드)
- ✅ 모바일 지도 앱 레이아웃 (풀블리드 지도 + 바텀시트 3-state)
- ✅ Lightsail + Nginx + systemd 배포
- ✅ `/api/health` → db ok 확인

**진행 중**

- 🔄 판단 중심 UI 추가 개선 (드래그 인터랙션, 마커 ↔ 카드 연동)
- 🔄 전용주차장 필터링 고도화 (브랜드 토큰 / 지점명 휴리스틱 보강)
- 🔄 실제 도보 경로 연동 검토 (OSRM / Kakao 도보 API)
- 🔄 서울시 실시간 주차대수 연동 확장
- 🔄 웹 검색 기반 자체 주차 검증 정확도 개선

---

## Local Setup

### 1. Repository clone & env 파일 준비

```bash
git clone <repo-url> parking
cd parking

cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

각 `.env` 파일에 본인의 키를 채워 넣으세요. 실제 키는 절대 커밋하지 않습니다 (`.gitignore` 처리됨).

### 2. DB 준비 (Homebrew PostgreSQL 17 + PostGIS 기준)

```bash
createdb parking
psql -d parking -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d parking < backend/db/init.sql
psql -d parking -c "SELECT PostGIS_Version();"
```

Docker 로 대체할 경우:

```bash
docker compose up -d db
```

### 3. Backend 실행

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/api/health
```

### 4. Frontend 실행

```bash
cd frontend
npm install
npm run dev
```

브라우저: <http://localhost:5173>

### 5. (선택) 공공데이터 주차장 CSV 적재

CSV 는 Git 에 포함하지 않습니다.

- 다운로드: <https://www.data.go.kr/data/15012890/standard.do>
- 저장 위치: `backend/scripts/data/parking.csv`

```bash
cd backend && source .venv/bin/activate
python scripts/load_parking_csv.py scripts/data/parking.csv
```

---

## Environment Variables

`.env.example` 기준 설명. **실제 값은 절대 README 나 Git 에 노출하지 마세요.**

| 변수 | 위치 | 설명 |
|---|---|---|
| `KAKAO_REST_API_KEY` | backend | Kakao Local API 호출용 (브라우저 노출 금지) |
| `VITE_KAKAO_JAVASCRIPT_KEY` | frontend | Kakao Maps SDK 로드용. Kakao Developers 에서 **도메인 제한 필수** |
| `DATABASE_URL` | backend | PostgreSQL 접속 문자열 |
| `CORS_ORIGINS` | backend | 허용할 프론트 Origin (콤마 구분) |
| `SEOUL_OPENAPI_KEY` | backend | (선택) 서울시 실시간 주차 API |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | backend | (선택) 후기 텍스트 보강용 |
| `TAVILY_API_KEY` | backend | (선택) 웹 검색 fallback |
| `ANTHROPIC_API_KEY` | backend | (선택) 자연어 요약 생성 |
| `WEB_SEARCH_ENABLED` | backend | 웹 검색 fallback on/off |

키 관리 원칙은 [Security](#security) 섹션을 참고하세요.

---

## Deployment

현재 운영 구성:

```
[ User Browser ]
       │ HTTPS
       ▼
[ AWS Lightsail (Ubuntu) ]
       │
       ├─ Nginx
       │   ├─ /            → React 정적 빌드 산출물 (frontend/dist)
       │   ├─ /api/        → FastAPI 리버스 프록시 (127.0.0.1:8000)
       │   └─ TLS 종료 (Let's Encrypt)
       │
       ├─ systemd
       │   └─ parking-check-backend.service → uvicorn (FastAPI)
       │
       └─ PostgreSQL 17 + PostGIS 3.6.x
```

- Frontend 는 `npm run build` 산출물을 nginx 가 서빙
- Backend 는 systemd 유닛으로 데몬화 (자동 재시작)
- 배포 흐름: `git pull → frontend build → systemd restart → nginx reload`

---

## Security

- 실제 API 키는 **절대 GitHub 에 올리지 않습니다**.
- `.env`, `backend/.env`, `frontend/.env` 는 `.gitignore` 처리됩니다.
- 키가 노출되면 즉시 Kakao Developers / 서울 OpenAPI / Naver / Anthropic 콘솔에서 **재발급**합니다.
- Kakao REST API Key 는 백엔드에서만 사용합니다 (브라우저 노출 금지).
- Kakao JavaScript Key 는 Kakao Developers 에서 도메인 제한을 반드시 설정합니다.
- DB 비밀번호는 `.env` 에만 두고 어떤 로그/출력에도 포함하지 않습니다.

자세한 가이드: [docs/SECURITY.md](docs/SECURITY.md)

---

## Future Work

- **방문 로그 기반 개인화** — 자주 가는 매장의 과거 결과 (성공/실패율) 를 다음 검색 시 우선 표시
- **실시간 주차 가능성 예측** — 과거 방문 데이터 + 요일·시간 패턴으로 만차 위험 예측
- **웹 검색 기반 자체 주차 검증 정확도 향상** — 후기 텍스트 분석 룰 고도화, 표·기호·요약 표현 인식 확대
- **도보 경로 API 연동** — 현재는 직선 거리 기반 추정. OSRM 또는 Kakao 도보 API 로 실제 도보 경로 거리·시간 표시
- **PWA 완성도 개선** — 오프라인 캐시 정책, 홈 화면 아이콘/스플래시, push 알림 등
