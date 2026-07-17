// 문서 등록·수정 폼. 위치 선택기와 스크립트 삽입 순서를 그대로 유지한다.

import { escapeHtml } from "../../utils.js";
import { locationPicker, locationPickerScript } from "../documentLocationPicker.js";
import { alertDanger, formValue, option, page } from "../layout.js";

export function documentFormPage({ session, title, action, values = {}, categories, tags, slots, selectedTags = [], error = "", showLocation = true }) {
  return page(title, `
    <section class="page-head"><h1>${escapeHtml(title)}</h1></section>
    <section class="panel narrow">
      ${error ? alertDanger(error) : ""}
      <form method="post" action="${escapeHtml(action)}" class="stack">
        ${formValue(values, "returnTo", "return_to") ? `<input type="hidden" name="returnTo" value="${escapeHtml(formValue(values, "returnTo", "return_to"))}">` : ""}
        ${formValue(values, "updatedAt", "updated_at") ? `<input type="hidden" name="expectedUpdatedAt" value="${escapeHtml(formValue(values, "updatedAt", "updated_at"))}">` : ""}
        ${formValue(values, "rowVersion", "row_version") ? `<input type="hidden" name="expectedRowVersion" value="${escapeHtml(formValue(values, "rowVersion", "row_version"))}">` : ""}
        <label>문서번호 <em>*</em><input name="documentNumber" value="${escapeHtml(formValue(values, "documentNumber", "document_number"))}" required></label>
        <label>개정번호 <em>*</em><input name="revisionNumber" value="${escapeHtml(formValue(values, "revisionNumber", "revision_number") || "Rev.0")}" required></label>
        <label>문서명 <em>*</em><input name="documentName" value="${escapeHtml(formValue(values, "documentName", "document_name"))}" required></label>
        <label>제/개정일 <em>*</em><input type="date" name="revisionDate" value="${escapeHtml(formValue(values, "revisionDate", "revision_date"))}" required></label>
        <label>폐기 예정 년도 <em>*</em><input type="number" name="disposalDueYear" min="1900" max="9999" step="1" value="${escapeHtml(formValue(values, "disposalDueYear", "disposal_due_year"))}" required></label>
        <label>대분류 <em>*</em><select name="categoryId" required>${categories.map((c) => option(c.id, c.name, formValue(values, "categoryId", "category_id"))).join("")}</select></label>
        ${showLocation ? `${locationPicker(slots, formValue(values, "rackSlotId", "rack_slot_id"))}
        <label>보관 면 <em>*</em><select name="rackFace" required data-rack-face>${option("A", "1면", formValue(values, "rackFace", "rack_face") || "A")}${option("B", "2면", formValue(values, "rackFace", "rack_face"))}</select></label>
        <p class="muted" data-face-hint>양면 랙은 13-1(1면)/13-2(2면)처럼 면 단위로 표기합니다. 단면 랙은 면 구분이 없습니다.</p>` : ""}
        <fieldset class="check-grid">
          <legend>태그</legend>
          ${tags.map((tag) => `<label class="check-item"><input type="checkbox" name="tagIds" value="${tag.id}" ${selectedTags.includes(tag.id) ? "checked" : ""}><span>${escapeHtml(tag.name)}</span></label>`).join("")}
        </fieldset>
        <label>비고<textarea name="note" rows="3">${escapeHtml(formValue(values, "note", "note"))}</textarea></label>
        <button type="submit" class="primary">저장</button>
      </form>
    </section>
    ${showLocation ? locationPickerScript() : ""}
  `, session);
}
