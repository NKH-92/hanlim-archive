# 시각 QA — "마지막 30cm" 클러스터 (길찾기 페이지)

날짜: 2026-07-09 · 대상: `documentGuidePage` (`/documents/:id/guide`)
검증 환경: `wrangler dev` 로컬 서버(127.0.0.1:8787), 실 D1(local), 뷰포트 375×812(mobile)

> 이 샌드박스에서는 CDN 폰트 로딩이 헤드리스 렌더러를 막아 `preview_screenshot`이 반복 타임아웃되므로,
> 스크린샷 대신 `preview_inspect`/`preview_eval`로 계산된 스타일·렌더 텍스트·레이아웃 치수를 캡처해 증거로 남긴다.

## 시나리오
슬롯4·A면에 NB-2026-100/101/102(Rev.0 폐기)/102(Rev.1 현행)/103을 배치하고 NB-2026-102 Rev.1(id=21)의 길찾기 페이지를 검증.

## 결과 (모두 통과)

### 1) 이웃 문서 앵커
렌더된 이웃 4행(window = 현재±2):
- NB-2026-101 Rev.0
- NB-2026-102 Rev.0 — `is-void`(폐기, 취소선 + opacity .55)
- **NB-2026-102 Rev.1 — `is-current`** (배경 `rgb(233,239,251)` = `--primary-soft`, 좌측 `3px rgb(30,85,196)` = `--primary`, 700 굵기)
- NB-2026-103 Rev.0

`.n-here` "이 문서" 마커는 현재 행에만 1개.

### 2) 개정판 함정 차단
같은 문서번호 NB-2026-102가 이 슬롯에 2개 → 배너 노출.
- 칩: `Rev.0 · 폐기`(`.void`, 취소선) / `Rev.1 · 찾는 문서`(`.valid` = `--success`, `.is-current` 테두리 `--primary`)

### 3) 선반 나침반
`mini-compass` 렌더 텍스트: **"아래에서 1번째 선반 · 왼쪽에서 1번째 열 · A면"**
미니맵 축 라벨 `위 ↑` / `아래 ↓` 표시.

### 4) 크게 보기 오버레이
- 버튼 클릭 → `data-big-view-overlay` 표시(`hidden=false`), body 스크롤 잠금.
- `.big-view` 계산 스타일: `background rgb(24,33,47)`(= `--gray-900`), `position fixed`, `display grid`, `z-index 100`.
- `.bv-1` 계산 스타일: `color rgb(255,255,255)`(= `--surface`), `mono`, `text-align center`, `word-break keep-all`.
- 레이아웃(375px): `.bv-1` 345×37px = **한 줄** (초기 flex-column min-content 압축으로 세로 1글자씩 줄바꿈되던 버그를 inner `width:min(92vw,820px)` + 자식 `width:100%`로 수정 확인).
- 오버레이/Esc/버튼 클릭 토글 동작, 렌더 내용 "1구역 2번 랙 · A면 / 1열 1선반".

### 5) 정답 카드 확신 등급 (서버 + 클라이언트 즉시검색 양쪽)
- 서버 렌더(`/app?q=`): exact `NB-2026-102` → `.answer-grade.certain` "확실"; 부분명 `충전공정` → `.answer-grade.likely` "유력 · 확인 권장". (검증 시 인라인 `<script>` 템플릿의 동일 리터럴을 제거하고 서버 렌더 영역만 판정.)
- 클라이언트 즉시검색(타이핑): exact `NB-2026-102` → 정답카드 "확실"; 부분명 `충전공정` → "유력 · 확인 권장". 콘솔 오류 0.

### 6) 회수 신호등 (좌측 레일 · 예외 상태만)
- `NB-2026-103`을 반출(김검사) 후 `q=NB-2026` 결과: 서버 렌더 행 중 `doc-row is-checked-out` 1건(노랑 `--warning` inset 레일) + `doc-row is-disposed` 1건(회색 `--gray-300` 레일). 제자리(active) 행은 무표시 → 정보 과잉 금지 준수.
- 레이아웃 불변(inset box-shadow 사용, 그리드 폭 영향 없음). 클라이언트 즉시검색 행에도 동일 레일 렌더 확인.

### 품질 게이트
- `console` 로그 0건 — CSP 위반·JS 오류 없음(nonce 인라인 스크립트 정상 실행).
- 신규 컴포넌트 CSS는 DESIGN.md 토큰만 사용(raw hex 스캔 0; 딥면 반투명 화이트만 토큰 파생 알파 예외).
- `npm run check` + `npm test`(65) 통과.
