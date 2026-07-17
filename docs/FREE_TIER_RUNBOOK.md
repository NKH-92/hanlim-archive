# 무료티어 운영 점검표

Cloudflare API를 호출하는 별도 사용량 대시보드는 만들지 않는다. 운영자는 Cloudflare Dashboard와 GitHub Actions의 기본 화면을 월 1회 확인한다.

## 확인 위치

| 항목 | 확인 위치 | 경고 시 조치 |
|---|---|---|
| Worker 요청·오류율·CPU | Cloudflare Dashboard → Workers & Pages → 한림문서고 → Metrics | 오류 로그의 request ID 확인, 최근 배포 롤백 검토 |
| D1 읽기·쓰기·DB 크기 | Cloudflare Dashboard → D1 → `hanlim-archive` → Metrics | 대량 작업 중지, 목록·검색 쿼리와 인덱스 검토 |
| Actions 사용량 | GitHub → Settings → Billing and plans → Actions | 불필요한 재실행과 중복 workflow 정리 |
| 백업 아티팩트 | GitHub → Actions → D1 Backup / 저장량 | 35일 보존 확인, 오래된 수동 아티팩트 삭제 |
| 즉시검색 인덱스 | 앱 → 관리 설정 | 4,000건 경고에서 크기 추적, 5,000건에서 구조 재검토 |

## 월별 체크리스트

- [ ] `/healthz` 200 및 검색·문서 상세 표본 확인
- [ ] Worker 요청 수, 오류율, CPU의 전월 대비 급증 확인
- [ ] D1 읽기·쓰기와 DB 크기 확인
- [ ] 최근 주간 암호화 백업 성공 및 `.enc`·`.sha256`만 업로드됐는지 확인
- [ ] GitHub Actions 사용량과 아티팩트 저장량 확인
- [ ] 관리자 데이터 품질 작업목록 처리
- [ ] Cloudflare/GitHub 유지관리자와 2단계 인증 상태 확인

## 저장소·계정 보안 체크리스트

아래 항목은 코드로 자동 변경하지 않고 저장소 소유자와 운영 책임자가 GitHub·Cloudflare 설정에서 수행한다.

- [ ] GitHub 저장소를 private로 전환하고 회사 또는 팀 Organization 소유를 검토
- [ ] 최소 2명의 유지관리자를 지정하고 모든 유지관리자의 2단계 인증 확인
- [ ] 배포용 `CLOUDFLARE_API_TOKEN`을 대상 Worker·D1에 필요한 최소 권한으로 제한
- [ ] 백업용 `CLOUDFLARE_D1_BACKUP_API_TOKEN`은 `Account > D1 > Read`만 부여해 배포 토큰과 분리
- [ ] 과거 노출 가능성이 있는 토큰을 폐기하고 교체
- [ ] Actions secret `D1_BACKUP_PASSPHRASE`를 32자 이상 무작위 값으로 등록하고 별도 비밀관리 절차에 보관
- [ ] `D1 Backup`을 수동 실행해 암호화 아티팩트와 체크섬 생성 성공을 확인

수동 백업은 D1 전체 export 동안 앱 요청이 지연·실패할 수 있으므로 반드시 저사용 점검창에 실행한다. `main` 배포와 백업은 같은 Actions 동시성 그룹에서 직렬 실행된다.

## 대량 CSV 전후

전: 최근 백업 성공, D1 사용량, 파일 행 수·크기, 중복 문서번호를 확인한다. 후: 작업 화면 성공/실패 합계, 문서 건수, 표본 검색, 데이터 품질 목록을 확인한다. 중단되면 같은 작업을 재개하며 새 전체 업로드를 반복하지 않는다.

## 폐기 캠페인 전후

전: 대상 조건·건수·사유·동결 시각과 최신 백업을 확인한다. 후: 완료/변경/제외/실패 합계, 문서 감사와 폐기 이력, 결과 CSV를 확인한다. 경고가 발생하면 추가 처리를 멈추고 `DISPOSAL_WORKFLOW.md`의 재개 절차를 따른다.
