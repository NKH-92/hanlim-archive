# 한림 문서고 관리 시스템

사내 문서고 문서 검색·위치확인 시스템. Cloudflare Workers + D1, 순수 JS ESM(프레임워크 없음), 배포 대상은 `cloudflare-app/`.

## 명령 (cloudflare-app/ 에서)

```
npm run check   # src/·scripts/ 전체 문법 검사
npm test        # node:test 전체
npm run dev     # wrangler dev, http://localhost:8787 (.dev.vars 필요)
npm run db:migrate:local
```

변경 후에는 항상 `npm run check && npm test`. main 푸시는 GitHub Actions가 운영 배포까지 자동 수행하므로 주의.

## 구조와 규칙

- 계층: `index.js` → `handlers/` → 도메인 공개 `index.js`/`readModels/`/`views/` → platform/shared.
  삭제된 전역 `db.js`/`html.js`/`utils.js` façade를 다시 만들지 않는다. 상세는 `docs/ARCHITECTURE.md` — **코드 수정 전 필독**.
- 깨면 안 되는 것: searchCore browser ESM 단일 출처·escapeHtml 자기완결 직렬화,
  `page()`를 통한 CSP nonce 주입, D1 batch 문장 순서·가드(테스트가 고정), migration append-only.
- 주석은 한국어. Workers 런타임이므로 src/에 Node API 금지 (Web Crypto·표준 웹 API만).
- UI 값은 `DESIGN.md` 토큰이 단일 출처. 임의 hex·spacing 금지.
- 스키마 변경은 반드시 새 migration 파일로. 수동 SQL 금지.
