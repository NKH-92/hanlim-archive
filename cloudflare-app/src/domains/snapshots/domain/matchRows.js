import { clean } from "../../../shared/text/normalize.js";
import { SNAPSHOT_ERROR_CODES } from "./errorCodes.js";
import {
  buildCanonicalValues,
  buildDiffPayload,
  computeChangedFields,
  computeChangeFlags,
  CHANGE_FLAGS
} from "./diff.js";
import { documentIdentity, isStableRowKey, serverGeneratedRowKey } from "./identity.js";

function parseIdList(value) {
  return clean(value).split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function documentToValues(document, lookup = {}) {
  const categoryName = lookup.categoryNames?.get(Number(document.category_id)) || "";
  const slot = lookup.slotsById?.get(Number(document.rack_slot_id));
  const tagIds = parseIdList(document.tag_ids);
  const tagNames = tagIds.map((id) => lookup.tagNames?.get(id) || "").filter(Boolean);
  return buildCanonicalValues({
    documentNumber: document.document_number,
    revisionNumber: document.revision_number,
    revisionDate: document.revision_date,
    disposalDueYear: document.disposal_due_year,
    documentName: document.document_name,
    categoryId: document.category_id,
    categoryName,
    rackSlotId: document.rack_slot_id,
    rackCode: slot?.code || "",
    rackColumn: slot?.column_number ?? null,
    shelfNumber: slot?.shelf_number ?? null,
    rackFace: document.rack_face,
    tagIds,
    tagNames,
    note: document.note,
    status: document.status,
    syncState: document.sync_state
  });
}

/**
 * 관리 ID·identity 정책을 적용해 create/update/unchanged와 exclusion 대상을 확정한다.
 */
export function matchCanonicalSnapshotRows(items, documents, { managedMode = true, lookup = {} } = {}) {
  const byKey = new Map();
  const byIdentityCurrent = new Map();
  const byIdentityExcluded = new Map();
  const errors = [];

  for (const document of documents) {
    const key = clean(document.excel_row_key);
    if (key) byKey.set(key, document);
    const identity = documentIdentity(document.document_number, document.revision_number);
    if (document.sync_state === "current") {
      const list = byIdentityCurrent.get(identity) || [];
      list.push(document);
      byIdentityCurrent.set(identity, list);
    } else if (document.sync_state === "excluded") {
      const list = byIdentityExcluded.get(identity) || [];
      list.push(document);
      byIdentityExcluded.set(identity, list);
    }
  }

  const fileIdentity = new Map();
  const fileKeys = new Map();
  const matchedIds = new Set();
  const matchedItems = [];
  let blankKeyCreateCount = 0;
  let identityChangeCount = 0;

  for (const item of items) {
    const identity = documentIdentity(item.values.documentNumber, item.values.revisionNumber);
    if (fileIdentity.has(identity)) {
      const priorRow = fileIdentity.get(identity);
      errors.push({
        rowNumber: item.rowNumber,
        field: "identity",
        code: SNAPSHOT_ERROR_CODES.SNAPSHOT_IDENTITY_DUPLICATE,
        message: `파일 안에 같은 문서번호·개정번호가 중복되어 있습니다. (${item.values.documentNumber} / ${item.values.revisionNumber}, ${priorRow}행과 충돌)`,
        documentNumber: item.values.documentNumber,
        revisionNumber: item.values.revisionNumber,
        conflictRowNumber: priorRow
      });
    } else {
      fileIdentity.set(identity, item.rowNumber);
    }

    const sourceKey = clean(item.sourceRowKey || item.rowKey);
    if (sourceKey) {
      if (fileKeys.has(sourceKey)) {
        const priorRow = fileKeys.get(sourceKey);
        errors.push({
          rowNumber: item.rowNumber,
          field: "sourceRowKey",
          code: SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_DUPLICATE,
          message: `파일 안에 같은 숨김 관리 ID가 중복되어 있습니다. (${sourceKey}, ${priorRow}행과 충돌)`,
          rowKey: sourceKey,
          conflictRowNumber: priorRow
        });
      } else {
        fileKeys.set(sourceKey, item.rowNumber);
      }
    }

    let document = null;
    if (sourceKey) {
      document = byKey.get(sourceKey) || null;
      if (!document) {
        const currentHits = byIdentityCurrent.get(identity) || [];
        if (currentHits.length) {
          const hit = currentHits[0];
          errors.push({
            rowNumber: item.rowNumber,
            field: "sourceRowKey",
            code: SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_UNKNOWN,
            message: `관리 ID가 기존 문서와 일치하지 않습니다. (행 관리 ID ${sourceKey}, 동일 문서번호·개정의 현재 문서 ${hit.document_number}/${hit.revision_number}, id=${hit.id}, rowKey=${hit.excel_row_key || "-"})`,
            documentNumber: item.values.documentNumber,
            revisionNumber: item.values.revisionNumber,
            existingDocumentId: Number(hit.id),
            existingRowKey: hit.excel_row_key || "",
            rowKey: sourceKey
          });
          continue;
        }
        if (managedMode) {
          errors.push({
            rowNumber: item.rowNumber,
            field: "sourceRowKey",
            code: SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_UNKNOWN,
            message: `알 수 없는 외부 관리 ID는 거부됩니다. (${sourceKey}, ${item.values.documentNumber}/${item.values.revisionNumber})`,
            documentNumber: item.values.documentNumber,
            revisionNumber: item.values.revisionNumber,
            rowKey: sourceKey
          });
          continue;
        }
      }
    } else {
      const currentHits = byIdentityCurrent.get(identity) || [];
      const excludedHits = byIdentityExcluded.get(identity) || [];
      if (currentHits.length) {
        const hit = currentHits[0];
        errors.push({
          rowNumber: item.rowNumber,
          field: "sourceRowKey",
          code: SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_MISSING_FOR_EXISTING,
          message: `기존 문서의 관리 ID가 삭제되어 있습니다. (${hit.document_number}/${hit.revision_number}, id=${hit.id}, 복구할 rowKey=${hit.excel_row_key || "-"})`,
          documentNumber: hit.document_number,
          revisionNumber: hit.revision_number,
          existingDocumentId: Number(hit.id),
          existingRowKey: hit.excel_row_key || ""
        });
        continue;
      }
      if (excludedHits.length) {
        const hit = excludedHits[0];
        errors.push({
          rowNumber: item.rowNumber,
          field: "sourceRowKey",
          code: SNAPSHOT_ERROR_CODES.SNAPSHOT_ROW_KEY_MISSING_FOR_EXISTING,
          message: `제외 문서와 같은 문서번호·개정번호입니다. (${hit.document_number}/${hit.revision_number}, id=${hit.id}, 복구할 rowKey=${hit.excel_row_key || "-"})`,
          documentNumber: hit.document_number,
          revisionNumber: hit.revision_number,
          existingDocumentId: Number(hit.id),
          existingRowKey: hit.excel_row_key || ""
        });
        continue;
      }
    }

    if (document && matchedIds.has(Number(document.id))) {
      errors.push({
        rowNumber: item.rowNumber,
        field: "match",
        code: SNAPSHOT_ERROR_CODES.SNAPSHOT_IDENTITY_CONFLICT,
        message: `서로 다른 행이 같은 기존 문서에 매칭되었습니다. (${document.document_number}/${document.revision_number}, id=${document.id}, rowKey=${document.excel_row_key || sourceKey || "-"})`,
        documentNumber: document.document_number,
        revisionNumber: document.revision_number,
        existingDocumentId: Number(document.id),
        existingRowKey: document.excel_row_key || ""
      });
      continue;
    }

    if (document) {
      const documentIdentityKey = documentIdentity(document.document_number, document.revision_number);
      if (documentIdentityKey !== identity && (byIdentityCurrent.get(identity) || []).some((candidate) => Number(candidate.id) !== Number(document.id))) {
        const conflict = (byIdentityCurrent.get(identity) || []).find((candidate) => Number(candidate.id) !== Number(document.id));
        errors.push({
          rowNumber: item.rowNumber,
          field: "identity",
          code: SNAPSHOT_ERROR_CODES.SNAPSHOT_IDENTITY_CONFLICT,
          message: `관리 ID가 가리키는 문서(${document.document_number}/${document.revision_number}, id=${document.id})와 행의 문서번호·개정번호(${item.values.documentNumber}/${item.values.revisionNumber})가 다른 현재 문서(id=${conflict?.id || "?"})와 충돌합니다.`,
          documentNumber: item.values.documentNumber,
          revisionNumber: item.values.revisionNumber,
          existingDocumentId: Number(document.id),
          existingRowKey: document.excel_row_key || "",
          conflictDocumentId: conflict ? Number(conflict.id) : null
        });
      }
      if (documentIdentityKey !== identity) identityChangeCount += 1;
      matchedIds.add(Number(document.id));
      const beforeValues = documentToValues(document, lookup);
      const afterValues = buildCanonicalValues({
        ...item.values,
        status: item.status,
        syncState: "current"
      });
      const changedFields = computeChangedFields(beforeValues, afterValues);
      const changeFlags = computeChangeFlags({
        action: "update",
        beforeValues,
        afterValues,
        changedFields
      });
      const effectiveKey = clean(document.excel_row_key) || sourceKey;
      const action = changeFlags.length === 1 && changeFlags[0] === CHANGE_FLAGS.UNCHANGED ? "unchanged" : "update";
      matchedItems.push({
        ...item,
        rowKey: effectiveKey,
        sourceRowKey: sourceKey || null,
        action,
        matchedDocumentId: Number(document.id),
        expectedRowVersion: Number(document.row_version || 1),
        before: buildDiffPayload({ rowKey: effectiveKey, values: beforeValues }),
        after: buildDiffPayload({ rowKey: effectiveKey, values: afterValues }),
        changedFields,
        changeFlags,
        status: item.status,
        values: afterValues
      });
      continue;
    }

    // 신규 행: 서버가 영구 관리 ID를 생성한다.
    const createdKey = sourceKey && isStableRowKey(sourceKey) && !managedMode ? sourceKey : serverGeneratedRowKey();
    if (!sourceKey) blankKeyCreateCount += 1;
    const afterValues = buildCanonicalValues({
      ...item.values,
      status: item.status,
      syncState: "current"
    });
    matchedItems.push({
      ...item,
      rowKey: createdKey,
      sourceRowKey: sourceKey || null,
      action: "create",
      matchedDocumentId: 0,
      expectedRowVersion: null,
      before: null,
      after: buildDiffPayload({ rowKey: createdKey, values: afterValues }),
      changedFields: [],
      changeFlags: [CHANGE_FLAGS.CREATE],
      status: item.status,
      values: afterValues
    });
  }

  const exclusions = documents
    .filter((document) => document.sync_state === "current" && !matchedIds.has(Number(document.id)))
    .map((document) => {
      const values = documentToValues(document, lookup);
      return {
        documentId: Number(document.id),
        excelRowKey: clean(document.excel_row_key),
        expectedRowVersion: Number(document.row_version || 1),
        before: buildDiffPayload({ rowKey: clean(document.excel_row_key), values })
      };
    });

  return {
    ok: errors.length === 0,
    items: matchedItems,
    exclusions,
    matchedIds,
    errors,
    blankKeyCreateCount,
    identityChangeCount
  };
}
