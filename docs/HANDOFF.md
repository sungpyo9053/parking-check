# parking-check — 인계 / GPT 프롬프트

> 이 문서는 GPT/Claude 등 다른 AI에 컨텍스트를 넘길 때 그대로 붙여 넣어도 되도록 작성했다.
> 시크릿(API 키 / DB password / .env 본문 / SSH private key)은 절대 포함하지 않는다.

---

## 1. 프로젝트 한 줄 정의

서울/수도권/전국 임의 목적지를 검색했을 때 **"여기 자체 주차 되나? 안 되면 어디 대지?"** 한 가지 질문에 답하는 개인용 PWA. FastAPI + PostgreSQL/PostGIS 백엔드 + React/Vite 프론트 + Kakao Maps/Local API + Tavily Web Search.

라이브: **https://reviewdr.kr** (HTTP/IP `http://3.34.133.24` 도 살아있음).

---

## 2. 인프라 / 운영 현황 (2026-05-17)

| 항목 | 값 |
|---|---|
| 도메인 | reviewdr.kr (HTTPS, Let's Encrypt ECDSA, ~2026-08-11 valid) |
| IP | 3.34.133.24 (AWS Lightsail, Debian 12) |
| RAM / Swap | 447MB / 2GB (`/swapfile` 1GB + `/swapfile2` 1GB) |
| DB | PostgreSQL 15.18 + PostGIS 3.3.2 (DB=`parking`, USER=`parking`) |
| Backend | systemd `parking-check-backend` → uvicorn `127.0.0.1:8000` |
| Frontend | Vite SPA 빌드물 (`/home/admin/parking-check/frontend/dist`), Nginx 정적 서빙 |
| Reverse Proxy | Nginx 1.22.1 — `/api/` → `:8000`, 그 외 SPA fallback |
| 외부 API | Kakao Local (keyword/category PK6), Tavily Search (월 1k 무료) |
| 배포 경로 | `/home/admin/parking-check` (admin 계정) |
| GitHub | https://github.com/sungpyo9053/parking-check |
| SSH | `ssh -i ~/Downloads/LightsailDefaultKey-ap-northeast-2.pem admin@3.34.133.24` |
| 백업 폴더 | `/home/admin/backup-before-parking-check-20260517-061828` (이전 review-doctor/stampport/startmate 보관) |
| 카카오 등록 도메인 | `https://reviewdr.kr`, `http://reviewdr.kr`, `http://3.34.133.24` (www.* 은 DNS 없음) |

**중요한 운영 사실**:
- `parking_lots` 테이블은 **비어있음** (공공데이터 임포트 안 됨). 모든 추천은 Kakao Local + Tavily 결과에 100% 의존.
- `places` 테이블만 사용자 검색에 따라 누적 (Kakao 검색 결과 upsert).
- `WEB_SEARCH_ENABLED=true`, `TAVILY_API_KEY` 설정됨.
- PWA Service Worker 는 `registerType: "autoUpdate" + skipWaiting + clientsClaim` — 사용자 새로고침 한 번이면 새 번들 즉시 적용.

---

## 3. 디렉토리 구조 (요지)

```
parking-check/
├── backend/
│   ├── pyproject.toml            # fastapi/uvicorn/sqlalchemy/geoalchemy2/httpx/pydantic-settings
│   ├── db/init.sql               # 멱등 schema (places/parking_lots/parking_realtime_status/parking_visit_logs/parking_feedbacks/place_self_parking_feedback)
│   └── app/
│       ├── config.py             # pydantic Settings (KAKAO_REST_API_KEY/DATABASE_URL/CORS/TAVILY/WEB_SEARCH_ENABLED)
│       ├── db.py / main.py
│       ├── models/               # SQLAlchemy ORM
│       ├── schemas/parking.py    # AnalyzeResponse / SelfParking / ExternalCandidate / FallbackInfo / TopRecommendation
│       ├── routers/              # health / places / parking / visits
│       └── services/
│           ├── kakao.py                # search_keyword / search_keyword_near / search_parking_nearby(PK6)
│           ├── web_parking_search.py   # Tavily 호출 + 쿼리 빌드
│           ├── parking_fallback.py     # DB → Kakao(PK6 → keyword) → Web 폴백 체인
│           ├── parking_classifier.py   # usable/caution/private_restricted 분류
│           ├── self_parking_web.py     # web evidence + 카테고리 prior → self_parking enrich
│           ├── external_recommender.py # 외부 후보 가중치 → top_recommendation 1개
│           ├── recommendation.py       # DB 후보 점수 + 혼잡도
│           ├── self_parking.py         # DB 부설주차장 매칭 (base)
│           └── parking_search.py       # ST_DWithin nearby_parking_lots
└── frontend/
    └── src/
        ├── lib/{api.ts, kakao.ts, maps.ts}
        ├── components/{KakaoMap, ParkingCard, ExternalCard, RiskBadge}
        └── pages/{HomePage, PlaceSelectPage, AnalysisPage, VisitListPage, VisitLogPage}
```

---

## 4. 분석 응답 데이터 흐름

요청: `GET /api/parking/analyze?place_id=...&radius=500`

1. **DB 부설 검색** (`estimate_self_parking`): 목적지 좌표 80m 이내 부설주차장 → base self_parking
2. **Web evidence + 카테고리 prior** (`enrich_self_parking`):
   - Tavily 결과의 title/snippet 에서 positive/negative 키워드 매칭 → web_score
   - Kakao places category 기반 prior (백화점 +60, 시장 -35 등)
   - 합산 ≥55 → `likely`, ≥25 → `uncertain`, ≤-55 → `unavailable`
   - reason + evidence 5건(snippet+matched keywords+url) + warning 첨부
3. **외부 후보 폴백** (`collect_external_candidates`):
   - DB 후보 < 3 이면 Kakao PK6 + keyword(`{목적지명} 주차`) 좌표 기반
   - DB+Kakao 합산 < 1 이거나 self_parking=unknown 이면 Tavily 호출 (활성 시)
   - 각 Kakao 결과를 `classify_kakao_parking` 으로 usable/caution/private_restricted 분류
   - private_restricted 는 `excluded_items` 로 분리
4. **최우선 추천** (`pick_top_external`):
   - self_parking ∈ {available, likely} 이면 `top_recommendation = None` (자체로 결정)
   - 그 외엔 외부 후보 가중치 1위 1개
5. **응답**: `{ destination, self_parking, summary, candidates, external_candidates, top_recommendation, fallback, history_for_destination, disclaimers }`

---

## 5. 핵심 가중치 룰 (현재값)

### `self_parking_web.POSITIVE_KEYWORDS` (단어가 evidence 안에 있을 때)
| 키워드 | 점수 | 의도 |
|---|---|---|
| 전용주차장 / 전용 주차 | +40 | 명확한 자체 시그널 |
| 건물 주차장 | +35 | 건물 자체 |
| 매장 앞 주차 / 바로앞 주차 / 매장앞 주차 | +30 | 자체 시그널 |
| 지하 주차장 / 지하주차장 | +25 | 강한 시그널 |
| 무료 주차 / 무료주차 | +25 | 자체 추정 강 |
| 옥상 주차 | +20 | 자체 시그널 |
| 주차 여러대 / 주차공간 있음 / 주차공간 많 | +15~20 | 중간 |
| 주차장 있 | +15 | 중간 |
| 주차 가능 / 주차가능 / 주차공간 | **+8** | 인근/자체 구분 불가 — 약함 |

### `NEGATIVE_KEYWORDS`
| 키워드 | 점수 |
|---|---|
| 주차 불가 / 주차불가 | -50 |
| 주차장 없음 / 주차장이 없 | -40~-45 |
| 주차 어려 / 힘들 / 힘듦 / 안 됨 / 안됨 | -30~-35 |
| 인근 공영주차장 이용 / 근처 공영주차장 이용 | -45 |
| 인근 공영주차장 / 근처 공영주차장 / 주변 공영주차장 | -30~-35 |
| 인근 민영/유료주차장 / 인근 주차장 이용 / 근처 주차장 이용 | -30~-40 |
| 공영주차장 추천 / 주차장 추천 / 주차장 이용 권장 | -25~-40 |
| 공영 이용 / 민영 이용 | -25 |

**Contextual 보정**: 한 evidence 안에 negative ≤ -25 가 있으면 positive 점수의 절반을 깎는다 ("인근 공영 이용 가능 ... 건물에도 주차 가능" 같이 인근 안내에 묻힌 약한 자체 시그널 무력화).

### `category_prior` (카카오 places.category 기반)
| 카테고리 키워드 | 점수 |
|---|---|
| 백화점 / 쇼핑몰 / 복합쇼핑 / 아울렛 | +55~60 |
| 할인점 / 대형마트 | +50 |
| 마트 / 박물관 / 전시관 | +25~30 |
| 리조트 / 호텔 / 테마파크 / 놀이공원 / 수족관 | +30~50 |
| 휴양림 | +40 |
| 전통시장 / 재래시장 / 시장 | -35~-40 |
| 골목시장 | -35 |
| 테마거리 / 한옥거리 | -35 |
| 한옥마을 / 거리 / 도예촌 | -20~-30 |
| 교회 / 성당 / 사찰 | -30~-35 |
| 지하상가 | -35 |
| 공원 | -15 |
| 관광명소 / 유적지 / 사적지 | -15~-25 |

### `external_recommender.score_external` (Kakao/Web 후보 점수)
- usable +60, caution +10, private_restricted = -999 (자동 제외)
- 거리: 0m → +40, 1000m → 0 (선형 감산)
- 카테고리 보너스: 공영주차장 +20, 노상공영 +12, 공원 +8, 주차타워 +4, 민영/유료 +5
- 알려진 개방 운영사 (나이스파크/AJ파크/윌슨파킹/...) +12
- source: public_db +20, kakao_fallback 0, web_search -20
- 복잡도 페널티: 비공영 타워/지하 -5, 옥상 -3

### `parking_classifier.classify_kakao_parking` (Kakao POI → tier)
- **usable**: 목적지명 일치 / 공영주차장 / 알려진 개방 운영사 / 민영·유료 일반 개방
- **private_restricted**: 전용주차장/고객전용/직원전용/입주자전용/교회/성당/사찰/선원/아파트/빌라/오피스텔/병원/학교/어린이집/유치원, **또는** 식당·카페 브랜드명 + "전용" 결합, **또는** 식당·카페 브랜드명 단독
- **caution**: 그 외 일반 '주차장' 카테고리 (보수적)
- 단 "공영" 단어 동반 시 제한 키워드를 무효화

---

## 6. 검증된 케이스 (라이브 호출 결과)

| 목적지 | 자체 status | top_recommendation |
|---|---|---|
| 더홈 (안양, 카페) | `likely` 76점, evidence 5건 네이버 블로그 ("매장 앞 / 주차공간 많" 등) | None (자체로 결정) |
| 이재모피자 본점 (부산) | `unavailable` 60점, evidence 3건 ("인근 공영주차장 이용 가능" / "용두산공영주차장 추천") | 광일공영주차장 180m, 도보 3분 |
| 수유전통시장 | `unknown` (시장 카테고리 prior 적용 안 됨, evidence 부족) | 수유마을시장공영주차장 142m, 도보 3분 (score 112.3) |
| 더현대 서울, 스타필드 하남, 코엑스, 롯데월드몰, 롯데백화점, DDP | 모두 `likely` 67~89점 (카테고리 prior 만으로 격상) | None |
| 광장시장, 명동성당 | 여전히 `likely` 가 가끔 나옴 (false positive) — 추가 룰 필요 | None |

20 POI 큐레이션 검증 정확도: **exact + partial = 57.9%**, 자체 있음 recall **80%**, 자체 없음 recall 33% (시장/관광지 prior 보완 직후라 다시 측정 필요).

100 POI (카카오 "맛집" 검색 자동) 검증은 GT 라벨 부재로 정량 일치율 측정 불가. 예측 분포만: likely 16% / uncertain 31% / unavailable 24% / unknown 28%. unavailable 22개 모두 인근 공영/유료 주차장이 top_recommendation 으로 자동 잡힘 (사용자 체감 OK).

---

## 7. 현재 진행 중 (= 다음 작업 = 인계 시작점)

사용자 요구에 따라 다음 두 개를 **동시 진행 중**:

### 7-1. 자체 주차 사용자 피드백 누적 (실제 GT 수집)
- 신규 테이블 `place_self_parking_feedback (place_id, answer 'yes|no|unknown', note, user_token, created_at)`
- 신규 모델 `models/self_parking_feedback.py:PlaceSelfParkingFeedback`
- 신규 API: `POST /api/places/{place_id}/self-parking-feedback` (body: `{answer, note?}`)
- 신규 API: `GET /api/places/{place_id}/self-parking-feedback/summary` (yes/no/unknown count)
- frontend AnalysisPage 자체주차 카드 아래 작은 위젯: `[✓ 있음] [✗ 없음] [? 모름]` 버튼 + 누적 카운트 표시
- 익명 클라이언트 토큰: localStorage 의 UUID 1회 발급

### 7-2. 시장 안 식당 검증 데이터셋
- 5대 시장 × 10개 식당 큐레이션:
  - 광장시장 (서울 종로): 박가네빈대떡, 마약김밥, 미진, 광장순대국, 광장빈대떡 등
  - 망원시장 (서울 마포): 망원시장 칼국수, 망원시장 닭강정, 등
  - 통인시장 (서울 종로): 통인시장 도시락카페, 통인시장 떡볶이 등
  - 부평시장 (인천): 부평시장 칼국수, 부평시장 만두 등
  - 서문시장 (대구): 서문시장 칼국수, 서문시장 손만두 등
- 각 식당에 대해 `top_recommendation.candidate.name` 이 `"{시장이름}공영주차장"` 형태인지 매칭률 측정
- 스크립트: `scripts/validate_market_food.py`

### 7-3. 기존 진행 작업
- `scripts/collect_popular_pois.py` (전국 14 시드 좌표에서 카카오 "맛집" 100개 수집)
- `scripts/validate_popular.py` (위 100개를 우리 시스템으로 분석 + 카테고리 휴리스틱 GT 비교)
- 출력: `/tmp/popular_pois_100.json`, `/tmp/popular_validation.json`
- ← classifier 가 카카오 카테고리 휴리스틱으로 음식점을 모두 'unknown' GT 로 분류해 정량 일치율 측정 불가. 큐레이션 GT (위 7-2) 가 더 의미 있음.

---

## 8. 알려진 한계 + TODO (우선순위 순)

1. `parking_lots` 비어있음 → 서울시 공공데이터 / 한국교통안전공단 데이터 임포트
2. 카카오 도보 길찾기 REST API 는 제휴 파트너 전용 → 현재는 직선거리 기반 도보 분 (70m/min, ceil) 만 표시 + 카카오맵 도보 길찾기 외부 링크. 제휴 가능 시 실제 경로/시간 계산 적용
3. 자체 주차 LLM 요약: 현재 evidence 정리는 rule-based. 추후 OpenAI/Claude 로 evidence 묶음 → 자연어 요약 1~2문장 생성
4. 광장시장/명동성당 false_positive 잔여 → evidence 내 destination 이름 매칭이 너무 관대. negative regex 강화 필요
5. 시장 안 식당 case 의 top_rec 매칭률 측정 (7-2 진행)
6. 사용자 피드백 누적 후 GT 기반 정량 정확도 측정 (7-1 진행)
7. 추천 점수에 이용 후기 빈도 / 평점 추가 (Tavily 호출 비용 발생 — 보류)
8. www.reviewdr.kr DNS + cert 확장 (사용자 결정)

---

## 9. 작업 시 절대 원칙

- **시크릿 절대 출력 금지**: KAKAO_REST_API_KEY / VITE_KAKAO_JAVASCRIPT_KEY / TAVILY_API_KEY / DB password / .env 본문 / SSH key 본문. 길이만 보고하거나 마스킹.
- **자동 진행**: 사용자 확인 안 받고 합리적 판단으로 진행. 단, 위험한 삭제(rm -rf, DROP TABLE, force push, /home·/opt 광역 삭제)는 금지.
- **풀세트 배포 흐름**: 코드 변경 시 한 번에 — 로컬 수정 → 로컬 테스트 → git commit → push → 서버 git pull → backend restart(필요 시) → frontend build → nginx reload → health check → 완료 보고.
- **응답 짧게**: 결과 위주, 표/리스트 활용. 분석/사과/계획 길게 늘어놓지 말 것.
- **단정 금지**: 실시간 가용성/운영시간은 항상 "확인 필요" 라벨.

---

## 10. 환경변수 (값은 비공개)

backend/.env 필수:
- `KAKAO_REST_API_KEY`
- `DATABASE_URL=postgresql+psycopg2://parking:<DB_PASSWORD>@localhost:5432/parking`
- `BACKEND_BASE_URL=https://reviewdr.kr`
- `FRONTEND_BASE_URL=https://reviewdr.kr`
- `CORS_ORIGINS=https://reviewdr.kr,http://reviewdr.kr,http://3.34.133.24,http://localhost:5173,http://127.0.0.1:5173`
- `TAVILY_API_KEY`
- `WEB_SEARCH_ENABLED=true`

frontend/.env 필수:
- `VITE_KAKAO_JAVASCRIPT_KEY`
- `VITE_BACKEND_BASE_URL=https://reviewdr.kr`

---

## 11. 한 줄 인계

> 이 프로젝트는 "임의 목적지의 자체 주차 가능성을 웹 evidence + 카테고리 prior 로 판단하고, 안 되면 외부 후보 중 가중치 1위 주차장을 추천하는" PWA다. 현재 사용자 피드백 누적 테이블 + 시장 안 식당 검증 스크립트를 동시 진행 중이며, 모든 변경은 한 응답 안에 풀세트 배포까지 끝낸다. 시크릿은 절대 채팅에 노출하지 않는다.
