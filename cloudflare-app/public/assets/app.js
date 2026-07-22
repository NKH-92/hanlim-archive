// generated from src/views/clientScript.js; do not edit

    document.addEventListener('DOMContentLoaded', function () {
      var escapeHtmlClient = (function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
});
      var nav = document.querySelector('[data-nav-menu]');
      var scrim = document.querySelector('[data-nav-scrim]');
      var hamburger = document.querySelector('[data-hamburger]');
      var close = document.querySelector('[data-drawer-close]');
      var mediaQuery = function (query) {
        return typeof window.matchMedia === 'function'
          ? window.matchMedia(query)
          : { matches: false, addEventListener: function () {} };
      };
      var mobileNavigation = mediaQuery('(max-width: 1099px)');
      function navFocusable() {
        return nav ? Array.from(nav.querySelectorAll('a[href], button:not([disabled]), summary, input:not([disabled])')).filter(function (item) { return !item.hidden; }) : [];
      }
      function setNav(open, restoreFocus) {
        if (!nav) return;
        var mobile = mobileNavigation.matches;
        var visible = mobile && open;
        nav.classList.toggle('is-open', visible);
        if (scrim) scrim.classList.toggle('is-open', visible);
        if (hamburger) hamburger.setAttribute('aria-expanded', visible ? 'true' : 'false');
        if (mobile) {
          nav.inert = !visible;
          nav.setAttribute('aria-hidden', visible ? 'false' : 'true');
        } else {
          nav.inert = false;
          nav.removeAttribute('aria-hidden');
        }
        if (visible) setTimeout(function () { (close || navFocusable()[0])?.focus(); }, 0);
        if (!visible && restoreFocus && hamburger) hamburger.focus();
      }
      setNav(false, false);
      mobileNavigation.addEventListener?.('change', function () { setNav(false, false); });
      if (hamburger) hamburger.addEventListener('click', function () { setNav(true, false); });
      if (close) close.addEventListener('click', function () { setNav(false, true); });
      if (scrim) scrim.addEventListener('click', function () { setNav(false, true); });
      document.addEventListener('keydown', function (event) {
        if (!mobileNavigation.matches || !nav?.classList.contains('is-open')) return;
        if (event.key === 'Escape') { event.preventDefault(); setNav(false, true); return; }
        if (event.key !== 'Tab') return;
        var items = navFocusable();
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });

      if (typeof document.createElement === 'function' && document.body?.appendChild) {
        var confirmDialog = document.createElement('dialog');
        confirmDialog.className = 'app-confirm-dialog';
        confirmDialog.setAttribute('aria-labelledby', 'app-confirm-title');
        confirmDialog.innerHTML = '<form method="dialog" class="modal-body"><h2 id="app-confirm-title">작업 확인</h2><p data-confirm-message></p><div class="button-group"><button value="cancel" class="button secondary">취소</button><button value="confirm" class="danger-button" data-confirm-accept>계속</button></div></form>';
        document.body.appendChild(confirmDialog);
        var pendingForm = null;
        var pendingSubmitter = null;
        document.querySelectorAll('[data-confirm]').forEach(function (form) {
          form.addEventListener('submit', function (event) {
            if (form.dataset.confirmed === 'true') { delete form.dataset.confirmed; return; }
            event.preventDefault();
            pendingForm = form;
            pendingSubmitter = event.submitter || null;
            var message = confirmDialog.querySelector('[data-confirm-message]');
            if (message) message.textContent = form.dataset.confirm || '이 작업을 계속할까요?';
            if (typeof confirmDialog.showModal === 'function') confirmDialog.showModal();
          });
        });
        confirmDialog.addEventListener('close', function () {
          if (confirmDialog.returnValue === 'confirm' && pendingForm) {
            var form = pendingForm;
            var submitter = pendingSubmitter;
            pendingForm = null;
            pendingSubmitter = null;
            form.dataset.confirmed = 'true';
            form.requestSubmit(submitter || undefined);
            return;
          }
          pendingForm = null;
          pendingSubmitter = null;
        });
      }

      window.showAppMessage = function (message, isError) {
        if (typeof document.createElement !== 'function' || !document.body?.appendChild) return;
        document.querySelector('[data-global-message]')?.remove();
        var notice = document.createElement('div');
        notice.className = 'app-toast is-visible' + (isError ? ' is-error' : '');
        notice.setAttribute('role', isError ? 'alert' : 'status');
        notice.setAttribute('data-global-message', '');
        var text = document.createElement('span');
        text.textContent = String(message || '');
        var dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'icon-button';
        dismiss.setAttribute('aria-label', '알림 닫기');
        dismiss.textContent = '×';
        dismiss.addEventListener('click', function () { notice.remove(); });
        notice.append(text, dismiss);
        document.body.appendChild(notice);
      };

      document.querySelectorAll('[data-filter-toggle]').forEach(function (button) {
        var panel = document.getElementById(button.getAttribute('aria-controls') || '');
        if (!panel) return;
        function setFilterOpen(open) {
          panel.hidden = mediaQuery('(max-width: 760px)').matches ? !open : false;
          button.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
        }
        setFilterOpen(panel.dataset.active === 'true');
        button.addEventListener('click', function () { setFilterOpen(panel.hidden); });
      });

      document.querySelectorAll('[data-print]').forEach(function (button) {
        button.addEventListener('click', function () { window.print(); });
      });

      document.querySelectorAll('[data-auto-submit] select, [data-auto-submit] input[type="checkbox"]').forEach(function (control) {
        control.addEventListener('change', function () {
          if (control.form) control.form.submit();
        });
      });

      document.querySelectorAll('[data-tab]').forEach(function (tab) {
        tab.addEventListener('click', function () {
          var id = tab.dataset.tab;
          var nav = tab.closest('.tab-nav');
          if (nav) nav.querySelectorAll('[role="tab"]').forEach(function (item) { item.setAttribute('aria-selected', 'false'); });
          tab.setAttribute('aria-selected', 'true');
          document.querySelectorAll('.tab-panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + id; });
        });
      });

      document.querySelectorAll('[data-open-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
          var modal = document.getElementById(button.dataset.openModal);
          if (modal && modal.showModal) modal.showModal();
        });
      });
      document.querySelectorAll('[data-close-modal]').forEach(function (button) {
        button.addEventListener('click', function () {
          var modal = button.closest('dialog');
          if (modal) modal.close();
        });
      });

      document.querySelectorAll('[data-search-form]').forEach(function (form) {
        form.addEventListener('submit', function () {
          var input = form.querySelector('input[name="q"]');
          var value = input ? input.value.trim() : '';
          if (!value) return;
          try {
            var recent = JSON.parse(localStorage.getItem('hanlimRecentSearches') || '[]').filter(function (item) { return item !== value; });
            recent.unshift(value);
            localStorage.setItem('hanlimRecentSearches', JSON.stringify(recent.slice(0, 6)));
          } catch {}
        });
      });

      var recentBox = document.querySelector('[data-recent-searches]');
      if (recentBox) {
        try {
          var recent = JSON.parse(localStorage.getItem('hanlimRecentSearches') || '[]');
          if (recent.length) {
            recentBox.innerHTML = '<span>최근 검색</span>' + recent.map(function (item) {
              return '<a class="chip" href="/app?q=' + encodeURIComponent(item) + '">' + escapeHtmlClient(item) + '</a>';
            }).join('');
          }
        } catch {}
      }

      // 즉시검색은 결과 버튼을 innerHTML로 나중에 만든다. 문서에 한 번만 위임해 서버 렌더,
      // 문서 상세, 동적 결과가 모두 같은 복사 동작을 쓰게 한다.
      document.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-copy-text]') : null;
        if (!button) return;
        var text = button.dataset.copyText || '';
        if (!text) return;
        var originalHtml = button.innerHTML;
        function done() {
          button.textContent = '복사됨';
          setTimeout(function () { button.innerHTML = originalHtml; }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {});
        } else {
          var input = document.createElement('textarea');
          input.value = text;
          input.setAttribute('readonly', '');
          input.style.position = 'fixed';
          input.style.left = '-9999px';
          document.body.appendChild(input);
          input.select();
          try { document.execCommand('copy'); done(); } catch {}
          input.remove();
        }
      });

      document.querySelectorAll('[data-suggest-input]').forEach(function (input) {
        var datalist = input.parentElement ? input.parentElement.querySelector('[data-suggest-list]') : null;
        var timer = null;
        input.addEventListener('input', function () {
          clearTimeout(timer);
          var q = input.value.trim();
          if (!datalist || q.length < 2) return;
          if (input.closest('[data-viewer-form]') && window.__hanlimSearchIndexReady) {
            datalist.innerHTML = '';
            return;
          }
          timer = setTimeout(function () {
            if (input.closest('[data-viewer-form]') && window.__hanlimSearchIndexReady) return;
            var statusControl = input.form ? input.form.querySelector('select[name="status"]') : null;
            var suggestionUrl = '/api/search-suggestions?q=' + encodeURIComponent(q);
            if (statusControl && statusControl.value === 'disposed') suggestionUrl += '&status=disposed';
            fetch(suggestionUrl, { headers: { Accept: 'application/json' } })
              .then(function (response) { return response.ok ? response.json() : { suggestions: [] }; })
              .then(function (data) {
                datalist.innerHTML = (data.suggestions || []).map(function (item) {
                  return '<option value="' + escapeHtmlClient(item.value) + '">' + escapeHtmlClient(item.label || item.value) + '</option>';
                }).join('');
              })
              .catch(function () {});
          }, 180);
        });
      });

      var bulkBar = document.querySelector('[data-bulk-bar]');
      var bulkIds = document.querySelector('[data-bulk-ids]');
      var bulkCount = document.querySelector('[data-bulk-count]');
      var bulkSummary = document.querySelector('[data-bulk-summary]');
      var bulkSelectAll = document.querySelector('[data-bulk-select-all]');
      var bulkConfirmCount = document.querySelector('[data-bulk-confirm-count]');
      var bulkConfirmCountInput = document.querySelector('[data-bulk-confirm-count-input]');
      var bulkConfirmButton = document.querySelector('[data-bulk-confirm-button]');
      function syncBulk() {
        var items = Array.from(document.querySelectorAll('[data-bulk-item]'));
        var checkedItems = items.filter(function (item) { return item.checked; });
        var checked = checkedItems.map(function (item) { return item.value; });
        if (bulkBar) bulkBar.hidden = checked.length === 0;
        if (bulkIds) bulkIds.value = checked.join(',');
        if (bulkCount) bulkCount.textContent = '원본 ' + checked.length + '부 선택';
        if (bulkConfirmCount) bulkConfirmCount.textContent = checked.length + '부';
        if (bulkConfirmCountInput) bulkConfirmCountInput.value = String(checked.length);
        if (bulkConfirmButton) {
          bulkConfirmButton.disabled = checked.length === 0;
          bulkConfirmButton.textContent = checked.length
            ? '예, 원본 ' + checked.length + '부를 폐기합니다'
            : '예, 폐기합니다';
        }
        if (bulkSummary) {
          bulkSummary.innerHTML = '';
          checkedItems.forEach(function (item) {
            var row = item.closest('[data-document-row]');
            var name = row ? row.querySelector('.name-cell a') : null;
            var number = row ? row.querySelector('.mono-cell') : null;
            var revision = row ? row.querySelector('.revision-cell') : null;
            var entry = document.createElement('li');
            entry.textContent = (number ? number.textContent.trim() : '선택 문서') +
              (revision ? ' / ' + revision.textContent.trim() : '') +
              (name ? ' · ' + name.textContent.trim() : '');
            bulkSummary.appendChild(entry);
          });
        }
        if (bulkSelectAll) {
          bulkSelectAll.checked = items.length > 0 && checked.length === items.length;
          bulkSelectAll.indeterminate = checked.length > 0 && checked.length < items.length;
          bulkSelectAll.disabled = items.length === 0;
        }
      }
      document.querySelectorAll('[data-bulk-item]').forEach(function (item) { item.addEventListener('change', syncBulk); });
      if (bulkSelectAll) {
        bulkSelectAll.addEventListener('change', function () {
          document.querySelectorAll('[data-bulk-item]').forEach(function (item) { item.checked = bulkSelectAll.checked; });
          syncBulk();
        });
      }
      syncBulk();

      var commandPalette = document.querySelector('[data-command-palette]');
      var commandInput = document.querySelector('[data-command-input]');
      var commandItems = Array.prototype.slice.call(document.querySelectorAll('[data-command-item]'));
      var filterCommands = function () {
        var query = (commandInput ? commandInput.value : '').trim().toLocaleLowerCase('ko-KR');
        commandItems.forEach(function (item) {
          var label = (item.getAttribute('data-command-label') || item.textContent || '').toLocaleLowerCase('ko-KR');
          item.hidden = Boolean(query && label.indexOf(query) === -1);
        });
      };
      var openCommands = function () {
        if (!commandPalette || typeof commandPalette.showModal !== 'function') return;
        if (!commandPalette.open) commandPalette.showModal();
        if (commandInput) {
          commandInput.value = '';
          filterCommands();
          setTimeout(function () { commandInput.focus(); }, 0);
        }
      };
      document.querySelectorAll('[data-command-open]').forEach(function (button) {
        button.addEventListener('click', openCommands);
      });
      document.querySelectorAll('[data-command-close]').forEach(function (button) {
        button.addEventListener('click', function () { if (commandPalette && commandPalette.open) commandPalette.close(); });
      });
      if (commandInput) commandInput.addEventListener('input', filterCommands);
      document.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('en-US') === 'k') {
          event.preventDefault();
          openCommands();
        }
      });

      var bulkForm = document.querySelector('[data-bulk-form]');
      if (bulkForm) {
        bulkForm.addEventListener('submit', function (event) {
          var count = document.querySelectorAll('[data-bulk-item]:checked').length;
          var confirmedCount = Number(bulkConfirmCountInput ? bulkConfirmCountInput.value : 0);
          if (!count || confirmedCount !== count) event.preventDefault();
        });
      }


      var excelRoot = document.querySelector('[data-excel-snapshot]');
      var excelUploadForm = document.querySelector('[data-excel-snapshot-upload]');
      var excelHeaders = ["문서번호","개정번호","제/개정일","폐기 예정 년도","문서명","문서종류","랙 위치 (번호)","랙 위치 (열)","랙 위치 (선반)","랙 위치 (단면)","태그","비고","상태"];
      var excelCachedFile = null;
      var excelCachedParsed = null;
      var excelSnapshotMaxFileBytes = 10485760;
      var excelSnapshotMaxZipEntries = 500;
      var excelSnapshotMaxZipUncompressedBytes = 52428800;
      var excelCsvFormulaPrefix = new RegExp("^[\\s\\u0000-\\u001F\\u007F-\\u009F]*[=+\\-@]");

      function excelCellText(cell) {
        var value = cell && cell.value;
        if (value === null || value === undefined) return '';
        if (value instanceof Date) {
          return excelUtcDateOnly(value);
        }
        if (typeof value === 'object' && value.result !== undefined) value = value.result;
        if (typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map(function (part) { return part.text || ''; }).join('').trim();
        if (typeof value === 'object' && value.text !== undefined) return String(value.text).trim();
        return String(value).trim();
      }

      function excelUtcDateOnly(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        var year = date.getUTCFullYear();
        var month = String(date.getUTCMonth() + 1).padStart(2, '0');
        var day = String(date.getUTCDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      }

      function excelDateOnlyToUtcDate(value) {
        var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        var date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
        return date;
      }

      function excelDateText(cell, workbook) {
        var value = cell && cell.value;
        if (value instanceof Date) return excelUtcDateOnly(value);
        if (typeof value === 'number' && Number.isFinite(value)) {
          var date1904 = !!(workbook && workbook.properties && workbook.properties.date1904);
          var epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
          var date = new Date(epoch + Math.round(value * 86400000));
          return excelUtcDateOnly(date);
        }
        return excelCellText(cell);
      }

      function excelDataSheet(workbook) {
        var preferred = workbook.getWorksheet('문서데이터') || workbook.getWorksheet('업로드양식');
        var candidates = preferred ? [preferred].concat(workbook.worksheets.filter(function (sheet) { return sheet !== preferred; })) : workbook.worksheets;
        for (var i = 0; i < candidates.length; i += 1) {
          var matches = excelHeaders.every(function (header, index) { return excelCellText(candidates[i].getCell(1, index + 1)) === header; });
          if (matches) return candidates[i];
        }
        return null;
      }

      function excelMeta(workbook) {
        var sheet = workbook.getWorksheet('_시스템정보');
        if (!sheet) return { hasSystemInfo: false, baseVersion: 0, schemaVersion: 0, currentSnapshotId: 0, exportManifestId: '', canonicalExportHash: '' };
        var values = {};
        sheet.eachRow(function (row) { values[excelCellText(row.getCell(1))] = excelCellText(row.getCell(2)); });
        return {
          hasSystemInfo: true,
          baseVersion: Number(values.baseVersion || 0),
          schemaVersion: Number(values.schemaVersion || 0),
          currentSnapshotId: Number(values.currentSnapshotId || 0),
          exportManifestId: values.exportManifestId || values.sourceExportId || '',
          canonicalExportHash: values.canonicalExportHash || ''
        };
      }


      function excelRelationshipSourceDirectory(relationshipPath) {
        if (relationshipPath === '_rels/.rels') return [];
        var marker = '/_rels/';
        var markerIndex = relationshipPath.indexOf(marker);
        if (markerIndex < 0) return [];
        var source = relationshipPath.slice(0, markerIndex).split('/');
        source.push(relationshipPath.slice(markerIndex + marker.length, -'.rels'.length));
        source.pop();
        return source;
      }

      function excelRelativeRelationshipTarget(relationshipPath, absoluteTarget) {
        var source = excelRelationshipSourceDirectory(relationshipPath);
        var target = absoluteTarget.replace(/^\/+/, '').split('/');
        var common = 0;
        while (common < source.length && common < target.length && source[common] === target[common]) common += 1;
        var relative = [];
        for (var index = common; index < source.length; index += 1) relative.push('..');
        return relative.concat(target.slice(common)).join('/');
      }

      async function excelNormalizeOpenXml(buffer) {
        if (!window.JSZip) return { changed: false, buffer: buffer };
        var zip = await window.JSZip.loadAsync(buffer);
        var names = Object.keys(zip.files);
        var namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        var changed = false;
        for (var index = 0; index < names.length; index += 1) {
          var name = names[index];
          var entry = zip.files[name];
          if (!entry || entry.dir || (!name.endsWith('.xml') && !name.endsWith('.rels'))) continue;
          var original = await entry.async('string');
          var compatible = original;
          if (name.endsWith('.xml') && compatible.indexOf('xmlns:x="' + namespace + '"') >= 0) {
            compatible = compatible
              .replace(/<(\/?)x:/g, '<$1')
              .replace(' xmlns:x="' + namespace + '"', ' xmlns="' + namespace + '"');
          }
          if (name.endsWith('.rels')) {
            compatible = compatible.replace(/Target=(["'])\/(xl\/[^"'#?]+)\1/g, function (_, quote, target) {
              return 'Target=' + quote + excelRelativeRelationshipTarget(name, target) + quote;
            });
          }
          if (compatible !== original) {
            zip.file(name, compatible);
            changed = true;
          }
        }
        if (!changed) return { changed: false, buffer: buffer };
        return { changed: true, buffer: await zip.generateAsync({ type: 'arraybuffer' }) };
      }

      async function excelAssertZipSafety(buffer, maxUncompressedBytes, maxEntries) {
        if (!window.JSZip) throw new Error('엑셀 ZIP 안전성 검사 모듈을 불러오지 못했습니다. 화면을 새로고침하세요.');
        var zip = await window.JSZip.loadAsync(buffer);
        var entries = Object.keys(zip.files);
        if (entries.length > maxEntries) throw new Error('엑셀 ZIP 항목 수가 안전 한도를 초과했습니다.');
        var total = 0;
        for (var index = 0; index < entries.length; index += 1) {
          var entry = zip.files[entries[index]];
          if (!entry || entry.dir) continue;
          var size = Number(entry._data && entry._data.uncompressedSize);
          if (!Number.isFinite(size) || size < 0) throw new Error('엑셀 ZIP 항목 크기를 검증할 수 없습니다.');
          total += size;
          if (total > maxUncompressedBytes) throw new Error('엑셀 압축 해제 크기가 50MB 안전 한도를 초과했습니다.');
        }
      }

      async function excelLoadWorkbook(buffer) {
        var workbook = new window.ExcelJS.Workbook();
        try {
          await workbook.xlsx.load(buffer);
          return workbook;
        } catch (originalError) {
          var normalized;
          try {
            normalized = await excelNormalizeOpenXml(buffer);
          } catch {
            throw originalError;
          }
          if (!normalized.changed) throw originalError;
          workbook = new window.ExcelJS.Workbook();
          try {
            await workbook.xlsx.load(normalized.buffer);
            return workbook;
          } catch (normalizedError) {
            throw new Error('엑셀 파일 구조를 읽을 수 없습니다. Excel에서 다시 저장한 뒤 시도하세요. (' + normalizedError.message + ')');
          }
        }
      }


      async function readExcelSnapshot(file) {
        if (!window.ExcelJS) throw new Error('엑셀 처리 모듈을 불러오지 못했습니다. 화면을 새로고침하세요.');
        if (!file || !/\.xlsx$/i.test(file.name || '')) throw new Error('xlsx 형식의 엑셀 파일을 선택하세요.');
        if (!Number.isInteger(file.size) || file.size < 1) throw new Error('원본 엑셀 파일 크기를 확인할 수 없습니다.');
        if (file.size > excelSnapshotMaxFileBytes) throw new Error('엑셀 파일은 10MB 이하여야 합니다.');
        var buffer = await file.arrayBuffer();
        await excelAssertZipSafety(buffer, excelSnapshotMaxZipUncompressedBytes, excelSnapshotMaxZipEntries);
        var workbook = await excelLoadWorkbook(buffer);
        var sheet = excelDataSheet(workbook);
        if (!sheet) throw new Error('한글 13개 열이 순서대로 있는 문서데이터 시트를 찾을 수 없습니다.');
        var meta = excelMeta(workbook);
        var rows = [];
        var originalKeyCount = 0;
        for (var rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
          var row = sheet.getRow(rowNumber);
          var visible = excelHeaders.map(function (_, index) { return excelCellText(row.getCell(index + 1)); });
          if (visible.every(function (value) { return !value; })) continue;
          var originalKey = excelCellText(row.getCell(14));
          if (originalKey) originalKeyCount += 1;
          rows.push({
            rowNumber: rowNumber,
            sourceRowKey: originalKey || '',
            source: {
              documentNumber: visible[0], revisionNumber: visible[1], revisionDate: excelDateText(row.getCell(3), workbook),
              disposalDueYear: visible[3], documentName: visible[4], category: visible[5], rackNumber: visible[6],
              rackColumn: visible[7], shelfNumber: visible[8], rackFace: visible[9], tags: visible[10], note: visible[11], status: visible[12]
            }
          });
        }
        if (!rows.length) throw new Error('엑셀에 동기화할 문서가 없습니다.');
        if (rows.length > 1000) throw new Error('엑셀 문서는 최대 1,000건까지 동기화할 수 있습니다.');
        if (meta.hasSystemInfo) {
          if (!meta.schemaVersion) throw new Error('관리 파일의 schemaVersion이 없습니다.');
          if (!meta.baseVersion) throw new Error('관리 파일의 baseVersion이 없습니다.');
          if (!meta.currentSnapshotId && !meta.exportManifestId) throw new Error('관리 파일의 currentSnapshotId 또는 exportManifestId가 필요합니다.');
          if (meta.exportManifestId && !/^[a-f0-9]{64}$/i.test(meta.canonicalExportHash)) throw new Error('관리 파일의 canonicalExportHash가 없거나 올바르지 않습니다.');
        }
        var digest = await crypto.subtle.digest('SHA-256', buffer);
        var hash = Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
        return {
          rows: rows,
          hash: hash,
          mode: meta.hasSystemInfo ? 'managed' : 'bootstrap',
          baseVersion: meta.baseVersion,
          schemaVersion: meta.hasSystemInfo ? meta.schemaVersion : 1,
          currentSnapshotId: meta.currentSnapshotId,
          exportManifestId: meta.exportManifestId,
          canonicalExportHash: meta.canonicalExportHash,
          hasRowKeys: originalKeyCount === rows.length
        };
      }

      function excelSummary(parsed, file) {
        var node = document.querySelector('[data-excel-file-summary]');
        if (!node) return;
        node.hidden = false;
        node.textContent = file.name + ' · ' + parsed.rows.length.toLocaleString('ko-KR') + '건' + (parsed.mode === 'managed' ? ' · 대장 버전 ' + parsed.baseVersion : ' · bootstrap(메타데이터 없음)');
      }

      function excelProgress(done, total, message) {
        var wrap = document.querySelector('[data-excel-progress]');
        var bar = document.querySelector('[data-excel-progress-bar]');
        var text = document.querySelector('[data-excel-message]');
        var percent = Math.max(0, Math.min(100, Math.round(done / Math.max(total, 1) * 100)));
        if (wrap) { wrap.hidden = false; wrap.setAttribute('aria-valuenow', String(percent)); }
        if (bar) bar.style.width = Math.max(2, percent) + '%';
        if (text && message) text.textContent = message;
      }

      function excelRenderErrors(errors) {
        var panel = document.querySelector('[data-excel-errors]');
        var table = panel && panel.querySelector('[data-snapshot-error-table] tbody');
        if (!panel || !table) return;
        var items = Array.isArray(errors) ? errors : [];
        table.textContent = '';
        items.forEach(function (error, index) {
          var row = document.createElement('tr');
          if (index >= 20) row.hidden = true;
          var labels = ['행', '필드', '코드', '오류'];
          [error.rowNumber || '-', error.field || '-', error.code || 'SNAPSHOT_INVALID_FIELD', error.message || '검증 오류'].forEach(function (value, cellIndex) {
            var cell = document.createElement('td');
            cell.setAttribute('data-label', labels[cellIndex]);
            cell.textContent = String(value);
            row.appendChild(cell);
          });
          table.appendChild(row);
        });
        panel.hidden = items.length === 0;
        var count = panel.querySelector('[data-excel-error-count]');
        if (count) count.textContent = items.length.toLocaleString('ko-KR') + '건';
        var summary = panel.querySelector('[data-excel-error-summary]');
        if (summary) summary.textContent = items.length > 20 ? '앞의 20건을 표시합니다. 외 ' + (items.length - 20).toLocaleString('ko-KR') + '건은 CSV에서 확인하세요.' : '검증 오류를 수정한 뒤 다시 업로드하세요.';
      }

      function excelCsvCell(value) {
        var text = String(value || '');
        if (excelCsvFormulaPrefix.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      }

      document.querySelectorAll('[data-snapshot-errors-csv]').forEach(function (button) {
        button.addEventListener('click', function () {
          var table = button.closest('[data-excel-errors]')?.querySelector('[data-snapshot-error-table]');
          if (!table) return;
          var lines = [['행', '필드', '코드', '오류']];
          table.querySelectorAll('tbody tr').forEach(function (row) {
            lines.push(Array.from(row.cells).map(function (cell) { return cell.textContent || ''; }));
          });
          var csv = '﻿' + lines.map(function (line) { return line.map(excelCsvCell).join(','); }).join('\r\n');
          var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          var link = document.createElement('a');
          link.href = url; link.download = '엑셀_대장_검증오류.csv'; document.body.appendChild(link); link.click(); link.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        });
      });

      async function excelPost(path, data) {
        var csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        var payload = new URLSearchParams(Object.assign({ csrf_token: csrf }, data || {}));
        var response = await fetch(path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: payload });
        var result = await response.json().catch(function () { return { ok: false, message: '서버 응답을 읽을 수 없습니다.' }; });
        if (!response.ok || !result.ok) {
          var requestError = new Error(result.message || '엑셀 동기화를 처리할 수 없습니다.');
          requestError.snapshotResult = result;
          throw requestError;
        }
        return result;
      }

      if (excelUploadForm) {
        var fileInput = excelUploadForm.querySelector('input[type="file"]');
        fileInput?.addEventListener('change', async function () {
          try {
            excelCachedFile = fileInput.files && fileInput.files[0];
            excelCachedParsed = await readExcelSnapshot(excelCachedFile);
            excelSummary(excelCachedParsed, excelCachedFile);
            var bootstrapPanel = document.querySelector('[data-excel-bootstrap]');
            if (bootstrapPanel) {
              bootstrapPanel.hidden = excelCachedParsed.mode !== 'bootstrap';
              bootstrapPanel.querySelectorAll('input').forEach(function (input) { input.required = excelCachedParsed.mode === 'bootstrap'; });
            }
            var message = document.querySelector('[data-excel-message]');
            if (message) message.textContent = '열 제목과 파일 구조를 확인했습니다. 버튼을 누르면 서버 검증을 시작합니다.';
          } catch (error) {
            excelCachedParsed = null;
            excelRenderErrors(error.snapshotResult && error.snapshotResult.errors);
            var message = document.querySelector('[data-excel-message]');
            if (message) message.textContent = error.message;
          }
        });
        excelUploadForm.addEventListener('submit', async function (event) {
          event.preventDefault();
          var button = excelUploadForm.querySelector('[data-excel-upload-button]');
          var created = null;
          var recovery = document.querySelector('[data-excel-recovery]');
          function showRecovery(snapshotId) {
            if (!recovery || !snapshotId) return;
            var text = document.createElement('span');
            text.textContent = '동기화 작업 #' + snapshotId + '이 생성되었습니다. 전송이 중단돼도 이 작업 화면에서 상태를 확인하거나 취소할 수 있습니다. ';
            var link = document.createElement('a');
            link.href = '/document-snapshots/' + snapshotId;
            link.textContent = '작업 화면 열기';
            recovery.replaceChildren(text, link);
            recovery.hidden = false;
          }
          try {
            var file = fileInput.files && fileInput.files[0];
            if (!file) throw new Error('업로드할 엑셀 파일을 선택하세요.');
            if (!excelCachedParsed || excelCachedFile !== file) excelCachedParsed = await readExcelSnapshot(file);
            button.disabled = true;
            excelProgress(1, excelCachedParsed.rows.length + 2, '동기화 작업을 준비하고 있습니다.');
            var bootstrapConfirmation = '';
            var backupConfirmed = '';
            if (excelCachedParsed.mode === 'bootstrap') {
              var bootstrapInput = excelUploadForm.elements.namedItem('bootstrapConfirmation');
              var backupInput = excelUploadForm.elements.namedItem('backupConfirmed');
              bootstrapConfirmation = bootstrapInput ? bootstrapInput.value.trim() : '';
              if (bootstrapConfirmation !== 'BOOTSTRAP') throw new Error('bootstrap 확인문구가 일치하지 않아 취소했습니다.');
              backupConfirmed = backupInput && backupInput.checked ? '1' : '';
              if (!backupConfirmed) throw new Error('운영 backup 확인이 없어 bootstrap을 취소했습니다.');
            }
            created = await excelPost('/document-snapshots', {
              sourceName: file.name,
              sourceHash: excelCachedParsed.hash,
              clientSourceHash: excelCachedParsed.hash,
              sourceSize: String(file.size),
              totalCount: String(excelCachedParsed.rows.length),
              schemaVersion: String(excelCachedParsed.schemaVersion || 1),
              baseVersion: excelCachedParsed.baseVersion ? String(excelCachedParsed.baseVersion) : '',
              currentSnapshotId: excelCachedParsed.currentSnapshotId ? String(excelCachedParsed.currentSnapshotId) : '',
              exportManifestId: excelCachedParsed.exportManifestId || '',
              canonicalExportHash: excelCachedParsed.canonicalExportHash || '',
              mode: excelCachedParsed.mode,
              hasRowKeys: excelCachedParsed.hasRowKeys ? '1' : '',
              bootstrapConfirmation: bootstrapConfirmation,
              backupConfirmed: backupConfirmed
            });
            showRecovery(created.id);
            var chunkSize = 50;
            for (var index = 0; index < excelCachedParsed.rows.length; index += chunkSize) {
              var chunk = excelCachedParsed.rows.slice(index, index + chunkSize).map(function (entry) {
                return {
                  rowNumber: entry.rowNumber,
                  sourceRowKey: entry.sourceRowKey || '',
                  source: entry.source
                };
              });
              await excelPost('/document-snapshots/' + created.id + '/rows', { rows: JSON.stringify(chunk) });
              excelProgress(Math.min(index + chunk.length, excelCachedParsed.rows.length), excelCachedParsed.rows.length + 2, '엑셀 행을 안전하게 나누어 전송하고 있습니다.');
            }
            excelProgress(excelCachedParsed.rows.length + 1, excelCachedParsed.rows.length + 2, '대분류, 태그, 랙 위치와 변경 내역을 검증하고 있습니다.');
            await excelPost('/document-snapshots/' + created.id + '/prepare', {});
            excelProgress(excelCachedParsed.rows.length + 2, excelCachedParsed.rows.length + 2, '검증을 완료했습니다.');
            location.href = '/document-snapshots/' + created.id;
          } catch (error) {
            button.disabled = false;
            excelRenderErrors(error.snapshotResult && error.snapshotResult.errors);
            var message = document.querySelector('[data-excel-message]');
            if (message) message.textContent = error.message + (created?.id ? ' 생성된 작업에서 상태를 확인하고 안전하게 다시 시작하세요.' : '');
          }
        });
      }

      function excelHeaderStyle(row) {
        row.height = 28;
        row.eachCell(function (cell) {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: '맑은 고딕', size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = { bottom: { style: 'medium', color: { argb: 'FF17365D' } } };
        });
      }

      function excelDataValues(document) {
        var revisionDate = document.revisionDate ? excelDateOnlyToUtcDate(document.revisionDate) : '';
        return [document.documentNumber, document.revisionNumber, revisionDate || '', document.disposalDueYear || '', document.documentName,
          document.category, document.rackNumber, document.rackColumn, document.shelfNumber, document.rackFace,
          document.tags || '', document.note || '', document.status, document.rowKey];
      }

      async function buildExcelSnapshot(payload) {
        if (!window.ExcelJS) throw new Error('엑셀 처리 모듈을 불러오지 못했습니다.');
        var workbook = new window.ExcelJS.Workbook();
        workbook.creator = '한림문서고';
        workbook.lastModifiedBy = '한림문서고';
        workbook.created = new Date();
        workbook.modified = new Date();
        workbook.calcProperties.fullCalcOnLoad = true;

        var data = workbook.addWorksheet('문서데이터', { views: [{ state: 'frozen', ySplit: 1 }] });
        data.columns = [
          { width: 18 }, { width: 12 }, { width: 13 }, { width: 15 }, { width: 32 }, { width: 16 },
          { width: 14 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 24 }, { width: 30 }, { width: 12 }, { width: 40, hidden: true }
        ];
        data.addRow(excelHeaders.concat(['_엑셀관리ID']));
        excelHeaderStyle(data.getRow(1));
        payload.documents.forEach(function (document) { data.addRow(excelDataValues(document)); });
        data.autoFilter = { from: 'A1', to: 'M' + Math.max(1, payload.documents.length + 1) };
        data.getColumn(3).numFmt = 'yyyy-mm-dd';
        data.getColumn(4).numFmt = '0';
        data.getColumn(7).numFmt = '0'; data.getColumn(8).numFmt = '0'; data.getColumn(9).numFmt = '0';
        data.getColumn(14).hidden = true;
        for (var rowIndex = 2; rowIndex <= payload.documents.length + 1; rowIndex += 1) {
          var row = data.getRow(rowIndex);
          row.height = 22;
          row.eachCell({ includeEmpty: true }, function (cell, column) {
            cell.font = { name: '맑은 고딕', size: 10 };
            cell.alignment = { vertical: 'middle', horizontal: [2,3,4,7,8,9,10,13].indexOf(column) >= 0 ? 'center' : 'left' };
            cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E2F3' } } };
          });
        }

        var codes = workbook.addWorksheet('_코드값', { state: 'veryHidden' });
        codes.addRow(['문서종류','랙번호','랙 단면','상태','태그']);
        var codeLength = Math.max(payload.codes.categories.length, payload.codes.racks.length, payload.codes.tags.length, 2);
        for (var codeIndex = 0; codeIndex < codeLength; codeIndex += 1) {
          codes.addRow([
            payload.codes.categories[codeIndex] || '',
            payload.codes.racks[codeIndex] ? payload.codes.racks[codeIndex].rackNumber : '',
            ['단면','1면','2면'][codeIndex] || '',
            ['보관중','폐기'][codeIndex] || '',
            payload.codes.tags[codeIndex] || ''
          ]);
        }
        var validationEnd = Math.max(payload.documents.length + 51, 100);
        for (var validationRow = 2; validationRow <= validationEnd; validationRow += 1) {
          data.getCell(validationRow, 6).dataValidation = { type: 'list', allowBlank: false, formulae: ["'_코드값'!$A$2:$A$" + (payload.codes.categories.length + 1)] };
          data.getCell(validationRow, 7).dataValidation = { type: 'list', allowBlank: false, formulae: ["'_코드값'!$B$2:$B$" + (payload.codes.racks.length + 1)] };
          data.getCell(validationRow, 10).dataValidation = { type: 'list', allowBlank: false, formulae: ["'_코드값'!$C$2:$C$4"] };
          data.getCell(validationRow, 13).dataValidation = { type: 'list', allowBlank: false, formulae: ["'_코드값'!$D$2:$D$3"] };
        }

        var print = workbook.addWorksheet('인쇄용 관리대장', { views: [{ state: 'frozen', ySplit: 4 }] });
        print.mergeCells('A1:M1');
        print.getCell('A1').value = '한림 문서고 관리대장';
        print.getCell('A1').font = { name: '맑은 고딕', bold: true, size: 18, color: { argb: 'FF17365D' } };
        print.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        print.getRow(1).height = 34;
        print.mergeCells('A2:J2');
        print.getCell('A2').value = '대장 버전 ' + payload.baseVersion + ' · 추출 ' + payload.exportedAt.slice(0, 10) + ' · 총 ' + payload.documents.length + '건';
        print.getCell('A2').font = { name: '맑은 고딕', size: 9, color: { argb: 'FF666666' } };
        print.mergeCells('K2:M2'); print.getCell('K2').value = '확인:                         ';
        print.getCell('K2').alignment = { horizontal: 'right' };
        print.addRow([]);
        print.addRow(excelHeaders);
        excelHeaderStyle(print.getRow(4));
        payload.documents.forEach(function (document) { print.addRow(excelDataValues(document).slice(0, 13)); });
        print.columns = data.columns.slice(0, 13).map(function (column) { return { width: column.width }; });
        print.getColumn(3).numFmt = 'yyyy-mm-dd';
        for (var printRow = 5; printRow <= payload.documents.length + 4; printRow += 1) {
          print.getRow(printRow).height = 21;
          print.getRow(printRow).eachCell({ includeEmpty: true }, function (cell, column) {
            cell.font = { name: '맑은 고딕', size: 8 };
            cell.alignment = { vertical: 'middle', horizontal: [2,3,4,7,8,9,10,13].indexOf(column) >= 0 ? 'center' : 'left', shrinkToFit: true };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
          });
        }
        print.pageSetup = { paperSize: 8, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:4',
          margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
        print.headerFooter.oddFooter = '&L한림 문서고&C&P / &N&R' + payload.exportedAt.slice(0, 10);

        var guide = workbook.addWorksheet('작성안내');
        guide.columns = [{ width: 24 }, { width: 90 }];
        guide.addRow(['항목','작성 방법']); excelHeaderStyle(guide.getRow(1));
        [
          ['문서데이터','첫 행의 한글 13개 열 제목과 순서를 변경하지 마세요. 필터·정렬과 행 추가는 가능합니다.'],
          ['숨김 관리 ID','N열은 문서 이력을 연결하는 시스템 값입니다. 열을 삭제하거나 값을 복사하지 마세요. 인쇄에는 나오지 않습니다.'],
          ['태그','여러 태그는 세미콜론(;)으로 구분합니다. 관리자 화면에 등록된 태그만 사용할 수 있습니다.'],
          ['랙 위치','1번 랙은 단면, 2~13번 랙은 1면 또는 2면을 사용합니다. 열은 1~7, 선반은 1~6입니다.'],
          ['상태','보관중 또는 폐기만 입력합니다.'],
          ['동기화','업로드 후 추가·변경·제외 내역을 확인하고 현재 대장으로 반영하세요. 오류가 있으면 기존 대장은 바뀌지 않습니다.'],
          ['인쇄','인쇄용 관리대장 시트는 A3 가로, 한 페이지 너비로 설정되어 있습니다.']
        ].forEach(function (row) { guide.addRow(row); });
        guide.eachRow(function (row, index) { if (index > 1) { row.height = 34; row.eachCell(function (cell) { cell.alignment = { vertical: 'middle', wrapText: true }; cell.font = { name: '맑은 고딕', size: 10 }; }); } });

        var meta = workbook.addWorksheet('_시스템정보', { state: 'veryHidden' });
        meta.addRows([
          ['schemaVersion', payload.schemaVersion],
          ['baseVersion', payload.baseVersion],
          ['currentSnapshotId', payload.currentSnapshotId || ''],
          ['exportManifestId', payload.exportManifestId || ''],
          ['canonicalExportHash', payload.canonicalExportHash || ''],
          ['exportedAt', payload.exportedAt],
          ['rowCount', payload.documents.length]
        ]);
        var output = await workbook.xlsx.writeBuffer();
        var blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = '한림_문서고_관리대장_' + payload.exportedAt.slice(0, 10) + '.xlsx';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      }

      document.querySelectorAll('[data-excel-export]').forEach(function (button) {
        button.addEventListener('click', async function () {
          var original = button.textContent;
          try {
            button.disabled = true; button.textContent = '엑셀 생성 중...';
            var response = await fetch('/api/document-snapshot/export', { headers: { Accept: 'application/json' } });
            var payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.message || '현재 대장을 불러올 수 없습니다.');
            await buildExcelSnapshot(payload);
          } catch (error) {
            if (window.showAppMessage) window.showAppMessage(error.message, true);
          } finally {
            button.disabled = false; button.textContent = original;
          }
        });
      });

      var documentDetail = document.querySelector('[data-document-detail]');
      if (documentDetail) {
        documentDetail.querySelectorAll('[data-back-to-results]').forEach(function (link) {
          link.addEventListener('click', function (event) {
            try {
              var previous = new URL(document.referrer || '', location.href);
              var sameSearchFlow = previous.origin === location.origin && (previous.pathname === '/app' || previous.pathname === '/documents');
              if (!sameSearchFlow || history.length < 2) return;
              event.preventDefault();
              history.back();
            } catch {}
          });
        });

        function centerInside(scroller, target) {
          if (!scroller || !target) return;
          var scrollRect = scroller.getBoundingClientRect();
          var targetRect = target.getBoundingClientRect();
          var left = scroller.scrollLeft + targetRect.left - scrollRect.left - (scrollRect.width - targetRect.width) / 2;
          scroller.scrollLeft = Math.max(0, left);
        }

        function centerLocationTargets(scope) {
          (scope || documentDetail).querySelectorAll('[data-rack-scroll]').forEach(function (scroller) {
            centerInside(scroller, scroller.querySelector('.mini-slot.active'));
          });
          (scope || documentDetail).querySelectorAll('[data-document-floor-scroll]').forEach(function (scroller) {
            centerInside(scroller, scroller.querySelector('.floor-rack.is-hit, .floor-rack[data-face-hit]'));
          });
        }

        requestAnimationFrame(function () { centerLocationTargets(documentDetail); });
        var locationResizeTimer = 0;
        window.addEventListener('resize', function () {
          clearTimeout(locationResizeTimer);
          locationResizeTimer = setTimeout(function () { centerLocationTargets(documentDetail); }, 80);
        });

        documentDetail.querySelectorAll('[data-document-floor-zoom]').forEach(function (button) {
          var scroller = document.getElementById(button.getAttribute('aria-controls') || '');
          if (!scroller) return;
          button.addEventListener('click', function () {
            var expanded = scroller.classList.toggle('is-zoomed');
            button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
            button.textContent = expanded ? '전체 보기' : '도면 크게 보기';
            if (expanded) centerInside(scroller, scroller.querySelector('.floor-rack.is-hit, .floor-rack[data-face-hit]'));
            else scroller.scrollLeft = 0;
          });
        });

        var actionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null;
        function syncDetailActions() {
          documentDetail.querySelectorAll('[data-detail-actions]').forEach(function (details) {
            if (actionQuery?.matches) {
              if (!details.dataset.mobileInitialized) details.open = false;
              details.dataset.mobileInitialized = 'true';
            } else {
              details.open = true;
              delete details.dataset.mobileInitialized;
            }
          });
        }
        syncDetailActions();
        actionQuery?.addEventListener?.('change', syncDetailActions);

        var finder = documentDetail.querySelector('[data-location-find-dialog]');
        if (finder) {
          var currentStep = 1;
          var previousButton = finder.querySelector('[data-find-previous]');
          var nextButton = finder.querySelector('[data-find-next]');
          var finishButton = finder.querySelector('[data-find-finish]');
          var progressText = finder.querySelector('[data-find-progress-text]');

          function showFindStep(step) {
            currentStep = Math.min(3, Math.max(1, Number(step) || 1));
            finder.dataset.locationFindStep = String(currentStep);
            finder.querySelectorAll('[data-find-step]').forEach(function (panel) {
              panel.hidden = Number(panel.dataset.findStep) !== currentStep;
            });
            finder.querySelectorAll('[data-find-progress-step]').forEach(function (item) {
              var itemStep = Number(item.dataset.findProgressStep);
              item.classList.toggle('is-current', itemStep === currentStep);
              item.classList.toggle('is-complete', itemStep < currentStep);
            });
            if (previousButton) previousButton.disabled = currentStep === 1;
            if (nextButton) nextButton.hidden = currentStep === 3;
            if (finishButton) finishButton.hidden = currentStep !== 3;
            if (progressText) progressText.textContent = currentStep + ' / 3';
            requestAnimationFrame(function () {
              centerLocationTargets(finder);
              finder.querySelector('[data-find-step="' + currentStep + '"] h3')?.focus?.({ preventScroll: true });
            });
          }

          nextButton?.addEventListener('click', function () { showFindStep(currentStep + 1); });
          previousButton?.addEventListener('click', function () { showFindStep(currentStep - 1); });
          documentDetail.querySelectorAll('[data-open-modal="location-find-modal"]').forEach(function (button) {
            button.addEventListener('click', function () {
              showFindStep(1);
              document.body.classList.add('is-location-finding');
            });
          });
          finder.addEventListener('close', function () {
            document.body.classList.remove('is-location-finding');
            finder.classList.remove('is-field-readable');
            var readability = finder.querySelector('[data-field-readability]');
            readability?.setAttribute('aria-pressed', 'false');
          });

          finder.querySelector('[data-field-readability]')?.addEventListener('click', function (event) {
            var pressed = finder.classList.toggle('is-field-readable');
            event.currentTarget.setAttribute('aria-pressed', pressed ? 'true' : 'false');
          });

          var rackInput = finder.querySelector('[data-rack-code-input]');
          var rackStatus = finder.querySelector('[data-rack-check-status]');
          finder.querySelector('[data-rack-check]')?.addEventListener('click', function () {
            var expected = String(finder.dataset.expectedRackCode || '').trim().toUpperCase();
            var entered = String(rackInput?.value || '').trim().toUpperCase();
            if (!entered) {
              if (rackStatus) rackStatus.textContent = '랙 표지의 코드를 입력해 주세요.';
              rackInput?.focus();
              return;
            }
            var matched = entered === expected;
            if (rackStatus) {
              rackStatus.textContent = matched ? '현재 찾는 랙과 일치합니다.' : '다른 랙입니다. 위치 Hero의 랙 코드를 다시 확인하세요.';
              rackStatus.classList.toggle('is-match', matched);
              rackStatus.classList.toggle('is-mismatch', !matched);
            }
            if (matched && navigator.vibrate) navigator.vibrate(40);
          });
        }
      }

      var currentPath = location.pathname;
      var activeNavItems = Array.from(document.querySelectorAll('.archive-nav-item, .nav-sub-link, [data-command-item]')).filter(function (item) {
        var href = item.getAttribute('href') || '';
        return href === currentPath || (href.length > 1 && currentPath.indexOf(href + '/') === 0);
      }).sort(function (left, right) {
        return (right.getAttribute('href') || '').length - (left.getAttribute('href') || '').length;
      });
      var activeHref = activeNavItems[0] ? activeNavItems[0].getAttribute('href') : '';
      activeNavItems.forEach(function (item) {
        if (item.getAttribute('href') === activeHref) { item.classList.add('active'); item.setAttribute('aria-current', 'page'); }
      });

      var toastKey = new URLSearchParams(location.search).get('toast');
      if (toastKey) {
        var toastParams = new URLSearchParams(location.search);
        var toastMessages = {
          created: '문서가 등록되었습니다.',
          updated: '문서 정보가 수정되었습니다.',
          disposed: '폐기 처리되었습니다.',
          restored: '폐기가 해제되었습니다.',
          deleted: '문서가 완전 삭제되었습니다.',
          saved: '저장되었습니다.',
          'bulk-disposed': '선택한 문서를 폐기 처리했습니다.',
          approved: '가입 요청을 승인했습니다.',
          rejected: '가입 요청을 거절했습니다.',
          'permissions-saved': '사용자 권한을 저장했습니다.',
          error: '요청을 처리하지 못했습니다. 입력값을 확인하세요.'
        };
        var toastMessage = toastMessages[toastKey];
        if (toastKey === 'bulk-disposed') {
          var disposedCount = Number(toastParams.get('disposed') || 0);
          var skippedCount = Number(toastParams.get('skipped') || 0);
          toastMessage = '폐기 ' + disposedCount + '건 완료' + (skippedCount ? ' · 건너뜀 ' + skippedCount + '건' : '') + '.';
        }
        if (toastMessage) {
          window.showAppMessage?.(toastMessage, toastKey === 'error');
        }
        try {
          var cleanUrl = new URL(location.href);
          cleanUrl.searchParams.delete('toast');
          cleanUrl.searchParams.delete('disposed');
          cleanUrl.searchParams.delete('skipped');
          history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        } catch {}
      }

      // 검색 결과 클릭 학습 (아이디어 8): 클릭된 문서를 검색어와 함께 집계한다.
      document.addEventListener('click', function (event) {
        var target = event.target instanceof Element ? event.target : null;
        var link = target && target.closest ? target.closest('[data-doc-click]') : null;
        if (!link) return;
        var input = document.querySelector('[data-search-form] input[name="q"]');
        var q = input ? input.value.trim() : '';
        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (!q || !csrfMeta || !navigator.sendBeacon) return;
        var payload = new FormData();
        payload.append('q', q);
        payload.append('documentId', link.getAttribute('data-doc-click'));
        payload.append('csrf_token', csrfMeta.getAttribute('content') || '');
        navigator.sendBeacon('/api/search-click', payload);
      });

      // 즉시 검색 (아이디어 3): /app에서 타이핑 즉시 로컬 인덱스를 스코어링해 렌더한다.
      var viewerApp = document.querySelector('[data-viewer-app]');
      var viewerForm = document.querySelector('[data-viewer-form]');
      var viewerInput = viewerForm ? viewerForm.querySelector('input[name="q"]') : null;
      if (viewerApp && viewerInput && window.SearchCore) {
        var core = window.SearchCore;
        var contextEl = document.querySelector('[data-viewer-context]');
        var searchContext = { categories: [], tags: [] };
        try { searchContext = JSON.parse(contextEl ? contextEl.textContent : '{}') || searchContext; } catch {}
        var searchIndex = null;
        var indexLoading = false;
        var indexError = '';
        var resultsBody = document.querySelector('[data-results-body]');
        var resultsTitle = document.querySelector('[data-results-title]');
        var resultsCount = document.querySelector('[data-results-count]');
        var searchLive = document.querySelector('[data-search-live]');
        var homeExtras = document.querySelector('[data-home-extras]');
        var initialResults = {
          body: resultsBody ? resultsBody.innerHTML : '',
          title: resultsTitle ? resultsTitle.textContent : '',
          count: resultsCount ? resultsCount.textContent : ''
        };
        var renderTimer = null;

        var instantLocation = function (doc) {
          var faceLabel = core.rackFaceLabel(doc);
          return {
            main: (doc.zone_number ? doc.zone_number + '구역 ' : '') + (faceLabel || doc.rack_code || ''),
            sub: (doc.column_number || '') + '열 ' + (doc.shelf_number || '') + '선반',
            label: [
              doc.zone_number ? doc.zone_number + '구역' : '',
              faceLabel ? faceLabel + '번 랙' : doc.rack_code,
              doc.column_number ? doc.column_number + '열' : '',
              doc.shelf_number ? doc.shelf_number + '선반' : ''
            ].filter(Boolean).join(' / ')
          };
        };

        var instantBadges = function (doc) {
          var html = '';
          if (doc.status !== 'active') html += '<span class="status disposed">폐기</span>';
          return html;
        };

        var instantRow = function (doc, q) {
          var loc = instantLocation(doc);
          var rail = doc.status !== 'active' ? ' is-disposed' : '';
          return '<article class="viewer-result-row' + rail + '" role="row">' +
            '<span class="viewer-result-name" role="cell" data-label="문서명"><a href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '">' + core.highlightHtml(doc.document_name || '문서명 없음', q, escapeHtmlClient) + '</a></span>' +
            '<span class="mono" role="cell" data-label="문서번호">' + core.highlightHtml(doc.document_number || '', q, escapeHtmlClient) + '</span>' +
            '<span role="cell" data-label="개정">' + escapeHtmlClient(doc.revision_number || '-') + '</span>' +
            '<span role="cell" data-label="제·개정일">' + escapeHtmlClient(doc.revision_date || '-') + '</span>' +
            '<span role="cell" data-label="대분류">' + escapeHtmlClient(doc.category_name || '-') + '</span>' +
            '<span class="viewer-result-location" role="cell" data-label="보관 위치">' + escapeHtmlClient(loc.label || '위치 미지정') + '</span>' +
            '<span role="cell" data-label="상태">' + (doc.status === 'active' ? '<span class="status active">보관중</span>' : instantBadges(doc)) + '</span>' +
            '</article>';
        };

        var currentSelectFilters = function () {
          var control = function (name) { return viewerForm.elements ? viewerForm.elements.namedItem(name) : viewerForm.querySelector('select[name="' + name + '"]'); };
          var num = function (name) {
            var el = control(name);
            return el ? Number(el.value) || 0 : 0;
          };
          var statusEl = control('status');
          var sortEl = control('sort');
          var status = statusEl && ['active', 'all', 'disposed'].indexOf(statusEl.value) !== -1 ? statusEl.value : 'active';
          return {
            categoryId: num('category'),
            tagId: num('tag'),
            zoneNumber: num('zone'),
            status: status,
            sort: sortEl ? sortEl.value : 'relevance'
          };
        };

        var tagNameById = function (id) {
          var tags = searchContext.tags || [];
          for (var i = 0; i < tags.length; i++) {
            if (Number(tags[i].id) === Number(id)) return tags[i].name;
          }
          return '';
        };

        var matchesFilters = function (doc, f) {
          if (f.categoryId && Number(doc.category_id) !== f.categoryId) return false;
          if (f.zoneNumber && Number(doc.zone_number) !== f.zoneNumber) return false;
          if (f.status && f.status !== 'all' && doc.status !== f.status) return false;
          if (f.tagId) {
            var name = core.compactSearchText(tagNameById(f.tagId));
            if (!name) return false;
            if (core.compactSearchText(doc.tag_names || '').indexOf(name) === -1) return false;
          }
          return true;
        };

        var restoreInitial = function () {
          if (resultsBody) resultsBody.innerHTML = initialResults.body;
          if (resultsTitle) resultsTitle.textContent = initialResults.title;
          if (resultsCount) resultsCount.textContent = initialResults.count;
          if (searchLive) searchLive.textContent = '검색어를 입력하면 보관중 문서를 바로 찾습니다.';
          if (homeExtras) homeExtras.hidden = false;
          if (viewerApp.classList.contains('is-home')) viewerApp.hidden = true;
        };

        var renderInstant = function () {
          var q = viewerInput.value.trim();
          if (!q) { restoreInitial(); return; }
          if (!searchIndex) {
            if (indexError) {
              var params = new URLSearchParams({ q: q });
              if (resultsBody) resultsBody.innerHTML = '<div class="alert danger" role="alert">즉시검색 자료를 불러오지 못했습니다.</div><div class="empty-actions"><button type="button" class="button secondary sm" data-search-retry>다시 시도</button><a class="button secondary sm" href="/app?' + escapeHtmlClient(params.toString()) + '">서버 검색으로 계속</a></div>';
              if (resultsTitle) resultsTitle.textContent = '검색을 계속할 수 없습니다';
              if (resultsCount) resultsCount.textContent = '-';
              if (searchLive) searchLive.textContent = '즉시검색을 불러오지 못했습니다. 다시 시도하거나 서버 검색을 이용하세요.';
              viewerApp.hidden = false;
              return;
            }
            if (searchLive) searchLive.textContent = '검색 자료를 불러오는 중입니다.';
            loadSearchIndex();
            return;
          }
          var f = currentSelectFilters();
          var parsed = core.parseSearchQuery(q, {
            categories: searchContext.categories,
            tags: searchContext.tags,
            explicit: f
          });
          var merged = {
            categoryId: f.categoryId || parsed.filters.categoryId || 0,
            tagId: f.tagId || parsed.filters.tagId || 0,
            zoneNumber: f.zoneNumber || parsed.filters.zoneNumber || 0,
            status: f.status,
            sort: f.sort || 'relevance'
          };
          var text = parsed.text;
          var hasText = Boolean(text);
          var scored = [];
          for (var i = 0; i < searchIndex.length; i++) {
            var doc = searchIndex[i];
            if (!matchesFilters(doc, merged)) continue;
            var result = core.scoreDocumentMatch(doc, text);
            if (hasText && result.relevance_score <= 0) continue;
            var item = Object.assign({}, doc, result);
            if (item.relevance_score > 0) item.relevance_score += core.popularityBoost(doc.popularity);
            scored.push(item);
          }
          scored.sort(function (left, right) {
            return core.compareSearchResults(left, right, hasText ? (merged.sort || 'relevance') : 'updated', hasText);
          });
          var top = scored.slice(0, 30);
          var html = '';
          var chips = parsed.chips || [];
          if (chips.length) {
            var chipLabels = { zone: '구역', category: '대분류', tag: '태그', status: '상태' };
            html += '<div class="parsed-chip-row"><span>자동 적용</span>' + chips.map(function (chip) {
              return '<button type="button" class="chip active" data-remove-search-chip="' + escapeHtmlClient(chip.token || '') + '" aria-label="' + escapeHtmlClient(chip.label + ' 자동 필터 제거') + '">' + escapeHtmlClient((chipLabels[chip.type] || chip.type) + ': ' + chip.label) + ' ×</button>';
            }).join('') + '</div>';
          }
          if (top.length) {
            html += '<div class="viewer-result-table" role="table" aria-label="문서 검색 결과"><div class="viewer-result-header" role="row"><span>문서명</span><span>문서번호</span><span>개정</span><span>제·개정일</span><span>대분류</span><span>보관 위치</span><span>상태</span></div><div class="viewer-result-list" role="rowgroup">' + top.map(function (item) { return instantRow(item, text); }).join('') + '</div></div>';
          } else {
            html += '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 문서가 없습니다.</p><div class="empty-actions"><a class="button secondary sm" href="/documents">전체 문서 보기</a><a class="button secondary sm" href="/app">검색 초기화</a></div></div>';
            var loose = [];
            for (var j = 0; j < searchIndex.length; j++) {
              var candidate = searchIndex[j];
              if (merged.status !== 'all' && candidate.status !== merged.status) continue;
              var looseScore = core.scoreDocumentMatch(candidate, text, { minCoverage: 0.2 });
              if (looseScore.relevance_score > 0) loose.push(Object.assign({}, candidate, looseScore));
            }
            loose.sort(function (l, r) { return r.relevance_score - l.relevance_score; });
            if (loose.length) {
              html += '<div class="didyoumean"><p>혹시 이 문서를 찾으셨나요?</p>' + loose.slice(0, 3).map(function (item) {
                var loc = instantLocation(item);
                return '<a href="/documents/' + item.id + '"><strong>' + escapeHtmlClient(item.document_name || '') + '</strong><span class="mono">' + escapeHtmlClient(item.document_number || '') + '</span><small>' + escapeHtmlClient(loc.label) + '</small></a>';
              }).join('') + '</div>';
            }
          }
          if (scored.length > top.length) {
            var allParams = new URLSearchParams();
            allParams.set('q', q);
            allParams.set('status', merged.status);
            if (f.categoryId) allParams.set('category', f.categoryId);
            if (f.tagId) allParams.set('tag', f.tagId);
            if (f.zoneNumber) allParams.set('zone', f.zoneNumber);
            if (f.sort) allParams.set('sort', f.sort);
            html += '<nav class="pagination"><a class="button secondary sm" href="/app?' + escapeHtmlClient(allParams.toString()) + '">전체 ' + scored.length + '건 모두 보기</a></nav>';
          }
          if (resultsBody) resultsBody.innerHTML = html;
          if (resultsTitle) resultsTitle.textContent = '"' + q + '" 검색 결과';
          if (resultsCount) resultsCount.textContent = scored.length + '건';
          if (searchLive) searchLive.textContent = scored.length ? scored.length + '건을 찾았습니다.' : '검색 결과가 없습니다.';
          if (homeExtras) homeExtras.hidden = true;
          viewerApp.hidden = false;
        };

        var loadSearchIndex = function () {
          if (searchIndex || indexLoading) return;
          indexLoading = true;
          indexError = '';
          fetch('/api/search-index', { headers: { Accept: 'application/json' } })
            .then(function (response) { if (!response.ok) throw new Error('검색 자료 요청 실패'); return response.json(); })
            .then(function (data) {
              if (!data || !Array.isArray(data.documents)) throw new Error('검색 자료 형식 오류');
              searchIndex = data.documents;
              window.__hanlimSearchIndexReady = true;
              indexLoading = false;
              renderInstant();
            })
            .catch(function () { indexLoading = false; indexError = 'load-failed'; renderInstant(); });
        };

        viewerInput.addEventListener('input', function () {
          clearTimeout(renderTimer);
          if (searchLive && viewerInput.value.trim()) searchLive.textContent = '검색 중…';
          renderTimer = setTimeout(renderInstant, 100);
        });
        viewerInput.addEventListener('focus', loadSearchIndex);
        resultsBody?.addEventListener?.('click', function (event) {
          var target = event.target instanceof Element ? event.target : null;
          var retry = target?.closest('[data-search-retry]');
          if (retry) { indexError = ''; loadSearchIndex(); return; }
          var chip = target?.closest('[data-remove-search-chip]');
          if (chip) {
            var token = chip.getAttribute('data-remove-search-chip') || '';
            viewerInput.value = viewerInput.value.split(/\s+/).filter(function (part) { return part !== token; }).join(' ');
            renderInstant();
            viewerInput.focus();
          }
        });
        if (viewerInput.value.trim()) loadSearchIndex();
      }

    });

