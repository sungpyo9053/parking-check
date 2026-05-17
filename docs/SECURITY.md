# SECURITY

## env 관리 원칙

1. **실제 키는 `.env` 계열 파일에만 둔다.** `.env`, `backend/.env`, `frontend/.env` 셋 다 `.gitignore` 로 차단되어 있다.
2. `.env.example` 파일들은 **값이 빈 템플릿**이다. 절대 실제 키를 넣지 말 것.
3. 코드 / docs / README 안에 키를 하드코딩하지 않는다.
4. 백엔드용 키와 프론트엔드용 키를 분리한다.
   - **Kakao REST API Key**: 백엔드에서만 사용. 브라우저에 노출되면 안 된다.
   - **Kakao JavaScript Key**: 프론트엔드에서 사용. 브라우저에 노출되지만, **Kakao Developers 의 Web 도메인 제한**으로 보호한다.
5. CI / 배포 환경에서는 env 를 시크릿 매니저나 환경변수로 주입한다. 절대 repository 에 넣지 않는다.

## 키 노출 시 조치

키가 GitHub / Slack / 채팅 / 로그 등에 노출됐다면 **즉시**:

1. **Kakao Developers** → 내 애플리케이션 → 앱 키 → "재발급" 으로 새 키 발급
2. **서울 OpenAPI** → 인증키 재발급
3. 로컬 `.env` 파일들에 새 키 반영
4. 배포 환경의 시크릿 갱신
5. 노출된 commit 이 GitHub 에 올라가 있으면 force push 로 지우는 것만으로는 부족하다 (cache, fork). 키 재발급이 유일한 안전 조치.

## GitHub 에 올리면 안 되는 파일 목록

다음은 `.gitignore` 로 차단되어 있어야 한다. 커밋 전 항상 확인.

| 경로 | 사유 |
|------|------|
| `.env` | 실제 키 |
| `backend/.env` | 실제 키 |
| `frontend/.env` | 실제 키 |
| `deploy.local.env`, `.env.server`, `.env.deploy` | 배포용 시크릿 |
| `backend/.venv/`, `.venv/` | Python 가상환경 (대용량 + 머신 의존) |
| `frontend/node_modules/`, `node_modules/` | npm 의존성 (대용량) |
| `__pycache__/`, `*.egg-info/` | Python 캐시 |
| `frontend/dist/`, `dist/`, `build/` | 빌드 산출물 |
| `backend/scripts/data/*.csv`, `*.xlsx`, `*.json` | 공공데이터 원본 (대용량) |
| `*.log`, `*.pem`, `*.key` | 로그 / 인증서 / 비밀키 |
| `.DS_Store` | macOS 부산물 |
| `postgres_data/` | Docker volume |
| `.claude/` | Claude Code 세션 |

## 커밋 전 체크

```bash
# 어떤 파일이 staging 되는지 확인
git status
git diff --cached --name-only

# 실제 키가 들어가지 않았는지 패턴 검사
grep -RE "KAKAO_REST_API_KEY=.+[A-Za-z0-9]" --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv .
grep -RE "VITE_KAKAO_JAVASCRIPT_KEY=.+[A-Za-z0-9]" --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv .
```

위 두 grep 의 결과는 `.env.example` 처럼 값이 비어 있는 줄만 나와야 한다 (`KEY=` 다음에 아무것도 없음).

## Kakao JavaScript Key 도메인 제한

JS 키는 빌드 산출물에 그대로 박히므로 누구나 볼 수 있다. 보호의 유일한 수단은 **Kakao Developers → 플랫폼 → Web 사이트 도메인** 등록이다. 등록되지 않은 origin 에서 호출하면 SDK 가 거부한다. 운영 도메인을 정확히 등록하고, dev origin (`localhost:5173` 등) 도 함께 등록한다.
