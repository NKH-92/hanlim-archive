# VISUAL_QA — 검색엔진형 UX 전면 개선 (아이디어 1~11)

- 일시: 2026-07-09
- 대상: 한림 문서고 관리 시스템 (cloudflare-app)
- 검증 환경: wrangler dev(포트 8788, 로컬 D1 시드 15건) + 실브라우저(Chrome headless, puppeteer-core), 로그인 계정 qafable(Admin)
- 디자인 계약: 루트 DESIGN.md (위치 디스플레이 lg/xl 토큰, mark·정답 카드·픽리스트 행 컴포넌트 규칙 추가됨)

## 캡처 아티팩트 (이 디렉터리)

| 파일 | 내용 | 뷰포트 |
|---|---|---|
| home-1280.png | 검색 전용 홈(아이디어 1): 검색창 + 자주 찾는 문서 + 바로가기만. 빈 결과 패널 없음 | 1280 |
| home-390.png | 모바일 홈 | 390 |
| home-instant-chosung-1280.png | 즉시 검색(아이디어 3·6): 초성 "ㅂㄹㄷㅇㅅ" 타이핑 → 3건 실시간 렌더, "문서명 초성 일치" | 1280 |
| serp-answer-1280.png | 정답 카드(아이디어 2·4·5): "2구역 밸리데이션" → 자동 칩(구역: 2구역 ×) + 위치 즉답 + mark 하이라이트 + 도면 랙 하이트 | 1280 |
| serp-list-768.png | 결과 리스트 태블릿 | 768 |
| serp-didyoumean-1280.png | 0건 방지(아이디어 9): "혹시 이 문서를 찾으셨나요?" 유사 후보 3건 | 1280 |
| guide-390.png | 길찾기 모드(아이디어 10): 대형 모노 위치 + 도면 + 미니 랙 맵 | 390 |
| picklist-1280.png / picklist-390.png | 감사 픽리스트(아이디어 11): 동선순 6건 + 진행률 + 회수 동선 도면 | 1280/390 |
| search-report-1280.png | 관리자 검색 리포트(아이디어 8·9) | 1280 |

## 기능 검증 (실브라우저 상호작용)

- [x] 홈 모드: 검색창만 노출, 도면·품질패널·카테고리 인덱스 없음. 결과 패널은 타이핑 전 숨김([hidden] 전역 규칙으로 수정 후 재검증)
- [x] 즉시 검색: /api/search-index 1회 로드(ETag) 후 키 입력마다 네트워크 왕복 없이 렌더. 초성·한영("ㅔㅍ"→PV 4건)·오타 모두 로컬 매칭
- [x] 정답 카드: 문서번호 정확 일치(PV-2026-016) 시 무조건, 그 외 1위≥2위×1.5. 서버·클라이언트 동일 규칙
- [x] 쿼리 파싱: "2구역 밸리데이션" → 구역 필터 자동 적용 + 해제 가능한 칩, 상세 필터 select에도 반영
- [x] 클릭 학습: 결과 클릭 → sendBeacon POST /api/search-click 200 → search_clicks 집계(D1 확인). 홈 "자주 찾는 문서"에 3회 노출
- [x] 검색 로그: 제출 검색이 search_logs에 upsert("2구역 밸리데이션" 2회/1건), 리포트 페이지에 집계 표시
- [x] 0건 방지: strict 0건 + loose(minCoverage 0.2) 매치 시 유사 후보 3건 렌더(서버·클라이언트 모두)
- [x] 길찾기: 대형 위치 표기, 반출 중 경고, 도면 해당 랙 하이트, 미니 랙 맵 활성 슬롯(1-1)
- [x] 픽리스트: 위치순 정렬(1-01A→1-01B→1-02→1-03→2-01), 체크→진행률 scaleX 바+localStorage 저장, 리로드 후 복원, 체크 초기화 동작
- [x] 콘솔 에러 0건, 실패 네트워크 요청 0건
- [x] 가로 스크롤 없음: 390/768/1280 전부 overflowX=false (스크립트 측정)

## 발견·수정한 결함 (QA 중)

1. esbuild 번들이 함수 소스에 `__name()` 헬퍼 주입 → 클라이언트 SearchCore 실행 실패 → `window.__name` shim 추가로 해결
2. `.viewer-workspace { display:grid }`가 hidden 속성을 덮어 홈에 빈 결과 패널 노출 → `[hidden] { display:none !important }` 전역 규칙 추가
3. 정답 카드가 이웃 문서번호(014/015/016) 유사매치 때문에 1.5배 우위 미달 → 문서번호/보관코드 정확 일치 시 무조건 정답 규칙 추가
4. NFKC 정규화가 호환 자모를 조합형으로 변환해 초성/한영 판정 실패 → compatJamo 변환 유틸 추가

## 안티슬롭 프리플라이트

- [x] 엠대시 0 (grep 검증)
- [x] eyebrow 계열 라벨: answer-label 1개(페이지당 최대 1회 렌더) ≤ 허용치
- [x] AI-퍼플/글로우 없음 — 단일 액센트 #1e55c4 유지
- [x] 서체: Pretendard(한글 가독성 의도 선택), 모노는 위치·코드 전용
- [x] 색/셰이프/테마 잠금 유지 — ds-compliance 위반 0
- [x] 가짜 스크린샷·장식 SVG 없음(실측 도면 Archive.png + Font Awesome)
- [x] 카피 자체 점검: 클리셰·가짜 수치 없음
- [x] 모션: transform/opacity/색 전환만(픽리스트 바는 scaleX), prefers-reduced-motion 전역 축소
- [x] 인터랙티브 상태: hover/focus-visible/disabled 기존 시스템 상속

## 게이트 결과

- node --test: 56/56 통과 (기존 43 + 신규 13)
- ds-compliance.mjs DESIGN.md src/html.js: ok, violations 0
- npm run check(구문): 통과

판정: PASS
