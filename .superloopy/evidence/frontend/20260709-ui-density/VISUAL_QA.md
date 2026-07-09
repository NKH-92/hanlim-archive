# VISUAL_QA — UI 고밀도 재설계 (2026-07-09)

대상: `cloudflare-app/src/html.js` (서버렌더 템플릿 + 인라인 CSS 전면 개편), `src/index.js` (/documents 불필요 쿼리 제거)
토큰 계약: 저장소 루트 `DESIGN.md` (사본: 이 폴더의 `DESIGN_TOKENS.md`)
검증 환경: wrangler dev (로컬 D1, 문서 15건 시드) + Playwright 1.61.1 headless Chromium 실브라우저

## 결과 요약: PASS

- `node --check` 8개 파일 통과, `npm test` 43/43 통과 (기존 테스트 1건은 새 구조에 맞게 갱신: 히어로 문구 → "문서 위치 검색")
- ds-compliance (하드 게이트): `ok: true`, 미선언 hex 0건, 스케일 밖 spacing 0건 (declaredColors 22)
- 가로 스크롤: 18개 화면×브레이크포인트 검사 전부 `scrollWidth <= clientWidth` (qa-report.json)
- 브라우저 콘솔 에러: 0건

## 브레이크포인트 캡처 (390 / 768 / 1280)

| 화면 | 390 | 768 | 1280 |
|---|---|---|---|
| 검색(/app, 쿼리) | app-query-390 | app-query-768 | app-query-1280 |
| 전체 문서 테이블 | documents-390 | documents-768 | documents-1280 |
| 문서 상세 | detail-390 | detail-768 | detail-1280 |
| 로그인 | login-390 | — | login-1280 |
| 그 외 1280 | racks / admin / sets-list / set-detail / app-recent / app-empty |

## 상태(state) 실연 증거

- 빈 결과: `app-empty-1280.png` (없는 검색어 → empty-state + 대안 액션)
- 필터 열림: `app-filters-open-1280.png` (details 확장 + 5필터, select 변경 시 자동 재검색 `data-auto-submit`)
- 반출/반납 흐름: `detail-checked-out-1280.png` — 실제 반출 기록 POST → 경고 패널 + "반출 중 · QA검증" 배지 확인 후 반납 처리로 원복
- 벌크 선택: `documents-bulk-1280.png` (체크 → 하단 스티키 벌크 바 등장)
- 탭 전환: `detail-tab-audit-1280.png` (언더라인 탭 + 카운트)
- 모바일 드로어: `app-drawer-390.png` (햄버거 → 슬라이드 인, 활성 항목 하이라이트, 스크림)
- 폐기 상태: documents 테이블 내 IQ-2025-009 행 dim 처리 + 폐기 배지
- hover/focus/disabled: CSS 토큰 정의(행 hover, focus-visible 2px 아웃라인, opacity .45) — 코드 검수로 확인
- 로딩 상태: MPA 서버렌더 구조로 클라이언트 로딩 상태 없음(브라우저 네이티브 내비게이션) — 해당 없음

## 1차 캡처에서 발견 → 수정한 결함 (재캡처로 확인)

1. /documents 테이블이 사이드 패널에 눌려 문서명이 4자 단위로 줄바꿈, 상태 열 잘림 → 단일 컬럼 레이아웃 + 위치 셀 2줄 압축(`1-01 · A면` / `1열 4선반`)으로 화면당 15행 단줄 표시
2. 검색 결과 행 본문 컬럼 과소(모노 한글 위치 라벨이 250px 점유) → 위치는 모노 코드 메인 + 한글 보조줄(중복 면 표기 제거), 액션 버튼 세로 스택
3. 761–1099px 구간에서 가로 내비 항목이 세로로 깨짐 → 드로어 내비를 1099px까지 확장(1100px부터 고정 사이드바)
4. 필수 표시 `*`가 라벨 아래 줄로 떨어짐 → label을 block으로 변경, 컨트롤에 margin-top
5. 미니 서가 시각화 활성 슬롯 미표시 → 코드 정상, 로컬 시드 데이터 불일치(랙 1-01 메타 1×3 vs 슬롯 8개)였음. 로컬 DB 메타 보정 후 활성 슬롯(파란색+핀) 표시 확인

## anti-slop 프리플라이트

- [x] em-dash 0건 (기존 2건 문구 재작성)
- [x] eyebrow 라벨 0건 (기존: 전 섹션에 존재 → 전부 제거)
- [x] AI-purple/글로우 없음 — 단일 딥 블루 `#1e55c4` 커밋
- [x] 의도적 서체: Pretendard(한국어 전문 표준) + 코드 전용 모노 스택
- [x] beige+brass 없음
- [x] 색/형태/테마 잠금: 액센트 1개, 반경 4단(10/8/6/pill), 라이트 단일 테마
- [x] 실자산: 실제 도면 이미지(Archive.png), Font Awesome 아이콘 라이브러리
- [x] 카피 자체 감사: 클리셰·가짜 수치·플레이스홀더 이름 없음 (DB 실데이터)
- [x] 마이크로텔 없음 (도면 랙 세로 숫자는 실제 물리 배치 재현 기능 — 장식 아님)
- [x] 모션: 드로어/토스트 transform+opacity, hover 색 전환 ≤180ms, 레이아웃 속성 애니메이션 없음, prefers-reduced-motion 대응
- [x] 전 값 토큰 추적 (ds-compliance ok)
- [x] 가로 스크롤 0건 (390/768/1280)

## 비고

- UX 약화 없이 통과: 기능 제거 없음. 오히려 추가된 UX — 필터 자동 적용, 상세 위치 복사 버튼, /documents 불필요 D1 쿼리 1건/요청 제거
- 로컬 QA 산출물: qaadmin 계정, ARC-9000xx 시드 문서 12건, "2026년 정기감사 준비문서" 세트 — 로컬 D1 전용(원격 미반영)
