# 랜딩페이지 디자인 검토와 TDS 적용

검토일: 2026-09-16. 적용 범위: 공개 랜딩과 그 안의 로그인 영역.

## 참고 범위와 해석

[TDS Mobile 공식 문서](https://tossmini-docs.toss.im/tds-mobile/)의 전체 목차에 연결된 67개 문서 원문을 수집하고 소개·파운데이션·컴포넌트·유틸리티·마이그레이션의 구성과 용도를 검토했다. 이번 랜딩에 직접 적용하는 Typography, Colors, Button, Top, ListRow, Border, TextField, BoardRow를 중점적으로 읽었다. 모든 API를 실제 설치하거나 실행 검증했다는 의미는 아니다.

TDS가 명시하는 목표는 일관된 UI를 통한 기본 품질 보장, 재사용을 통한 생산성, 인터랙션과 템플릿의 일관성을 통한 제품 완성도다. 큰 글씨나 둥근 모서리만으로 토스의 디자인을 재현한다고 해석하지 않는다. 한림에서는 문서를 식별하고 위치를 이해하기 쉬운지가 디자인 판단의 기준이다.

현재 애플리케이션은 Worker의 서버 렌더링과 정적 CSS를 사용한다. TDS React 패키지를 설치하는 대신 그 정보 위계와 상태 표현 원칙을 기존 컴포넌트에 적용했다. 아래 디자인 결정은 공식 문서를 바탕으로 한 한림용 해석이며 TDS의 공식 규격을 그대로 준수한다는 주장은 아니다.

## 원칙과 적용

| 참고 가이드 | 문서에서 확인한 원칙 | 한림 랜딩 적용 |
|---|---|---|
| [Typography](https://tossmini-docs.toss.im/tds-mobile/foundation/typography/) | 크기·행간 토큰으로 정보 위계를 만들고 확대 환경을 고려 | 소개 제목·섹션 제목·본문·메타를 구분하고 rem 기반 토큰 사용 |
| [Colors](https://tossmini-docs.toss.im/tds-mobile/foundation/colors/) | 공통 색상 이름과 일관된 색상 체계 | 한림의 primary·슬레이트·선택 위치 노랑을 유지하고 연한 메타 글자의 대비 개선 |
| [Button](https://tossmini-docs.toss.im/tds-mobile/components/button/) | fill로 주요 행동, weak로 보조 행동 구분 | 로그인은 진한 파랑, 기능 살펴보기와 헤더 로그인은 연한 배경 |
| [Top](https://tossmini-docs.toss.im/tds-mobile/components/top/) | 제목·설명·행동 영역과 여백을 일관되게 구성 | 두 줄의 핵심 제목, 짧은 설명, 다음 행동 순서로 첫 화면 구성 |
| [ListRow](https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/) | 주 콘텐츠와 보조 정보를 정렬하고 밀도를 조절 | 예시에서 문서명·번호·개정과 위치를 구분; 모바일에서도 좌표 보존 |
| [Border](https://tossmini-docs.toss.im/tds-mobile/components/border/) | 목록과 섹션에 맞는 구분 방식 | 반복 카드 그림자를 줄이고 목록 구분선과 섹션 배경으로 구조 표현 |
| [TextField](https://tossmini-docs.toss.im/tds-mobile/components/TextField/text-field/) | 라벨·안내·오류 상태를 명확하게 전달 | 로그인 라벨 유지, 16px 입력과 52px 높이, 폼 위 오류·설정 안내 유지 |
| [BoardRow](https://tossmini-docs.toss.im/tds-mobile/components/board-row/) | 부가 설명은 접고 펼쳐 정보량 조절 | 계정 문의는 키보드로도 동작하는 native details로 제공 |

BottomCTA·BottomSheet·Dialog·Toast·Skeleton·Progress·Tab 등은 목적을 검토했지만 정적인 공개 랜딩에 새 동작으로 추가하지 않았다. 약관·보안 키패드·차트·평점과 React 유틸리티 및 마이그레이션은 이번 범위에 직접 적용하지 않는다.

## 기존 화면에서 개선한 점

- 넓은 화면에서도 다섯 줄로 분절되던 제목을 두 줄로 정리하고 문서 검색과 보관 위치라는 핵심을 먼저 전달한다.
- 예시의 9~11px 글씨를 12~14px 중심으로 키우고 한 행의 정보량을 조절한다. 실제 데이터로 오해하지 않도록 화면 예시임을 표시한다.
- 검색 → 위치 → 이력 → 운영 원칙 → 로그인 순서를 유지하면서 반복 설명과 내부 구현 용어를 줄인다.
- 선반은 아래부터 세는 업무 규칙에 맞춰 4열·3선반 강조를 위에서 네 번째 행으로 수정하고 모든 축을 표시한다.
- 고정 헤더가 중간 섹션에서도 작동하도록 랜딩의 가로 overflow를 clip으로 제한한다. 섹션 이동에는 헤더 높이를 고려한 여백을 둔다.
- 터치 가능한 컨트롤은 44px 이상으로 유지하고 포커스를 명시한다. 자동 재생·스크롤 진입 효과 없이 기본 콘텐츠가 항상 보인다.
- 로그인 POST·필드명·autocomplete·복귀 경로와 오류 메시지를 유지한다. 역할·권한·업무 데이터에는 변경이 없다.

구현 토큰과 반응형 규칙은 [DESIGN.md](./DESIGN.md)의 공개 랜딩과 로그인 절에 기록했다.

## 검증

- `npm run verify`: 문법·타입·lint·형식·migration·route·생성 asset·593개 테스트 통과.
- 마지막 스크롤 수정 후 `npm run check`와 `npm test` 재실행: 593개 통과.
- Chromium의 320·390·768·1024·1440px 화면: 가로 넘침 0, 깨진 이미지 0, 44px 미만 주요 컨트롤 0. 첫 제목은 모두 두 줄.
- 로그인 입력은 각 화면에서 16px, 실제 폼은 `POST /login` 유지. 랙 강조는 3선반의 네 번째 열.
- 헤더 로그인 링크로 이동한 영역이 고정 헤더 아래에 보이는 것을 확인했다. 계정 문의는 Tab·Enter로 열리고 포커스 표시가 유지된다.
- 320px의 로그인 제한 오류 안내가 잘리지 않고 표시되며, 새로고침 후 브라우저 콘솔 오류가 없었다.
- 실제 모바일 기기·Safari·스크린리더, 계정으로 로그인한 뒤의 업무 기능은 이번 랜딩 검증 범위에 포함하지 않는다.

원문 수집 목록, 전후 화면, 브라우저 관찰과 검증 로그는 `outputs/tds-review-20260916/`에 보관한다. 로컬 미리보기에서 검토하는 변경이며 운영 배포는 수행하지 않았다.
