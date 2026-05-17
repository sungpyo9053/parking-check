# 주차될까 / Parking Check

목적지를 입력하면 **"차를 가져가도 되는지"**, **"어디에 주차하면 되는지"**, **"주차 후 얼마나 걸어야 하는지"** 를 판단해주는 주차 판단 PWA.

---

## Demo

- **Web**: <https://reviewdr.kr>
- **API Health**: <https://reviewdr.kr/api/health>
- **Note**: `reviewdr.kr` 은 기존 테스트 도메인에 임시 배포한 상태입니다. 운영 도메인은 추후 분리 예정.

---

## Problem

낯선 장소에 차로 가려고 할 때 사용자가 마주치는 실제 문제는 단순하지 않습니다.

- **자체 주차장이 있는지 모른다.** 매장 공식 페이지에 표기되지 않은 경우가 많고, 카카오맵에도 별도 POI 로 안 잡히는 경우가 흔합니다.
- **지도 검색으로 나오는 "근처 주차장" 의 절반은 타 매장 전용 / 오피스텔 입주민 전용 / 학교 전용 입니다.** 일반 방문자가 못 쓰는 후보가 추천 1순위에 올라옵니다.
- **공공데이터에 등록된 공영주차장은 전국 모든 매장 주변에 충분히 있지 않습니다.** 데이터가 누락된 지역은 결과가 비어 보입니다.
- **주차장을 찾았다 해도 "거기서 매장까지 얼마나 걸어야 하는지"** 가 한눈에 안 보입니다.

기존 지도 앱은 "주차장 POI 목록"은 보여주지만 **"그래서 차 가져가도 돼?"** 라는 질문에 답하지 않습니다.

---

## Solution

본 프로젝트는 4가지 판단을 한 화면에 통합합니다.

1. **목적지 자체 주차 가능성 판단** — 카카오 POI + 후기 텍스트 분석으로 매장 자체 주차 가능성을 4단계로 분류 (가능성 높음 / 확인 필요 / 가능성 낮음 / 정보 부족).
2. **주변 대체 주차장 검색** — 공공 주차장 DB (PostGIS 반경 검색) + Kakao Local API 의 결과를 통합.
3. **추천 가능 / 확인 필요 / 추천 제외 분류** — 타 매장·오피스텔·학교 전용 주차장은 자동으로 제외 섹션으로 격리.
4. **주차 후 도보 시간 표시** — 좌표 기반 직선 거리 + 도보 시간 추정 표시.
5. **실제 방문 결과 기록** — 사용자가 주차 성공/만차/입구 못 찾음 등 결과를 기록하면, 같은 장소 재방문 시 과거 데이터를 노출.

판단 결과는 화면 최상단 **"차 가져가도 될까?" 카드** 한 줄로 요약되며, 그 아래로 1순위 추천 → 자체 주차 카드 → 후보 리스트 순으로 정리됩니다.

---

## Key Features

- **Kakao Local API** 기반 장소 검색
- **Kakao Maps JavaScript SDK** 지도 표시 (목적지/추천/확인 필요 마커 구분)
- **PostgreSQL + PostGIS** 반경 기반 주차장 검색 (`ST_DWithin`)
- **공공데이터 주차장 DB** (전국주차장정보표준데이터 CSV 적재)
- **Kakao Local fallback** — 공식 데이터 누락 시 카카오 지도 검색으로 보조 후보 추출
- **Usability classification** — 카테고리·이름 휴리스틱으로 추천 가능 / 확인 필요 / 추천 제외 3단계 분류
- **방문 로그** — 사용자가 실제 결과 기록, 재검색 시 과거 결과 노출
- **PWA** — 모바일 홈 화면 추가 가능, 오프라인 캐시

---

## Architecture

```
            ┌────────────────────────────┐
   User →   │  React PWA (Vite + TS)     │
            │  - 분석 화면               │
            │  - 카카오 지도             │
            └─────────────┬──────────────┘
                          │ HTTPS
                          ▼
            ┌────────────────────────────┐
            │  FastAPI Backend           │
            │  - /api/places/search      │
            │  - /api/parking/analyze    │
            │  - /api/visits             │
            └─────────────┬──────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
 ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
 │ PostgreSQL   │ │ Kakao Local  │ │ Parking Analysis │
 │ + PostGIS    │ │ API          │ │ Engine           │
 │ (공식 데이터)│ │ (fallback)   │ │ (분류·점수·도보) │
 └──────────────┘ └──────────────┘ └──────────────────┘
```

- **PWA → FastAPI**: REST API (JSON)
- **FastAPI → PostGIS**: 반경 검색 / 매장 자체 주차장 POI 매칭
- **FastAPI → Kakao**: 공식 데이터 누락 시 fallback, 매장 자체 POI 보강
- **Parking Analysis Engine**: usability 분류 + top-1 추천 + 도보 시간 계산

---

## Technical Decisions

설계 단계에서 고민한 몇 가지 의사결정.

### 1. PostGIS 를 사용해 반경 기반 주차장 검색 구현

목적지 좌표 기준 500m / 1km 반경 검색은 단순 `(lat - x)^2 + (lng - y)^2` 비교로도 흉내낼 수 있지만, 정확한 거리 계산과 인덱스 활용을 위해 PostGIS 의 geography 타입 + `ST_DWithin` 을 사용했습니다. `parking_lots.geom` 컬럼은 lat/lng 에서 자동 생성 (`GENERATED ALWAYS`) 하도록 해서 적재 코드가 좌표 변환을 신경 쓸 필요 없도록 했습니다.

### 2. 공공데이터 누락을 보완하기 위해 Kakao Local fallback 적용

전국 어떤 매장이든 결과가 비지 않도록, 공식 주차장 데이터가 부족할 경우 Kakao Local PK6 카테고리 검색으로 보조 후보를 추가합니다. fallback 후보는 별도 카드로 표시하고 "지도 검색 후보 — 운영/요금 확인 필요" 라는 명확한 라벨을 붙여 사용자가 신뢰도를 구분할 수 있게 했습니다.

### 3. 타 매장 전용주차장 오추천 문제를 줄이기 위해 usability classification 적용

초기 버전에서 가장 큰 사용성 문제는 "근처 다른 매장 전용주차장"이 1순위로 올라오는 것이었습니다. 해결을 위해:

- 주차장 이름·카테고리 기반 휴리스틱으로 `usable` / `caution` / `private_restricted` 분류
- 오피스텔·학교·교회·다른 매장명 패턴이 들어가면 `private_restricted` 로 자동 격리
- UI 에서 추천 가능 / 확인 필요 / 추천 제외 3섹션으로 시각적 분리, 제외 후보는 기본 접힘

### 4. 목적지 자체 주차와 주변 대체 주차장을 분리해서 판단

사용자가 진짜로 알고 싶은 건 "이 매장에 자체 주차가 있는지" 와 "없으면 어디로 갈지" 두 가지입니다. 두 정보를 섞으면 결정에 오히려 방해가 됩니다. 그래서:

- **자체 주차 카드**: 카카오 POI + 후기 텍스트 신호로 가능성 4단계 분류
- **1순위 추천 카드**: 자체가 가능하면 "자체 이용", 안 되면 가장 합리적인 외부 1곳을 단독으로 강조
- **후보 리스트**: 그 외 모든 옵션을 3섹션으로 분리

### 5. 실제 잔여면수가 없을 때는 단정 표현 대신 "확인 필요"로 표시

공영주차장 일부만 실시간 API 가 있고, 카카오 fallback 후보는 운영 여부조차 보장되지 않습니다. 정보가 없을 때 "주차 가능" / "주차 불가" 같은 단정 표현은 사용자를 오도하므로, "확인 필요" / "실시간 정보 없음" / "방문 전 확인 권장" 같은 모호하지만 정확한 문구를 사용합니다.

---

## Screenshots

> 실제 이미지는 `docs/images/` 경로에 추가 예정입니다.

| 화면 | 경로 |
|---|---|
| 홈 화면 (검색 + 즐겨찾기) | `docs/images/home.png` |
| 분석 화면 (판단 카드 + 1순위 추천) | `docs/images/analysis.png` |
| 지도 + 후보 리스트 | `docs/images/map-candidates.png` |
| 방문 로그 기록 | `docs/images/visit-log.png` |

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
- httpx (외부 API 호출)

**Database**

- PostgreSQL 17
- PostGIS 3.6.x

**External APIs**

- Kakao Local API — 장소 검색, 주차장 POI fallback
- Kakao Maps JavaScript API — 지도 표시
- 공공데이터포털 — 전국주차장정보표준데이터 (CSV 적재)
- 서울시 시영주차장 실시간 주차대수 API (일부 후보)

**Infra**

- AWS Lightsail (Ubuntu)
- Nginx (TLS 종료 + 정적 파일 + API 리버스 프록시)
- systemd (FastAPI uvicorn 데몬화)

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

각 `.env` 파일에 본인의 키를 채워 넣으세요. 실제 키는 절대 커밋하지 않습니다. (`.gitignore` 처리됨)

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

`.env.example` 기준 설명. **실제 값은 절대 README/Git 에 노출하지 마세요.**

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

키 관리 원칙은 [Security](#security) 섹션 참고.

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
       └─ systemd
           └─ parking-check-backend.service → uvicorn (FastAPI)
```

- Frontend 는 `npm run build` 산출물을 nginx 가 서빙
- Backend 는 systemd 유닛으로 데몬화 (자동 재시작)
- 배포는 git pull → frontend build → systemd restart 흐름

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
- ✅ 판단 중심 UI (최종 판단 카드, 1순위 추천 카드)
- ✅ Lightsail + Nginx + systemd 배포

**진행 중 / 다음**

- 🔄 웹 검색 / 후기 텍스트 기반 자체 주차 검증 정확도 개선
- 🔄 실제 도보 경로 API 연동 (현재는 직선 거리 기반 추정)
- 🔄 실시간 주차대수 API 통합 확장 (서울시 외 광역시)
- 🔄 UX 정리 (지도 마커 클릭 시 바텀시트, 카피 다듬기)

---

## Security

- 실제 API 키는 **절대 GitHub 에 올리지 않습니다**.
- `.env`, `backend/.env`, `frontend/.env` 는 `.gitignore` 처리됩니다.
- 키가 노출되면 즉시 Kakao Developers / 서울 OpenAPI / Anthropic 콘솔에서 **재발급**합니다.
- Kakao REST API Key 는 백엔드에서만 사용합니다 (브라우저 노출 금지).
- Kakao JavaScript Key 는 Kakao Developers 에서 도메인 제한을 반드시 설정합니다.
- DB 비밀번호는 `.env` 에만 두고 어떤 로그/출력에도 포함하지 않습니다.

자세한 가이드: [docs/SECURITY.md](docs/SECURITY.md)

---

## Future Work

- **서울시 실시간 주차대수 API 통합** — 실시간 잔여면수가 있는 후보는 "여유 / 보통 / 만차 위험" 라벨로 사용자에게 더 명확한 신호 제공
- **방문 로그 기반 개인화** — 자주 가는 매장의 과거 결과 (성공/실패율) 를 다음 검색 시 우선 표시
- **실제 도보 경로 연동** — OpenStreetMap 또는 카카오 도보 경로 API 로 직선 거리 → 실 경로 거리 전환
- **모바일 PWA 개선** — 오프라인 캐시 정책, 홈 화면 아이콘/스플래시, push 알림 (만차 알림 등)
- **App Store / Play Store 배포 검토** — TWA / Capacitor 등으로 PWA → 네이티브 wrapping

---

## Documentation

- [아키텍처](docs/ARCHITECTURE.md)
- [API 명세](docs/API.md)
- [DB 스키마](docs/DB_SCHEMA.md)
- [환경 설정](docs/SETUP.md)
- [보안 가이드](docs/SECURITY.md)
- [QA 체크리스트](docs/QA.md)
- [구현 태스크](docs/TASKS.md)
