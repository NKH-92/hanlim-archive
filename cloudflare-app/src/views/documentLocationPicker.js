// 문서 등록 폼의 보관 위치 3단 선택기(랙→열→선반)와 면 표기 동기화.

import { escapeHtml, readBoolean } from "../utils.js";

// 위치 입력 편의 스크립트. 서버 검증(validateDocumentInput)이 최종 방어선이다.
// 1) 랙당 42칸이 되면서 길어진 단일 목록 대신 랙 → 열 → 선반 3단으로 고른다(JS 미지원 시 원래 목록 사용).
// 2) 선택된 랙에 맞춰 면 선택지를 실물 표기(13-1/13-2)로 바꾸고, 단면 랙이면 2면을 잠근다.
export function locationPickerScript() {
  return `
    <script>
      (function () {
        var slotSelect = document.querySelector('select[name="rackSlotId"]');
        var faceSelect = document.querySelector('select[data-rack-face]');
        if (!slotSelect) return;

        var faceA = faceSelect ? faceSelect.querySelector('option[value="A"]') : null;
        var faceB = faceSelect ? faceSelect.querySelector('option[value="B"]') : null;
        var syncFace = function () {
          if (!faceSelect) return;
          var opt = slotSelect.options[slotSelect.selectedIndex];
          var rackNumber = opt ? opt.getAttribute('data-rack-number') || '' : '';
          var single = opt ? opt.getAttribute('data-single-sided') === '1' : false;
          if (single) {
            faceSelect.value = 'A';
            faceB.disabled = true;
            faceA.textContent = rackNumber ? rackNumber + ' (단면 · 면 구분 없음)' : '단면 · 면 구분 없음';
            faceB.textContent = '단면 랙 · 2면 없음';
          } else {
            faceB.disabled = false;
            faceA.textContent = rackNumber ? rackNumber + '-1 (1면)' : '1면';
            faceB.textContent = rackNumber ? rackNumber + '-2 (2면)' : '2면';
          }
        };
        slotSelect.addEventListener('change', syncFace);

        var slotOptions = Array.prototype.slice.call(slotSelect.options).filter(function (o) { return o.value; });
        var racks = [];
        var rackByKey = {};
        slotOptions.forEach(function (o) {
          var key = o.getAttribute('data-zone') + ':' + o.getAttribute('data-rack-number');
          var rack = rackByKey[key];
          if (!rack) {
            rack = {
              key: key,
              zone: o.getAttribute('data-zone'),
              rackNumber: o.getAttribute('data-rack-number'),
              single: o.getAttribute('data-single-sided') === '1',
              columns: {},
              shelves: {},
              slots: {}
            };
            rackByKey[key] = rack;
            racks.push(rack);
          }
          var column = o.getAttribute('data-column');
          var shelf = o.getAttribute('data-shelf');
          rack.columns[column] = true;
          rack.shelves[shelf] = true;
          rack.slots[column + ':' + shelf] = o.value;
        });
        if (!racks.length) { syncFace(); return; }

        var numericKeys = function (map) {
          return Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
        };
        var fillSelect = function (select, placeholder, items, toLabel, selectedValue) {
          select.innerHTML = '';
          var blank = document.createElement('option');
          blank.value = '';
          blank.textContent = placeholder;
          select.appendChild(blank);
          items.forEach(function (item) {
            var option = document.createElement('option');
            option.value = String(item);
            option.textContent = toLabel(item);
            if (String(item) === String(selectedValue)) option.selected = true;
            select.appendChild(option);
          });
        };

        var row = document.createElement('div');
        row.className = 'picker-row';
        var rackSel = document.createElement('select');
        var colSel = document.createElement('select');
        var shelfSel = document.createElement('select');
        [rackSel, colSel, shelfSel].forEach(function (select) {
          select.required = true;
          row.appendChild(select);
        });

        var currentRack = function () { return rackByKey[rackSel.value] || null; };
        var refreshCells = function (selectedColumn, selectedShelf) {
          var rack = currentRack();
          colSel.disabled = shelfSel.disabled = !rack;
          fillSelect(colSel, '열 선택', rack ? numericKeys(rack.columns) : [], function (n) { return n + '열 (면 안쪽부터)'; }, selectedColumn);
          fillSelect(shelfSel, '선반 선택', rack ? numericKeys(rack.shelves) : [], function (n) { return n + '선반 (아래에서)'; }, selectedShelf);
        };
        var apply = function () {
          var rack = currentRack();
          var slotId = rack && colSel.value && shelfSel.value ? rack.slots[colSel.value + ':' + shelfSel.value] || '' : '';
          slotSelect.value = slotId;
          syncFace();
        };

        fillSelect(rackSel, '랙 선택', racks.map(function (rack) { return rack.key; }), function (key) {
          var rack = rackByKey[key];
          return rack.zone + '구역 ' + rack.rackNumber + '번 랙 · ' + (rack.single ? '단면' : '양면 ' + rack.rackNumber + '-1/' + rack.rackNumber + '-2');
        }, '');

        var initial = slotSelect.options[slotSelect.selectedIndex];
        if (initial && initial.value) {
          rackSel.value = initial.getAttribute('data-zone') + ':' + initial.getAttribute('data-rack-number');
          refreshCells(initial.getAttribute('data-column'), initial.getAttribute('data-shelf'));
        } else {
          refreshCells('', '');
        }

        rackSel.addEventListener('change', function () { refreshCells('', ''); apply(); });
        colSel.addEventListener('change', apply);
        shelfSel.addEventListener('change', apply);

        // 원래 목록은 값 운반용으로만 남긴다. required를 3단 선택 쪽으로 옮겨
        // 숨긴 select가 브라우저 필수 검증(포커스 불가 오류)에 걸리지 않게 한다.
        slotSelect.required = false;
        slotSelect.style.display = 'none';
        slotSelect.insertAdjacentElement('afterend', row);
        syncFace();
      })();
    </script>
  `;
}

export function locationPicker(slots, selectedRackSlotId) {
  // 위치 선택 스크립트(locationPickerScript)가 랙 → 열 → 선반 3단 선택과 면 표기 동기화에
  // 쓸 수 있도록 각 칸의 좌표·단면 여부를 data 속성으로 싣는다.
  return `
    <label>보관 위치 <em>*</em>
      <select name="rackSlotId" required>
        <option value="">위치 선택</option>
        ${slots.map((slot) => {
          const selected = String(slot.id) === String(selectedRackSlotId ?? "") ? " selected" : "";
          const label = slot.label || `${slot.zone_number}구역 / ${slot.rack_number}번 랙 / ${slot.column_number}열 / ${slot.shelf_number}선반`;
          const data = [
            `data-zone="${escapeHtml(String(slot.zone_number ?? ""))}"`,
            `data-rack-number="${escapeHtml(String(slot.rack_number ?? ""))}"`,
            `data-column="${escapeHtml(String(slot.column_number ?? ""))}"`,
            `data-shelf="${escapeHtml(String(slot.shelf_number ?? ""))}"`,
            `data-single-sided="${readBoolean(slot.is_single_sided) ? "1" : "0"}"`
          ].join(" ");
          return `<option value="${escapeHtml(String(slot.id))}" ${data}${selected}>${escapeHtml(label)}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}
