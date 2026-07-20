import { excelOpenXmlCompatibilityScript } from "./excelOpenXmlCompatibility.js";

// 엑셀 파싱·생성은 브라우저에서 수행해 Worker 무료티어 CPU를 사용하지 않는다.
export function excelSnapshotScript() {
  return `
      var excelRoot = document.querySelector('[data-excel-snapshot]');
      var excelUploadForm = document.querySelector('[data-excel-snapshot-upload]');
      var excelHeaders = ['문서번호','개정번호','제/개정일','폐기 예정 년도','문서명','문서종류','랙 위치 (번호)','랙 위치 (열)','랙 위치 (선반)','랙 위치 (단면)','태그','비고','상태'];
      var excelCachedFile = null;
      var excelCachedParsed = null;

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
        var match = String(value || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
        if (!match) return null;
        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        var date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
        return date;
      }

      function excelDateText(cell) {
        var value = cell && cell.value;
        if (value instanceof Date) return excelUtcDateOnly(value);
        if (typeof value === 'number' && Number.isFinite(value)) {
          var date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
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
        if (!sheet) return { hasSystemInfo: false, baseVersion: 0, schemaVersion: 0, currentSnapshotId: 0, exportManifestId: '' };
        var values = {};
        sheet.eachRow(function (row) { values[excelCellText(row.getCell(1))] = excelCellText(row.getCell(2)); });
        return {
          hasSystemInfo: true,
          baseVersion: Number(values.baseVersion || 0),
          schemaVersion: Number(values.schemaVersion || 0),
          currentSnapshotId: Number(values.currentSnapshotId || 0),
          exportManifestId: values.exportManifestId || values.sourceExportId || ''
        };
      }

      ${excelOpenXmlCompatibilityScript()}

      async function readExcelSnapshot(file) {
        if (!window.ExcelJS) throw new Error('엑셀 처리 모듈을 불러오지 못했습니다. 화면을 새로고침하세요.');
        if (!file || !/\\.xlsx$/i.test(file.name || '')) throw new Error('xlsx 형식의 엑셀 파일을 선택하세요.');
        var buffer = await file.arrayBuffer();
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
              documentNumber: visible[0], revisionNumber: visible[1], revisionDate: excelDateText(row.getCell(3)),
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
        if (wrap) wrap.hidden = false;
        if (bar) bar.style.width = Math.max(2, Math.min(100, Math.round(done / Math.max(total, 1) * 100))) + '%';
        if (text && message) text.textContent = message;
      }

      async function excelPost(path, data) {
        var csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        var payload = new URLSearchParams(Object.assign({ csrf_token: csrf }, data || {}));
        var response = await fetch(path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: payload });
        var result = await response.json().catch(function () { return { ok: false, message: '서버 응답을 읽을 수 없습니다.' }; });
        if (!response.ok || !result.ok) throw new Error(result.message || '엑셀 동기화를 처리할 수 없습니다.');
        return result;
      }

      if (excelUploadForm) {
        var fileInput = excelUploadForm.querySelector('input[type="file"]');
        fileInput?.addEventListener('change', async function () {
          try {
            excelCachedFile = fileInput.files && fileInput.files[0];
            excelCachedParsed = await readExcelSnapshot(excelCachedFile);
            excelSummary(excelCachedParsed, excelCachedFile);
            var message = document.querySelector('[data-excel-message]');
            if (message) message.textContent = '열 제목과 파일 구조를 확인했습니다. 버튼을 누르면 서버 검증을 시작합니다.';
          } catch (error) {
            excelCachedParsed = null;
            var message = document.querySelector('[data-excel-message]');
            if (message) message.textContent = error.message;
          }
        });
        excelUploadForm.addEventListener('submit', async function (event) {
          event.preventDefault();
          var button = excelUploadForm.querySelector('[data-excel-upload-button]');
          try {
            var file = fileInput.files && fileInput.files[0];
            if (!file) throw new Error('업로드할 엑셀 파일을 선택하세요.');
            if (!excelCachedParsed || excelCachedFile !== file) excelCachedParsed = await readExcelSnapshot(file);
            button.disabled = true;
            excelProgress(1, excelCachedParsed.rows.length + 2, '동기화 작업을 준비하고 있습니다.');
            if (excelCachedParsed.mode === 'bootstrap') {
              var confirmed = window.confirm('시스템 정보가 없는 파일입니다. Admin bootstrap으로 최초 연결할까요? 운영 backup을 확인한 뒤에만 진행하세요.');
              if (!confirmed) throw new Error('bootstrap 반영이 취소되었습니다.');
            }
            var created = await excelPost('/document-snapshots', {
              sourceName: file.name,
              sourceHash: excelCachedParsed.hash,
              clientSourceHash: excelCachedParsed.hash,
              totalCount: String(excelCachedParsed.rows.length),
              schemaVersion: String(excelCachedParsed.schemaVersion || 1),
              baseVersion: excelCachedParsed.baseVersion ? String(excelCachedParsed.baseVersion) : '',
              currentSnapshotId: excelCachedParsed.currentSnapshotId ? String(excelCachedParsed.currentSnapshotId) : '',
              exportManifestId: excelCachedParsed.exportManifestId || '',
              mode: excelCachedParsed.mode,
              hasRowKeys: excelCachedParsed.hasRowKeys ? '1' : ''
            });
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
            var message = document.querySelector('[data-excel-message]');
            if (message) message.textContent = error.message;
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
            window.alert(error.message);
          } finally {
            button.disabled = false; button.textContent = original;
          }
        });
      });
  `;
}
