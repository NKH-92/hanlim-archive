import { readBoolean } from "../../../shared/coercion.js";
import { escapeHtml } from "../../../ui/html/escape.js";
import { alertDanger, emptyState, page } from "../../../views/layout.js";

// 대분류와 태그는 같은 구조를 쓴다: 추가 폼 한 줄 → 찾기·사용중지 포함 → 이름순 목록(펼쳐서 수정·사용중지).
// 예외 상태(사용중지)만 배지로 표시하고, 정상 상태·화면 설명은 되풀이하지 않는다.
const MASTER_KINDS = Object.freeze({
  category: Object.freeze({
    title: "대분류 관리",
    noun: "대분류",
    base: "/categories",
    keepSortOrder: true,
    createPlaceholder: "예: 품질관리",
    descriptionPlaceholder: "어떤 문서를 묶는 분류인지 간단히 입력",
    deactivateNote: "사용중지하면 새 문서 등록 화면에서만 보이지 않고, 기존 문서에는 그대로 남아요.",
    reactivateNote: "다시 사용하면 새 문서 등록과 대분류 선택 목록에 표시돼요.",
    accessibleEditNames: false
  }),
  tag: Object.freeze({
    title: "태그 관리",
    noun: "태그",
    base: "/tags",
    keepSortOrder: false,
    createPlaceholder: "예: 감사대상 문서",
    descriptionPlaceholder: "어떤 문서에 붙이는 태그인지 간단히 입력",
    deactivateNote: "사용중지하면 새 문서 등록 화면에서만 보이지 않고, 이미 붙인 문서에는 그대로 남아요.",
    reactivateNote: "다시 사용하면 새 문서 등록과 태그 선택 목록에 표시돼요.",
    accessibleEditNames: true
  })
});

export function categoriesPage({ session, categories, values = {}, error = "" }) {
  return masterPage({ session, kind: MASTER_KINDS.category, rows: categories, values, error });
}

export function tagsPage({ session, tags, values = {}, error = "" }) {
  return masterPage({ session, kind: MASTER_KINDS.tag, rows: tags, values, error });
}

function masterPage({ session, kind, rows, values = {}, error = "" }) {
  const sortedRows = [...rows].sort(compareMastersForManagement);
  const formValues = /** @type {Record<string, unknown>} */ (values);
  const key = kind === MASTER_KINDS.category ? "category" : "tag";
  return page(kind.title, `
    <section class="page-head master-page-head">
      <h1>${escapeHtml(kind.title)}</h1>
    </section>
    ${error ? alertDanger(error) : ""}
    <section class="panel master-create-panel" aria-labelledby="${key}-create-title">
      <div class="section-title master-section-title">
        <h2 id="${key}-create-title">새 ${escapeHtml(kind.noun)} 추가</h2>
      </div>
      <form method="post" action="${kind.base}" class="master-create-form">
        <label><span>이름</span><input name="name" value="${escapeHtml(formValues.name || "")}" required placeholder="${escapeHtml(kind.createPlaceholder)}"></label>
        <label><span>설명 <small>선택</small></span><input name="description" value="${escapeHtml(formValues.description || "")}" placeholder="${escapeHtml(kind.descriptionPlaceholder)}"></label>
        <button type="submit" class="primary">${escapeHtml(kind.noun)} 추가</button>
      </form>
    </section>
    <section class="panel master-management" data-master-management aria-labelledby="${key}-list-title">
      <div class="master-list-heading">
        <h2 id="${key}-list-title">${escapeHtml(kind.noun)} 목록</h2>
        <div class="master-list-tools">
          <label class="master-search-field">
            <span>${escapeHtml(kind.noun)} 찾기</span>
            <input type="search" data-master-search placeholder="이름 또는 설명 검색" autocomplete="off">
          </label>
          <label class="master-inactive-toggle"><input type="checkbox" data-master-inactive-toggle> <span>사용중지 항목 포함</span></label>
        </div>
      </div>
      ${sortedRows.length
        ? `<div class="category-master-list" data-master-list>${sortedRows.map((row) => masterRow(row, kind)).join("")}</div>`
        : emptyState(`등록된 ${kind.noun}가 없어요.`)}
      <div class="empty-state master-filter-empty" data-master-filter-empty hidden aria-live="polite">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <span>조건에 맞는 ${escapeHtml(kind.noun)}가 없어요.</span>
        <small>검색어를 지우거나 사용중지 항목 포함을 선택해 보세요.</small>
      </div>
    </section>
  `, session);
}

function masterRow(row, kind) {
  const active = readBoolean(row.is_active);
  const base = `${kind.base}/${row.id}`;
  const name = escapeHtml(row.name);
  const description = escapeHtml(row.description || "");
  const searchText = escapeHtml(`${row.name || ""} ${row.description || ""}`);
  const version = escapeHtml(row.row_version ?? 0);
  const sortOrder = kind.keepSortOrder ? `<input type="hidden" name="sortOrder" value="${escapeHtml(row.sort_order ?? 0)}">` : "";
  // 태그 수정 칸은 목록 안에 여러 개가 열릴 수 있어 태그 이름을 접근 가능한 이름에 함께 넣는다.
  const nameLabel = kind.accessibleEditNames ? ` aria-label="${name} ${escapeHtml(kind.noun)} 이름"` : "";
  const descriptionLabel = kind.accessibleEditNames ? ` aria-label="${name} ${escapeHtml(kind.noun)} 설명"` : "";
  return `
    <details class="category-master-item" data-master-row data-master-active="${active}" data-master-search-text="${searchText}">
      <summary class="category-master-summary">
        <span class="category-master-copy">
          <strong>${name}</strong>
          <small>${description || "설명 없음"}</small>
        </span>
        <span class="category-master-state">${active ? "" : `<span class="status master-inactive">사용중지</span>`}</span>
        <span class="category-master-toggle">수정</span>
      </summary>
      <div class="category-master-edit">
        <form method="post" action="${base}/edit" class="category-master-edit-form">
          <input type="hidden" name="expectedRowVersion" value="${version}">
          ${sortOrder}
          ${active ? `<input type="hidden" name="isActive" value="1">` : ""}
          <label><span>이름</span><input name="name" value="${name}"${nameLabel} required></label>
          <label><span>설명 <small>선택</small></span><input name="description" value="${description}"${descriptionLabel} placeholder="${escapeHtml(kind.descriptionPlaceholder)}"></label>
          <button type="submit">변경 저장</button>
        </form>
        ${stateAction({ active, base, name, description, sortOrder, version, kind })}
      </div>
    </details>
  `;
}

function stateAction({ active, base, name, description, sortOrder, version, kind }) {
  if (active) {
    return `<div class="category-master-state-action">
      <p>${escapeHtml(kind.deactivateNote)}</p>
      <form method="post" action="${base}/delete" data-confirm="사용을 중지할까요? 신규 등록 화면에는 더 이상 표시되지 않아요.">
        <input type="hidden" name="expectedRowVersion" value="${version}">
        <button type="submit" class="danger-button">사용 중지</button>
      </form>
    </div>`;
  }
  return `<div class="category-master-state-action">
    <p>${escapeHtml(kind.reactivateNote)}</p>
    <form method="post" action="${base}/edit">
      <input type="hidden" name="expectedRowVersion" value="${version}">
      <input type="hidden" name="name" value="${name}">
      <input type="hidden" name="description" value="${description}">
      ${sortOrder}
      <input type="hidden" name="isActive" value="1">
      <button type="submit">다시 사용</button>
    </form>
  </div>`;
}

function compareMastersForManagement(left, right) {
  const activeOrder = Number(readBoolean(right.is_active)) - Number(readBoolean(left.is_active));
  if (activeOrder) return activeOrder;
  return String(left.name || "").localeCompare(String(right.name || ""), "ko");
}
