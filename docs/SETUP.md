# SETUP

## 1. 사전 요구사항

- macOS / Linux
- Python 3.11
- Node.js 20 + npm
- PostgreSQL 17 + PostGIS 3 (Homebrew 의 `postgis` 포뮬러는 PG17 빌드로 설치된다. PG16 에 PostGIS 를 붙이려면 PG16용 PostGIS 를 별도 빌드해야 하므로, 로컬은 PG17 로 통일하는 것을 권장.)
- (옵션) Docker / Docker Compose

## 2. 저장소 클론

```bash
git clone <repo-url> parking
cd parking
```

## 3. 환경변수 설정

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`.env`, `backend/.env`, `frontend/.env` 에 실제 키를 채운다. 이 파일들은 `.gitignore` 로 막혀 있으니 절대 커밋하지 말 것.

채워야 하는 값:

- `KAKAO_REST_API_KEY` (`.env`, `backend/.env`) — Kakao Developers
- `VITE_KAKAO_JAVASCRIPT_KEY` (`frontend/.env`) — Kakao Developers
- `DATABASE_URL` (`.env`, `backend/.env`) — **필수**. 누락 시 백엔드 부팅이 ValidationError 로 즉시 실패한다. Homebrew 로컬용 / docker-compose 용 두 형태 중 하나를 주석에서 골라 쓴다.
- `SEOUL_OPENAPI_KEY` (선택) — 서울 열린데이터광장

## 4. PostgreSQL + PostGIS

### 4-A. Homebrew (로컬)

```bash
brew install postgresql@17 postgis
brew services start postgresql@17
# PATH 에 postgresql@17 의 psql 이 먼저 잡히도록(선택):
#   echo 'export PATH="/usr/local/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc

createdb parking
psql -d parking -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d parking < backend/db/init.sql
```

> 참고: PostGIS 확장 파일은 `postgis` 포뮬러가 설치한 PG 버전(현재 PG17)의 `share/extension/` 아래에만 들어간다. `postgresql@16` 서버를 띄워둔 상태에서 `CREATE EXTENSION postgis` 를 시도하면 "extension control file ... not found" 로 실패한다. 둘 다 설치되어 있다면 `postgresql@17` 만 `brew services start` 로 띄울 것.

확인:

```bash
psql -d parking -c "SELECT version();"           # PostgreSQL 17.x 이어야 함
psql -d parking -c "SELECT PostGIS_Version();"   # 3.6.x
psql -d parking -c "\dt"                         # places, parking_lots, ... 노출
```

스키마 적용 후 좌표/지오메트리가 정상인지 한 줄 검증:

```bash
psql -d parking -c "SELECT ST_AsText(ST_SetSRID(ST_MakePoint(127.0,37.5),4326));"
```

### 4-B. docker-compose

```bash
docker compose up -d db
```

컨테이너 최초 부팅 시 `backend/db/init.sql` 이 자동 실행되어 PostGIS 확장과 테이블이 생성된다.

## 5. Python venv + 백엔드 의존성

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## 6. 백엔드 실행

```bash
cd backend
source .venv/bin/activate
python -m uvicorn app.main:app --reload --port 8000
```

확인:

```bash
curl http://localhost:8000/api/health
```

## 7. 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

브라우저: http://localhost:5173

## 8. Kakao Developers 도메인 등록

Kakao Developers → 내 애플리케이션 → 플랫폼 → Web 사이트 도메인:

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:5174` (Vite 가 5173 을 못 잡으면 fallback)
- `http://127.0.0.1:5174`

미등록 시 SDK script 가 onerror 로 떨어진다.

## 9. (선택) 공공데이터 주차장 CSV 적재

```bash
# https://www.data.go.kr/data/15012890/standard.do 에서 다운로드
# backend/scripts/data/parking.csv 로 저장 (이 디렉토리는 Git 제외)

cd backend
source .venv/bin/activate
python scripts/load_parking_csv.py scripts/data/parking.csv

psql -d parking -c "SELECT COUNT(*) FROM parking_lots;"
```
