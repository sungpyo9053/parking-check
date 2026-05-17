# QA 체크리스트

수동 점검 항목. 위에서 아래로 순서대로 통과해야 한다.

## 1. Health check

```bash
curl -i http://localhost:8000/api/health
```

기대:

- HTTP 200
- 응답 본문에 `db` 필드가 `"ok"` 로 표시

## 2. Places search (Kakao Local API + DB upsert + PostGIS geom)

```bash
curl --get "http://localhost:8000/api/places/search" --data-urlencode "query=화계역"
```

기대:

- HTTP 200, JSON 응답
- `items[]` 각 항목에 `external_source`, `external_id`, `place_id`, `name`, `address`, `road_address`, `category`, `lat`, `lng` 포함

DB 확인:

```bash
psql -d parking -c "SELECT id, name, lat, lng, ST_AsText(geom) FROM places ORDER BY id DESC LIMIT 5;"
```

기대:

- 방금 검색한 장소들이 `places` 에 적재되어 있음
- `geom` 컬럼이 `POINT(lng lat)` 로 정상 출력 (NULL 이면 실패 — `places.geom` 은 GENERATED ALWAYS)

## 3. CORS preflight

```bash
for origin in http://localhost:5173 http://127.0.0.1:5173 http://localhost:5174 http://127.0.0.1:5174; do
  echo "--- $origin ---"
  curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -X OPTIONS 'http://localhost:8000/api/places/search?query=test&size=10' \
    -H "Origin: $origin" \
    -H 'Access-Control-Request-Method: GET' \
    -H 'Access-Control-Request-Headers: content-type'
done
```

기대:

- 네 Origin 전부 HTTP 200
- 응답 헤더에 `access-control-allow-origin`, `access-control-allow-methods`, `access-control-allow-headers`, `access-control-allow-credentials: true` 포함

실패 시: `.env` (루트 + `backend/`) 의 `CORS_ORIGINS` 확인 + 백엔드 재시작.

## 4. 프론트 검색 (브라우저)

1. `cd frontend && npm run dev`
2. 브라우저에서 http://localhost:5173 (또는 Vite 가 안내한 포트)
3. 검색창에 "화계역" 입력 → 후보 목록이 표시되어야 함
4. 후보 선택 → Kakao 지도에 마커 표시

실패 패턴:

- "Failed to fetch" → CORS 문제. (3) 다시 확인.
- "Kakao SDK 로드 실패" → Kakao Developers 의 Web 플랫폼 도메인에 현재 origin 등록 누락. 브라우저 콘솔의 `[Kakao SDK 로드 실패]` 로그에서 `origin` 확인 후 등록.
- "VITE_KAKAO_JAVASCRIPT_KEY가 비어 있음" → `frontend/.env` 의 키 미설정.

## 5. PostGIS geom 확인

```bash
psql -d parking -c "SELECT id, name, ST_AsText(geom), ST_SRID(geom) FROM places LIMIT 3;"
```

기대:

- `ST_SRID(geom)` = 4326
- `ST_AsText(geom)` = `POINT(<lng> <lat>)` 형태, NULL 이면 안 됨

## 6. Kakao SDK 로드 확인 (브라우저 콘솔)

분석 페이지 진입 후 DevTools → Network:

- `https://dapi.kakao.com/v2/maps/sdk.js?appkey=...&autoload=false&libraries=services` 응답 200
- DevTools → Console: `window.kakao.maps` 가 객체로 존재

실패 시 Console 에 `[Kakao SDK 로드 실패] { src, origin, event }` 로그가 떨어지므로 그 origin 을 Kakao Developers 에 등록.
