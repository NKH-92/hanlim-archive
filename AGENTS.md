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

- 계층: `index.js` → `handlers/` → 배럴(`html.js`/`db.js`) → `views/`/`data/` → 리프(searchCore/utils/auth/security).
  계층 밖에서는 배럴로만 import한다. 상세와 불변식은 `docs/ARCHITECTURE.md` — **코드 수정 전 필독**.
- 깨면 안 되는 것: searchCore·escapeHtml의 toString() 브라우저 직렬화(자기완결 필수),
  `page()`를 통한 CSP nonce 주입, D1 batch 문장 순서·가드(테스트가 고정), migration append-only.
- 주석은 한국어. Workers 런타임이므로 src/에 Node API 금지 (Web Crypto·표준 웹 API만).
- UI 값은 `DESIGN.md` 토큰이 단일 출처. 임의 hex·spacing 금지.
- 스키마 변경은 반드시 새 migration 파일로. 수동 SQL 금지.
