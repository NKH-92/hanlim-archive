// 핸들러 계층의 다운로드 응답 공통 형식. 본문 생성은 각 도메인에 남기고
// 여기서는 기존 헤더와 상태 코드만 일관되게 조립한다.
export function csvDownloadResponse(body, filename, { status = 200, headers = {} } = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      ...headers
    }
  });
}
