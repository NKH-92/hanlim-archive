// 문서 등록·수정 폼. 위치 선택기와 스크립트 삽입 순서를 그대로 유지한다.

import { escapeHtml } from "../../ui/html/escape.js";
import { locationPicker, locationPickerScript } from "../documentLocationPicker.js";
import { formValue, option, page } from "../layout.js";

export function documentFormPage({
  session,
  title,
  action,
  values = {},
  categories,
  tags,
  slots,
  selectedTags = [],
  error = "",
  validation = null,
  showLocation = true
}) {
  const normalizedValidation = normalizeValidation(validation, error);
  const cancelUrl = formCancelUrl(action, values);
  const submitLabel = title === "문서 수정" ? "저장" : "등록";
  const noteLabel = title === "새 개정 등록" ? "필요한 변경사항" : "비고";
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="document-form-layout" data-document-form-layout>
      <form method="post" action="${escapeHtml(action)}" class="panel document-form" data-document-form>
        ${formErrorSummary(normalizedValidation, title)}
        ${duplicateNotice(normalizedValidation.duplicate)}
        ${formValue(values, "returnTo", "return_to") ? `<input type="hidden" name="returnTo" value="${escapeHtml(formValue(values, "returnTo", "return_to"))}">` : ""}
        ${formValue(values, "updatedAt", "updated_at") ? `<input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(formValue(values, "updatedAt", "updated_at"))}">` : ""}
        ${formValue(values, "rowVersion", "row_version") ? `<input type="hidden" name="expectedRowVersion" value="${escapeHtml(formValue(values, "rowVersion", "row_version"))}">` : ""}
        ${values.revisionSourceId ? `<input type="hidden" name="revisionSourceId" value="${Number(values.revisionSourceId)}">` : ""}

        <fieldset class="form-section">
          <legend>문서 정보</legend>
          <div class="form-grid two-column">
            ${textField("documentNumber", "문서번호", formValue(values, "documentNumber", "document_number"), normalizedValidation, { required: true, mono: true })}
            ${textField("revisionNumber", "개정번호", formValue(values, "revisionNumber", "revision_number") || (title === "새 개정 등록" ? "" : "Rev.0"), normalizedValidation, { required: true })}
          </div>
          ${textField("documentName", "문서명", formValue(values, "documentName", "document_name"), normalizedValidation, { required: true })}
          <label for="field-categoryId">대분류 <em>*</em>
            <select id="field-categoryId" name="categoryId" required ${errorAttrs("categoryId", normalizedValidation)}>
              <option value="">대분류 선택</option>
              ${categories.map((category) => option(category.id, category.name, formValue(values, "categoryId", "category_id"))).join("")}
            </select>
          </label>
          ${fieldError("categoryId", normalizedValidation)}
          <fieldset id="field-tagIds" class="check-grid form-tags" tabindex="-1">
            <legend>태그</legend>
            ${tags.map((tag) => `<label class="check-item"><input type="checkbox" name="tagIds" value="${tag.id}" ${selectedTags.includes(tag.id) ? "checked" : ""}><span>${escapeHtml(tag.name)}</span></label>`).join("")}
          </fieldset>
          ${fieldError("tagIds", normalizedValidation)}
        </fieldset>

        <fieldset class="form-section">
          <legend>보존 정보</legend>
          <div class="form-grid two-column">
            ${textField("revisionDate", "제/개정일", formValue(values, "revisionDate", "revision_date"), normalizedValidation, { required: true, type: "date" })}
            ${textField("disposalDueYear", "폐기 예정 년도", formValue(values, "disposalDueYear", "disposal_due_year"), normalizedValidation, { required: true, type: "number", extra: 'min="1900" max="9999" step="1"' })}
          </div>
        </fieldset>

        ${showLocation ? `<fieldset class="form-section">
          <legend>보관 위치</legend>
          ${locationPicker(slots, formValue(values, "rackSlotId", "rack_slot_id"), normalizedValidation.fieldErrors?.rackSlotId)}
          <label for="field-rackFace">보관 면 <em>*</em>
            <select id="field-rackFace" name="rackFace" required data-rack-face ${errorAttrs("rackFace", normalizedValidation)}>${option("A", "1면", formValue(values, "rackFace", "rack_face") || "A")}${option("B", "2면", formValue(values, "rackFace", "rack_face"))}</select>
          </label>
          ${fieldError("rackFace", normalizedValidation)}
          <p class="muted" data-face-hint>양면 랙은 13-1(1면)/13-2(2면)처럼 면 단위로 표기합니다. 단면 랙은 면 구분이 없습니다.</p>
        </fieldset>` : ""}

        <section class="form-section form-note-section" aria-labelledby="note-title">
          <h2 id="note-title">${noteLabel}</h2>
          <label class="sr-only" for="field-note">${noteLabel}</label>
          <textarea id="field-note" name="note" rows="3" ${errorAttrs("note", normalizedValidation)}>${escapeHtml(formValue(values, "note", "note"))}</textarea>
          ${fieldError("note", normalizedValidation)}
        </section>

        <div class="form-actions"><a class="button secondary" href="${escapeHtml(cancelUrl)}">취소</a><button type="submit" class="primary">${submitLabel}</button></div>
      </form>

      <details class="panel form-review" open data-form-review>
        <summary>등록 내용 확인</summary>
        <dl>
          <div><dt>문서번호</dt><dd class="mono" data-summary="documentNumber">-</dd></div>
          <div><dt>개정번호</dt><dd data-summary="revisionNumber">-</dd></div>
          <div><dt>문서명</dt><dd data-summary="documentName">-</dd></div>
          <div><dt>대분류</dt><dd data-summary="categoryId">-</dd></div>
          <div><dt>제/개정일</dt><dd data-summary="revisionDate">-</dd></div>
          <div><dt>폐기 예정</dt><dd data-summary="disposalDueYear">-</dd></div>
          ${showLocation ? `<div><dt>보관 위치</dt><dd class="mono" data-summary="location">-</dd></div>` : ""}
        </dl>
      </details>
    </section>
    ${showLocation ? locationPickerScript() : ""}
    ${documentFormScript(showLocation)}
  `, session);
}

function normalizeValidation(validation, error) {
  if (validation && typeof validation === "object") {
    return { fieldErrors: validation.fieldErrors || {}, formErrors: validation.formErrors || [], duplicate: validation.duplicate || null };
  }
  return { fieldErrors: {}, formErrors: error ? [String(error)] : [], duplicate: null };
}

function textField(name, label, value, validation, { required = false, mono = false, type = "text", extra = "" } = {}) {
  return `<div class="field-group"><label for="field-${name}">${escapeHtml(label)}${required ? " <em>*</em>" : ""}<input id="field-${name}" class="${mono ? "mono-input" : ""}" type="${type}" name="${name}" value="${escapeHtml(value)}" ${required ? "required" : ""} ${extra} ${errorAttrs(name, validation)}></label>${fieldError(name, validation)}</div>`;
}

function errorAttrs(name, validation) {
  return validation.fieldErrors?.[name] ? `aria-invalid="true" aria-describedby="error-${name}"` : "";
}

function fieldError(name, validation) {
  const message = validation.fieldErrors?.[name];
  return message ? `<p class="field-error" id="error-${name}">${escapeHtml(message)}</p>` : "";
}

function formErrorSummary(validation, title) {
  const entries = Object.entries(validation.fieldErrors || {});
  const formErrors = validation.formErrors || [];
  const total = entries.length + formErrors.length;
  if (!total) return "";
  return `<div class="form-error-summary" role="alert" tabindex="-1" data-error-summary><strong>${title === "문서 수정" ? "문서를 수정하지 못했습니다." : "문서를 등록하지 못했습니다."}</strong><p>아래 ${total}개 항목을 확인하세요.</p><ul>${entries.map(([name, message]) => `<li><a href="#field-${escapeHtml(name)}">${escapeHtml(message)}</a></li>`).join("")}${formErrors.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul></div>`;
}

function duplicateNotice(duplicate) {
  const document = duplicate?.document;
  return `<div class="duplicate-notice" data-duplicate-notice role="status" ${document ? "" : "hidden"}><strong>이미 등록된 문서입니다.</strong><p><span class="mono" data-duplicate-code>${document ? `${escapeHtml(document.documentNumber)} / ${escapeHtml(document.revisionNumber)}` : ""}</span><br><span data-duplicate-name>${document ? escapeHtml(document.documentName) : ""}</span> · <span data-duplicate-status>${document ? (document.status === "active" ? "보관중" : "폐기") : ""}</span></p><a class="button secondary sm" data-duplicate-link href="${document ? `/documents/${Number(document.id)}` : "#"}">기존 문서 보기</a></div>`;
}

function formCancelUrl(action, values) {
  if (values.revisionSourceId) return `/documents/${Number(values.revisionSourceId)}`;
  const match = String(action).match(/^\/documents\/(\d+)\/edit$/);
  return match ? `/documents/${match[1]}` : "/app";
}

function documentFormScript(showLocation) {
  return `<script>(function () {
    var form = document.querySelector('[data-document-form]');
    if (!form) return;
    var summary = function (name, value) {
      var target = document.querySelector('[data-summary="' + name + '"]');
      if (target) target.textContent = value || '-';
    };
    var updateSummary = function () {
      ['documentNumber', 'revisionNumber', 'documentName', 'revisionDate'].forEach(function (name) {
        var input = form.elements[name]; summary(name, input ? input.value.trim() : '');
      });
      var year = form.elements.disposalDueYear ? form.elements.disposalDueYear.value.trim() : '';
      summary('disposalDueYear', year ? year + '년' : '');
      var category = form.elements.categoryId;
      summary('categoryId', category && category.selectedIndex > 0 ? category.options[category.selectedIndex].textContent : '');
      ${showLocation ? `var slot = form.elements.rackSlotId;
      var face = form.elements.rackFace;
      var location = slot && slot.value ? slot.options[slot.selectedIndex].textContent : '';
      if (location && face && !face.options[face.selectedIndex].disabled) location += ' · ' + face.options[face.selectedIndex].textContent;
      summary('location', location);` : ""}
    };
    form.addEventListener('input', updateSummary);
    form.addEventListener('change', updateSummary);
    updateSummary();

    var numberInput = form.elements.documentNumber;
    var revisionInput = form.elements.revisionNumber;
    var notice = document.querySelector('[data-duplicate-notice]');
    var timer = 0;
    var requestId = 0;
    var checkDuplicate = function () {
      clearTimeout(timer);
      var current = ++requestId;
      var number = numberInput ? numberInput.value.trim() : '';
      var revision = revisionInput ? revisionInput.value.trim() : '';
      if (!number || !revision || !notice) { if (notice) notice.hidden = true; return; }
      timer = setTimeout(function () {
        var params = new URLSearchParams({ documentNumber: number, revisionNumber: revision });
        var editMatch = form.getAttribute('action').match(/^\\/documents\\/(\\d+)\\/edit$/);
        if (editMatch) params.set('excludeId', editMatch[1]);
        fetch('/api/documents/duplicate?' + params.toString(), { headers: { Accept: 'application/json' } })
          .then(function (response) { if (!response.ok) throw new Error('duplicate-check'); return response.json(); })
          .then(function (result) {
            if (current !== requestId || !result.exists || !result.document) { notice.hidden = true; return; }
            notice.hidden = false;
            notice.querySelector('[data-duplicate-code]').textContent = result.document.documentNumber + ' / ' + result.document.revisionNumber;
            notice.querySelector('[data-duplicate-name]').textContent = result.document.documentName;
            notice.querySelector('[data-duplicate-status]').textContent = result.document.status === 'active' ? '보관중' : '폐기';
            notice.querySelector('[data-duplicate-link]').href = '/documents/' + result.document.id;
          }).catch(function () { if (current === requestId) notice.hidden = true; });
      }, 300);
    };
    if (numberInput) numberInput.addEventListener('input', checkDuplicate);
    if (revisionInput) revisionInput.addEventListener('input', checkDuplicate);
    var errorSummary = document.querySelector('[data-error-summary]');
    if (errorSummary) errorSummary.focus();
  })();</script>`;
}
