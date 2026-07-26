// UNIQUE 제약 위반을 업무 화면용 메시지로 변환한다. label은 호출 도메인이 결정한다.
export function uniqueViolationMessage(error, label) {
  return error.message.includes("UNIQUE") ? `같은 이름의 ${label}가 이미 있습니다.` : error.message;
}
