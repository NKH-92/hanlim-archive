// 문서 등록 폼의 보관 위치 선택기. 서버 저장값은 rackSlotId/rackFace를 유지하고,
// 브라우저에서는 실제 위치 표현 순서(구역→랙→면→열→선반)로 점진 향상한다.

import { readBoolean } from "../shared/coercion.js";
import { escapeHtml } from "../ui/html/escape.js";

export function locationPickerScript() {
  return `
    <script>
      (function () {
        var slotSelect = document.querySelector('select[name="rackSlotId"]');
        var faceSelect = document.querySelector('select[data-rack-face]');
        if (!slotSelect || !faceSelect) return;

        var slotOptions = Array.prototype.slice.call(slotSelect.options).filter(function (option) { return option.value; });
        var racks = [];
        var rackByKey = {};
        slotOptions.forEach(function (option) {
          var key = option.getAttribute('data-zone') + ':' + option.getAttribute('data-rack-number');
          var rack = rackByKey[key];
          if (!rack) {
            rack = {
              key: key,
              zone: option.getAttribute('data-zone'),
              rackNumber: option.getAttribute('data-rack-number'),
              single: option.getAttribute('data-single-sided') === '1',
              columns: {}, shelves: {}, slots: {}
            };
            rackByKey[key] = rack;
            racks.push(rack);
          }
          var column = option.getAttribute('data-column');
          var shelf = option.getAttribute('data-shelf');
          rack.columns[column] = true;
          rack.shelves[shelf] = true;
          rack.slots[column + ':' + shelf] = option.value;
        });
        if (!racks.length) return;

        var numericKeys = function (map) { return Object.keys(map).map(Number).sort(function (a, b) { return a - b; }); };
        var fillSelect = function (select, placeholder, items, label, selected) {
          select.innerHTML = '';
          var blank = document.createElement('option');
          blank.value = '';
          blank.textContent = placeholder;
          select.appendChild(blank);
          items.forEach(function (item) {
            var option = document.createElement('option');
            option.value = String(item);
            option.textContent = label(item);
            if (String(item) === String(selected || '')) option.selected = true;
            select.appendChild(option);
          });
        };
        var wrap = function (label, select) {
          var holder = document.createElement('label');
          var text = document.createElement('span');
          text.textContent = label;
          holder.appendChild(text);
          holder.appendChild(select);
          return holder;
        };

        var row = document.createElement('div');
        row.className = 'location-picker-steps';
        var zoneSelect = document.createElement('select');
        var rackSelect = document.createElement('select');
        var faceProxy = document.createElement('select');
        var columnSelect = document.createElement('select');
        var shelfSelect = document.createElement('select');
        zoneSelect.id = 'field-locationZone';
        faceProxy.id = 'field-locationFace';
        [zoneSelect, rackSelect, faceProxy, columnSelect, shelfSelect].forEach(function (select) { select.required = true; });
        row.appendChild(wrap('구역', zoneSelect));
        row.appendChild(wrap('랙', rackSelect));
        row.appendChild(wrap('면', faceProxy));
        row.appendChild(wrap('열', columnSelect));
        row.appendChild(wrap('선반', shelfSelect));

        var currentRack = function () { return rackByKey[rackSelect.value] || null; };
        var syncFace = function () {
          var rack = currentRack();
          var selected = faceSelect.value === 'B' ? 'B' : 'A';
          faceProxy.innerHTML = '';
          var first = document.createElement('option');
          first.value = 'A';
          first.textContent = rack ? (rack.single ? rack.rackNumber + '번 랙 · 단면' : rack.rackNumber + '-1 · 1면') : '1면';
          faceProxy.appendChild(first);
          var second = document.createElement('option');
          second.value = 'B';
          second.textContent = rack ? rack.rackNumber + '-2 · 2면' : '2면';
          second.disabled = !rack || rack.single;
          faceProxy.appendChild(second);
          if (rack && rack.single) selected = 'A';
          faceProxy.value = selected;
          faceSelect.value = selected;
          var originalB = faceSelect.querySelector('option[value="B"]');
          if (originalB) originalB.disabled = Boolean(rack && rack.single);
        };
        var refreshRacks = function (selectedRack) {
          var matching = racks.filter(function (rack) { return rack.zone === zoneSelect.value; });
          fillSelect(rackSelect, '랙 선택', matching.map(function (rack) { return rack.key; }), function (key) {
            var rack = rackByKey[key];
            return rack.rackNumber + '번 랙 · ' + (rack.single ? '단면' : '양면');
          }, selectedRack);
          rackSelect.disabled = !zoneSelect.value;
        };
        var refreshCells = function (selectedColumn, selectedShelf) {
          var rack = currentRack();
          columnSelect.disabled = shelfSelect.disabled = !rack;
          fillSelect(columnSelect, '열 선택', rack ? numericKeys(rack.columns) : [], function (number) { return number + '열'; }, selectedColumn);
          fillSelect(shelfSelect, '선반 선택', rack ? numericKeys(rack.shelves) : [], function (number) { return number + '선반'; }, selectedShelf);
          syncFace();
        };
        var apply = function () {
          var rack = currentRack();
          slotSelect.value = rack && columnSelect.value && shelfSelect.value ? rack.slots[columnSelect.value + ':' + shelfSelect.value] || '' : '';
          syncFace();
        };

        var zones = Array.from(new Set(racks.map(function (rack) { return rack.zone; }))).sort(function (a, b) { return Number(a) - Number(b); });
        fillSelect(zoneSelect, '구역 선택', zones, function (zone) { return zone + '구역'; }, '');
        var initial = slotSelect.options[slotSelect.selectedIndex];
        if (initial && initial.value) {
          zoneSelect.value = initial.getAttribute('data-zone');
          var initialRack = initial.getAttribute('data-zone') + ':' + initial.getAttribute('data-rack-number');
          refreshRacks(initialRack);
          refreshCells(initial.getAttribute('data-column'), initial.getAttribute('data-shelf'));
        } else {
          refreshRacks('');
          refreshCells('', '');
        }

        zoneSelect.addEventListener('change', function () { refreshRacks(''); refreshCells('', ''); apply(); });
        rackSelect.addEventListener('change', function () { refreshCells('', ''); apply(); });
        columnSelect.addEventListener('change', apply);
        shelfSelect.addEventListener('change', apply);
        faceProxy.addEventListener('change', function () {
          faceSelect.value = faceProxy.value;
          faceSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });

        slotSelect.required = false;
        slotSelect.closest('label').classList.add('enhanced-control-hidden');
        faceSelect.required = false;
        faceSelect.closest('label').classList.add('enhanced-control-hidden');
        slotSelect.closest('label').insertAdjacentElement('afterend', row);
        document.querySelectorAll('[data-error-summary] a[href="#field-rackSlotId"]').forEach(function (link) { link.setAttribute('href', '#field-locationZone'); });
        document.querySelectorAll('[data-error-summary] a[href="#field-rackFace"]').forEach(function (link) { link.setAttribute('href', '#field-locationFace'); });
        syncFace();
      })();
    </script>
  `;
}

export function locationPicker(slots, selectedRackSlotId, error = "") {
  return `
    <label for="field-rackSlotId">보관 위치 <em>*</em>
      <select id="field-rackSlotId" name="rackSlotId" required ${error ? 'aria-invalid="true" aria-describedby="error-rackSlotId"' : ""}>
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
    ${error ? `<p class="field-error" id="error-rackSlotId">${escapeHtml(error)}</p>` : ""}
  `;
}
