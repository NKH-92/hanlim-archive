import { SNAPSHOT_ERROR_CODES } from "./errorCodes.js";

const REVISION_IDENTITY_FIELDS = new Set(["documentNumber", "revisionNumber"]);

function policyError(item, field, message) {
  return {
    rowNumber: Number(item.rowNumber || 0),
    field,
    code: SNAPSHOT_ERROR_CODES.SNAPSHOT_REVISION_HISTORY_CONFLICT,
    message
  };
}

export function validateRevisionHistorySnapshotChanges(items = [], revisionLinks = []) {
  const linkedDocumentIds = new Set();
  const supersededDocumentIds = new Set();
  for (const link of revisionLinks) {
    const previousId = Number(link.previous_document_id);
    const newId = Number(link.new_document_id);
    if (previousId > 0) {
      linkedDocumentIds.add(previousId);
      supersededDocumentIds.add(previousId);
    }
    if (newId > 0) linkedDocumentIds.add(newId);
  }

  const errors = [];
  for (const item of items) {
    const documentId = Number(item.matchedDocumentId);
    if (!documentId) continue;

    const changedFields = new Set(item.changedFields || []);
    if (linkedDocumentIds.has(documentId)
      && [...REVISION_IDENTITY_FIELDS].some((field) => changedFields.has(field))) {
      errors.push(policyError(
        item,
        "documentNumber/revisionNumber",
        "개정 이력에 연결된 문서의 문서번호·개정번호는 엑셀에서 변경할 수 없습니다. 동일 바인더 교체는 문서 개정, 다른 바인더 추가는 문서 추가 기능을 사용하세요."
      ));
    }

    const beforeStatus = item.before?.values?.status;
    const afterStatus = item.after?.values?.status;
    if (supersededDocumentIds.has(documentId)
      && beforeStatus === "disposed"
      && afterStatus === "active") {
      errors.push(policyError(
        item,
        "status",
        "개정으로 자동 폐기된 이전본은 엑셀에서 폐기 해제할 수 없습니다. 현재 개정본을 확인하세요."
      ));
    }
  }

  return { ok: errors.length === 0, errors };
}
