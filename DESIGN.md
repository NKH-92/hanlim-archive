# DESIGN.md — 한림 문서고 관리 시스템

모든 UI 값의 단일 출처. 컴포넌트에 새 값이 필요하면 여기에 토큰을 먼저 추가한 뒤 사용한다.
원시 hex, 임의 spacing 숫자를 컴포넌트에 직접 쓰지 않는다.

## 1. Atmosphere / Signature

제약 GMP 문서고의 **규제산업 운영 콘솔**. 차분한 쿨 슬레이트 바탕 위에 딥 워킹 블루 하나만 쓴다.
정보가 장식보다 앞선다: 그림자 대신 헤어라인 보더, 카드 대신 행(row), 큰 여백 대신 정렬된 밀도.
위치 코드와 문서번호는 모노스페이스로 각인해 "찾아갈 좌표"라는 정체성을 준다.
밀도와 정렬이 신뢰를 만든다. 화면당 보이는 문서 행 수가 곧 이 시스템의 품질 지표다.

Do / Don't
- Do: 헤어라인(`--line`)으로 구획하고, 표 형태로 정렬한다. 숫자는 tabular-nums.
- Do: 위치·문서번호는 `--font-mono`. 내부 보관코드는 브라우저 업무 화면에 노출하지 않는다.
- Don't: 카드마다 그림자를 주지 않는다(보더 우선, 그림자는 떠 있는 레이어 전용).
- Don't: 섹션마다 eyebrow 라벨을 달지 않는다. 제목 하나로 충분하다.
- Don't: 마케팅형 히어로 문구. 첫 화면 최상단은 검색 입력이다.

## 2. Color

| 토큰 | 값 | 역할 |
|---|---|---|
| `--gray-50` | `#f7f9fb` | 침강 표면(표 헤더, 웰) |
| `--gray-100` | `#eef1f5` | 옅은 채움(호버, 비활성 배경) |
| `--gray-200` | `#e1e6ed` | 헤어라인 보더(= `--line`) |
| `--gray-300` | `#cbd3dd` | 진한 보더, 구분 강조 |
| `--gray-400` | `#9aa7b8` | 플레이스홀더, 비활성 아이콘 |
| `--gray-500` | `#5a6a7d` | 보조 텍스트(캡션, 메타) |
| `--gray-600` | `#55647a` | 라벨, 테이블 헤더 텍스트 |
| `--gray-700` | `#3d4a5c` | 부제, 내비 텍스트 |
| `--gray-800` | `#283445` | 강조 보조(다크 바) |
| `--gray-900` | `#18212f` | 본문 잉크(near-black, 순검정 금지) |
| `--bg` | `#f3f5f8` | 페이지 배경 |
| `--surface` | `#ffffff` | 패널/행 표면 |
| `--primary` | `#1e55c4` | 단일 액센트. 링크·주요 버튼·활성 상태·위치 강조 |
| `--primary-strong` | `#17439f` | 호버/프레스 |
| `--primary-soft` | `#e9effb` | 액센트 배경(활성 칩, 위치 셀) |
| `--primary-deep` | `#122c63` | 로그인 사이드 등 딥 블루 면 |
| `--success` | `#0c7a43` | 보관중 상태 |
| `--success-soft` | `#e5f4eb` | 보관중 배경 |
| `--warning` | `#9a5b00` | 대기 상태 |
| `--warning-soft` | `#fdf1dd` | 대기 배경 |
| `--danger` | `#c22f2f` | 폐기·오류·파괴적 동작 |
| `--danger-soft` | `#fbecec` | 폐기·오류 배경 |

- 대비 사전 검증(실측): `--gray-900`/`--surface` ≈ 15:1, `--gray-500`/`--surface` ≈ 5.5:1,
  가장 밝은 배경인 `--gray-500`/`--bg` ≈ 5.1:1로 본문 AA(4.5:1) 충족,
  `#ffffff`/`--primary` ≈ 6.9:1, 상태색/상태soft 모두 ≥ 4.5:1.
- 색 잠금: 액센트는 `--primary` 하나. 초록·주황·빨강은 상태 의미 전용이며 장식에 쓰지 않는다.

## 3. Typography

- 본문 스택: `system-ui, -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`
  (한국어 전문 표준 서체. Inter 기본값 대체가 아니라 한글 가독성을 위한 의도적 선택)
- 코드 스택 `--font-mono`: `ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace`
  (위치 코드, 문서번호, 보관코드 전용)
- 숫자: 카운트·통계·표의 숫자는 `font-variant-numeric: tabular-nums`.

| 역할 | 크기/두께/행간/자간 |
|---|---|
| 페이지 제목 h1 | 19px · 700 · 1.3 · -0.01em |
| 섹션 제목 h2 | 15px · 700 · 1.35 · -0.01em |
| 소제목 h3 | 13.5px · 700 · 1.4 |
| 본문 | 14px · 400 · 1.55 |
| 메타/캡션 | 12.5px · 500 · 1.45 |
| 라벨/테이블 헤더 | 12px · 600 · 1.4 (`--gray-600`) |
| 위치/코드(모노) | 13px · 600 · 1.4 |
| 통계 숫자 | 22px · 700 · 1.2 · tabular-nums |
| 위치 디스플레이 lg(정답 카드) | 22px · 700 · 1.25 · mono · tabular-nums |

## 4. Spacing

기본 단위 4px. 모든 margin/padding/gap은 이 배수만 쓴다.

`--sp-1: 4px` · `--sp-2: 8px` · `--sp-3: 12px` · `--sp-4: 16px` · `--sp-5: 20px` · `--sp-6: 24px` · `--sp-8: 32px`

- 패널 내부: `--sp-5`. 행(row) 내부: `--sp-3 --sp-4`. 섹션 간: `--sp-4`.
- 페이지 컨테이너: 최대 1440px, 거터 `--sp-6`.
- 사이드바 폭: 240px(≥1100px 고정).

## 5. Components

- 반경: `--r-lg: 10px`(패널·모달) · `--r-md: 8px`(버튼·입력) · `--r-sm: 6px`(배지·미니 요소) · pill은 999px(칩·상태 배지). 이 4단 외 값 금지(shape lock).
- **버튼**: 높이 36px(기본)/30px(sm). primary = `--primary` 배경 + `#ffffff` 텍스트, hover `--primary-strong`.
  secondary = `--surface` 배경 + `--line` 보더 + `--gray-700` 텍스트, hover `--gray-50`.
  danger = `--danger-soft` 배경 + `--danger` 텍스트. focus-visible: 2px `--primary` 아웃라인(offset 2px).
- **입력/셀렉트**: `--surface` 배경 + 1px `--line` 보더 + `--r-md`, 높이 36px. hover 보더 `--gray-300`,
  focus 보더 `--primary` + 3px `--ring` 링. placeholder `--gray-400`.
- **테이블/리스트 행**: 헤더 `--gray-50` 배경 + 12px/600 `--gray-600`, 행 높이 ≥44px,
  행 구분 1px `--line`, hover `--gray-50`. 위치 셀은 `--font-mono` + `--primary` 텍스트.
- **상태 배지**: pill, 12px/700, soft 배경 + 상태색 텍스트. 보관중=success, 대기=warning, 폐기=중립 회색. `danger`는 폐기 버튼 같은 파괴적 동작에만 쓴다.
- **칩(필터)**: pill, 12.5px/600, `--surface`+`--line` 보더, 활성 = `--primary-soft`+`--primary`.
- **탭**: 언더라인 형. 비활성 `--gray-500`, 활성 `--gray-900` + 2px `--primary` 밑줄.
- **패널**: `--surface` + 1px `--line` + `--r-lg`. 그림자 없음.
- **사이드바**: `--surface`, 우측 1px `--line`. 항목 13.5px/600 `--gray-700`, 활성 `--primary-soft` 배경 + `--primary`.
- **모바일 하단 탭**: 검색·등록·폐기 중 권한이 있는 핵심 메뉴만 표시. 높이 48px, `--surface` + 상단 `--line`, 활성은 사이드바와 같은 색 문법.
- **검색 하이라이트(mark)**: `--primary-soft` 배경 + `--primary` 텍스트, radius 2px, 추가 padding 없음. 장식 금지, 검색어 일치 표시 전용.
- **검색 결과**: 별도 정답 카드나 도면 없이 문서명·문서번호·개정·제/개정일·대분류·보관 위치·상태의 정렬된 행만 사용한다.
- 비활성(disabled): opacity .45 + pointer-events 차단.

## 6. Motion

- 지속시간 120–180ms, `ease-out`. 배경/보더 색 전환과 opacity/transform만 사용(GPU 합성).
- 레이아웃 속성(width/height/top) 애니메이션 금지.
- 토스트: translateY+opacity 200ms. 드로어(모바일 내비): transform 220ms.
- `prefers-reduced-motion: reduce` 시 모든 transition/animation 1ms로 축소.

## 7. Depth

전략은 **보더 우선** 하나로 통일. 표면은 전부 1px `--line`으로 구획하고 그림자를 겹치지 않는다.

| 레벨 | 용도 | 값 |
|---|---|---|
| 0 | 패널, 행, 카드 | 보더만 (`1px solid --line`) |
| 1 | 떠 있는 바(벌크 액션, 스티키), 팝오버 | `--shadow-1: 0 4px 16px rgba(24, 33, 47, .08)` |
| 2 | 모달, 커맨드 팔레트, 토스트 | `--shadow-2: 0 12px 40px rgba(24, 33, 47, .18)` |

스크림: `rgba(24, 33, 47, .5)`. 포커스 링: `--ring: rgba(30, 85, 196, .22)`.

알파 예외(토큰 파생값): 딥/다크 면 위 반투명 화이트 `rgba(255,255,255,.12~.92)`(로그인 사이드, 벌크 바, 도면 라벨),
도면 오버레이의 primary 알파 틴트 `rgba(30,85,196,.05/.45)`. 이 외의 알파 색 신설 금지.
