# 아키텍처 및 유지보수 가이드

이 문서는 코드를 고치려는 사람이 가장 먼저 읽는 문서다.
UI 시각 규칙은 [DESIGN.md](../DESIGN.md), 배포 절차는 [CLOUDFLARE_DEPLOYMENT.md](../CLOUDFLARE_DEPLOYMENT.md)를 본다.

## 계층 구조

요청은 위에서 아래로만 흐른다. 역방향 import는 금지.

```
src/index.js            진입점: fetch 핸들러, 공개 경로, 미들웨어(세션·CSRF·보안헤더·에러로깅)
  └─ src/handlers/      인증 후 라우트 분배와 도메인별 요청 처리 (viewer, document, rack, set, admin)
       ├─ src/html.js   뷰 계층 배럴  → src/views/*  (페이지 템플릿, CSS, 클라이언트 스크립트)
       └─ src/db.js     데이터 계층 배럴 → src/data/*  (D1 질의·변경, 검색, 감사로그)
            └─ 공용 리프 모듈: searchCore.js, utils.js, documentRules.js, auth.js, security.js, config.js, routes.js, documentCsv.js
```

**배럴 규칙**: 계층 밖에서는 반드시 배럴(`html.js`, `db.js`)로 import한다.
계층 안(예: `views/` 모듈 간)에서는 직접 import한다. 공개 계약을 검증하는 테스트는 배럴을 사용한다.
직렬화·SQL 순서처럼 내부 불변식을 고정하는 화이트박스 테스트만 목적을 테스트명에 명시하고 리프 모듈을 직접 import할 수 있다.

## 디렉터리 지도

| 위치 | 역할 |
|---|---|
| `src/index.js` | Worker 진입점. 공개 경로와 인증·보안 미들웨어를 순서대로 실행한 뒤 인증 라우터에 위임 |
| `src/handlers/` | `authenticatedRouter.js`의 인증 후 라우트 표와 도메인 핸들러. `documents/`는 목록·CRUD·폐기 책임을 분리하고 `documentHandlers.js`가 호환 façade를 제공 |
| `src/views/` | `layout.js`(페이지 셸·공용 조각) · `styles.js`/`styles/`(CSS façade와 순서별 조각) · `clientScript.js`/`clientScript/`(전역 JS façade와 동작 조각) · `searchFragments.js`(검색창·칩·하이라이트) · 문서 표·위치 선택·도메인별 페이지 |
| `src/data/` | `sqlShared.js`(공용 SQL 조각) · `searchFilters.js`(필터 파싱·WHERE) · `searchAnalytics.js`(클릭·로그) · `documentMutations.js`(문서 쓰기·감사 batch) · 도메인별 읽기/조회. SQL은 전부 바인딩 파라미터 |
| `src/searchCore.js` | 검색 코어(오타 허용·초성·자판 보정·스코어링). **서버와 브라우저가 같은 소스를 쓴다** |
| `src/documentRules.js` | 화면·CSV가 공유하는 문서 필수값·텍스트 길이 규칙. D1·런타임 API에 의존하지 않는 순수 검증 |
| `src/auth.js` | 인증 공개 façade. 세션·PBKDF2·로그인 시도 제한 구현은 `src/auth/`에 분리하며, Workers와 Node 양쪽에서 사용하는 Web API 호환성을 유지 |
| `src/security.js` | 보안 헤더 + CSP. HTML은 `page()`가 nonce CSP를 직접 설정, 그 외 응답은 폴백 CSP |
| `migrations/` | D1 스키마 이력. **append-only** — 과거 파일 수정 금지, 변경은 항상 새 번호로 |
| `tests/` | node:test 단위·통합·계약 테스트. 공개 계약은 배럴, 명시적인 내부 불변식 테스트만 리프 경로로 import |

## 절대 깨면 안 되는 불변식

1. **searchCore 자기완결성**: `createSearchCore()`는 외부 스코프·다른 모듈·런타임 API를 참조하면 안 된다.
   `views/clientScript.js`가 `createSearchCore.toString()`으로 소스를 브라우저에 그대로 내려보내기 때문이다.
   같은 방식으로 `utils.escapeHtml` 소스도 클라이언트에 주입된다(이스케이프 규칙 단일 출처).
   toString()으로 직렬화하는 함수를 추가하면 esbuild `__name` shim(`window.__name = ...`)을 함께 보내야 한다.
2. **CSP nonce 파이프라인**: 모든 인라인 `<script>`/`<style>`은 `views/layout.js`의 `page()`를 거쳐야 한다.
   `page()`가 응답마다 nonce를 만들어 태그에 주입하고 CSP 헤더를 설정한다. 우회하면 브라우저가 조용히 차단한다.
3. **D1 배치 규율**: D1에는 트랜잭션이 없고 `env.DB.batch()`가 유일한 원자성 수단이다.
   다중 문장 불변식은 한 배치 안의 조건부 문장으로 인코딩한다 — 로그 INSERT는 `SELECT ... FROM documents WHERE <가드>`로
   사전 상태를 검증하고, UPDATE는 `updated_at = ?` 낙관적 잠금을 쓰며, 감사 INSERT가 DELETE보다 먼저 온다.
   `tests/db.test.js`가 배치 개수·문장 순서·가드 SQL을 고정하고 있으므로 형태 자체를 보존해야 한다.
4. **랙 면 표기 규칙의 단일 출처는 searchCore다**: 단면 랙 "13", 양면 랙 "13-1"/"13-2" (저장값은 A/B).
   `utils.rackFaceLabel`은 위임만 한다. 규칙을 바꾸려면 searchCore 안의 사본과 함께 바꾼다.
5. **1구역 서가 방향 규칙**: 도면 위쪽은 벽면이고, 선반은 아래→위 1~6이다. 열은 통로 안쪽부터 센다.
   양면 랙의 좌측 면은 화면 왼쪽이 1열, 우측 면은 화면 오른쪽이 1열이다. 1번 단면랙은 우측 랙과
   같은 방향으로 화면 오른쪽이 1열이다. DB의 `column_number`는 바꾸지 않고 정면도 렌더 순서만 미러링한다.
6. **무료티어 subrequest 예산**: CSV 가져오기의 행 상한(기본 50)은 요청당 D1 배치 한도에 맞춘 값이다
   (`config.js`). 반복문 안에서 D1을 부르는 코드를 추가할 때는 이 예산을 계산에 넣는다.
7. **최초 관리자와 비밀번호 변경**: `0027` migration이 초기 관리자를 등록하고 `must_change_password=1`을 둔다.
   세션의 값만 믿지 않고 매 요청 DB 상태를 다시 읽으며, 해제 전에는 비밀번호 변경과 로그아웃 외 기능으로 이동할 수 없다.
   공개 `/signup`은 404이고 추가 계정 등록 UI는 별도 구현 전까지 열지 않는다.

## 알려진 의도적 중복

- **즉시 검색 클라이언트 템플릿**(`views/clientScript.js`의 instantRow/instantAnswer)과
  **서버 렌더 템플릿**(`views/searchViews.js`의 answerCard/viewerDocumentCard)은 같은 화면을 각자 렌더링한다.
  우세 답변 판정은 searchCore의 공통 정책을 사용하지만 마크업은 두 곳에 남아 있으므로 변경할 때 **두 곳을 함께** 고친다.
- searchCore 내부의 `clean`/불리언 판정은 utils와 중복이지만 자기완결성 때문에 의도된 사본이다.

## 작업 절차

새 페이지 추가: `views/<도메인>Views.js`에 템플릿(항상 `page()`로 감싼다) → `html.js` 배럴에 export 추가
→ `handlers/`에 핸들러 → `authenticatedRouter.js` 라우트 표에 연결. 공개·인증 전 경로만 `index.js`에 둔다.

스키마 변경: `migrations/00XX_*.sql` 새 파일 → `npm run db:migrate:local`로 로컬 적용·확인 → 배포 시 원격 적용.
초기 관리자도 migration으로 등록하며 수동 SQL은 사용하지 않는다.

검증·배포:
```powershell
npm run check     # src/·scripts/ 전체 문법 검사 (파일 추가 시 자동 포함)
npm test          # node:test 전체
npm run dev       # http://localhost:8787 (.dev.vars 필요)
```
배포는 main 푸시 시 GitHub Actions가 자동 수행(migration → deploy)하며,
D1 주간 백업도 Actions(`d1-backup.yml`)가 수행한다. 수동 배포는 CLOUDFLARE_DEPLOYMENT.md 참고.
