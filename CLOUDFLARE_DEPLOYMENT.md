# Cloudflare 배포 가이드

이 프로젝트의 운영 배포 대상은 Cloudflare Workers + D1입니다.

## 현재 배포 정보

- Worker: `hanlim-archive`
- D1 DB: `hanlim-archive`
- D1 database_id: `1262ca00-b431-490c-aad2-539d77d4f73f`
- workers.dev URL: `https://hanlim-archive.skarhkdgus7.workers.dev`

## 사전 준비

```powershell
cd .\cloudflare-app
npm install
```

로컬 실행에는 `.dev.vars`가 필요합니다.

```powershell
Copy-Item .\.dev.vars.example .\.dev.vars
```

`.dev.vars` 또는 Cloudflare secret에는 최소 32자 이상의 `SESSION_SECRET`을 설정합니다.

```powershell
npx wrangler secret put SESSION_SECRET
```

## 로컬 확인

```powershell
npm run db:migrate:local
npm run check
npm test
npm run dev
```

## 원격 D1 migration

```powershell
npm run db:migrate:remote
```

`0027_initial_admin_and_forced_password_change.sql`이 최초 관리자 `nkh92@hanlim.com`을 자동 등록합니다.
초기 비밀번호는 `123456`이며 첫 로그인 직후 8자 이상의 새 비밀번호로 반드시 변경해야 합니다.
배포 직후 관리자가 직접 로그인해 변경을 완료합니다. 같은 이메일 계정이 이미 존재하면 migration은 기존 비밀번호를 덮어쓰지 않습니다.

## 배포

```powershell
npm run deploy
```

배포 후 확인합니다.

```powershell
Invoke-WebRequest https://hanlim-archive.skarhkdgus7.workers.dev/login -UseBasicParsing
```

## 운영 메모

- 권한이 없는 일반 사용자는 문서 조회와 검색만 가능합니다.
- 문서 등록·이동·폐기·기준정보·사용자·감사 업무는 서버가 각 세부 권한을 검사합니다. Admin은 모든 권한을 가집니다.
- 인증된 POST 요청은 세션 CSRF 토큰을 요구합니다.
- nonce 기반 CSP는 적용되어 있습니다(`src/security.js`). 폰트·아이콘의 외부 CDN 의존성은 남아 있으므로 보안 정책이 엄격해지면 self-hosting을 추가로 검토합니다.
