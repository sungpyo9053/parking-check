# 주차될까 / Parking Check

## 개요

목적지를 입력하면 주변 주차장 후보를 찾고, 주차 가능성/혼잡도/자체 주차 가능성을 확인한 뒤, 실제 주차 성공/실패 결과를 기록하는 개인용 주차 판단 PWA.

초기 목적은 앱스토어 배포가 아니라, 사용자가 직접 써보면서 실제 주차 경험 데이터를 쌓는 것이다.

## 핵심 기능

- 목적지 검색
- Kakao Local API 기반 장소 검색
- Kakao Maps JavaScript SDK 지도 표시
- PostgreSQL + PostGIS 기반 주변 주차장 반경 검색
- 목적지 자체 주차 가능성 추정
- 주변 주차장 추천
- 방문 로그 저장
- 실제 결과 기록
  - 주차 성공
  - 만차
  - 대기 후 성공
  - 입구 못 찾음
  - 요금 정보 다름
  - 운영 안 함
- 같은 장소 재검색 시 과거 기록 표시

## 기술 스택

Frontend:
- React 18
- Vite + TypeScript
- vite-plugin-pwa

Backend:
- FastAPI
- SQLAlchemy 2.0 (sync) + GeoAlchemy2
- Pydantic / pydantic-settings

Database:
- PostgreSQL 16
- PostGIS 3

External APIs:
- Kakao Local API (장소 검색)
- Kakao Maps JavaScript API (지도)
- 서울시 시영주차장 실시간 주차대수 API (추후 연동)
- 공공데이터포털 전국주차장정보표준데이터 (CSV 적재)

## 디렉터리 구조

```
parking/
├── README.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 엔트리포인트
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── models/              # SQLAlchemy 모델
│   │   ├── schemas/             # Pydantic 스키마
│   │   ├── routers/             # API 라우터 (health, places, parking, visits)
│   │   ├── services/            # 비즈니스 로직 (kakao, 추천, ...)
│   │   └── utils/
│   ├── db/init.sql              # PostgreSQL 초기화 (PostGIS + 테이블)
│   ├── scripts/                 # 데이터 적재/수집 스크립트
│   │   └── data/                # CSV/XLSX 원본 데이터 (Git 제외)
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── pages/               # 화면
│   │   ├── components/          # KakaoMap 등
│   │   ├── lib/                 # api 클라이언트, kakao 로더
│   │   └── hooks/
│   ├── public/manifest.webmanifest
│   ├── vite.config.ts
│   ├── package.json
│   └── .env.example
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md
    ├── DB_SCHEMA.md
    ├── SETUP.md
    ├── SECURITY.md
    ├── QA.md
    └── TASKS.md
```

## 환경변수 설정

실제 키는 `.env` 파일에만 넣고 GitHub에 올리지 않는다. (`.gitignore`로 막혀 있다.)

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

필요한 값:

- `KAKAO_REST_API_KEY` — 백엔드, Kakao Local API 호출용
- `VITE_KAKAO_JAVASCRIPT_KEY` — 프론트, Kakao Maps SDK 로드용
- `DATABASE_URL` — PostgreSQL 접속 문자열
- `CORS_ORIGINS` — 백엔드가 허용할 프론트 Origin (콤마 구분)
- `SEOUL_OPENAPI_KEY` — (선택) 서울 실시간 주차 API

## 카카오 Developers 설정

- Kakao REST API Key 는 **백엔드**에서만 사용 (브라우저에 노출 금지).
- Kakao JavaScript Key 는 **프론트엔드**에서 사용. 브라우저에 노출되므로 도메인 제한이 **필수**.
- Kakao Developers → 내 애플리케이션 → 플랫폼 → Web 사이트 도메인에 아래를 등록:
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - 필요 시 `http://localhost:5174` / `http://127.0.0.1:5174` (Vite 가 5173 을 못 잡았을 때 fallback)
- 도메인 미등록 시 SDK script 가 onerror 로 떨어지며 화면에 "Kakao SDK 로드 실패" 가 표시된다.

## DB 설정

Homebrew PostgreSQL + PostGIS 기준 예:

```bash
createdb parking
psql -d parking -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d parking < backend/db/init.sql
```

확인:

```bash
psql -d parking -c "SELECT PostGIS_Version();"
psql -d parking -c "\dt"
```

docker-compose 를 쓸 경우:

```bash
docker compose up -d db
# backend/db/init.sql 이 컨테이너 초기화 시 자동 실행됨
```

## 백엔드 실행

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

장소 검색 테스트:

```bash
curl --get "http://localhost:8000/api/places/search" --data-urlencode "query=화계역"
```

## 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

브라우저:

```
http://localhost:5173
```

## 주차장 CSV 적재

공공데이터 CSV 는 Git 에 올리지 않는다 (`.gitignore`로 제외됨).

다운로드: https://www.data.go.kr/data/15012890/standard.do

저장 위치:

```
backend/scripts/data/parking.csv
```

적재 예:

```bash
cd backend
source .venv/bin/activate
python scripts/load_parking_csv.py scripts/data/parking.csv
```

확인:

```bash
psql -d parking -c "SELECT COUNT(*) FROM parking_lots;"
```

## 현재 동작 확인 완료 항목

- `/api/health` → db ok
- Kakao Local API 장소 검색 성공 (`/api/places/search?query=...`)
- `places` 테이블 저장 성공
- PostGIS `geom` (GENERATED ALWAYS) 자동 생성 성공
- CORS preflight (`OPTIONS /api/places/search`) 4개 dev Origin 통과

## TODO

- 공공데이터 주차장 CSV 적재 자동화
- 서울시 실시간 주차대수 API 연동
- 주차장 추천 점수 개선
- 방문 로그 UX 개선
- PWA 아이콘/스플래시 추가
- 배포 자동화 (CI/CD)
- Alembic 마이그레이션 전환

## 보안 주의

- 실제 API 키는 **절대 GitHub 에 올리지 않는다**.
- `.env`, `backend/.env`, `frontend/.env` 는 커밋하지 않는다 (`.gitignore` 처리됨).
- 키가 노출되면 즉시 **Kakao Developers / 서울 OpenAPI 콘솔에서 재발급**한다.
- REST API 키는 백엔드에서만 사용한다.
- JavaScript 키는 도메인 제한을 반드시 설정한다.

## 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [API 명세](docs/API.md)
- [DB 스키마](docs/DB_SCHEMA.md)
- [환경 설정](docs/SETUP.md)
- [보안 가이드](docs/SECURITY.md)
- [QA 체크리스트](docs/QA.md)
- [구현 태스크](docs/TASKS.md)
