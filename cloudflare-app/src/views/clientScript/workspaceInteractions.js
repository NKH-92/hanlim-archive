// 문서 작업 공간의 열 설정·행 키보드 탐색·빠른 미리보기.

export function workspaceInteractionScript() {
  return `      var workspaceSearch = document.querySelector('[data-viewer-form] input[name="q"]');
      var workspacePreview = document.querySelector('[data-document-preview]');
      var columnToggle = document.querySelector('[data-column-toggle="revision-date"]');

      var applyRevisionColumn = function (visible) {
        document.querySelectorAll('[data-column="revision-date"]').forEach(function (cell) {
          cell.hidden = !visible;
        });
        document.querySelectorAll('.viewer-result-table').forEach(function (table) {
          table.classList.toggle('show-revision-date', visible);
        });
        if (columnToggle) columnToggle.checked = visible;
      };

      if (columnToggle) {
        var storedColumns = '';
        try { storedColumns = localStorage.getItem('hanlimDocumentColumns') || ''; } catch {}
        applyRevisionColumn(storedColumns.split(',').includes('revision-date'));
        columnToggle.addEventListener('change', function () {
          applyRevisionColumn(columnToggle.checked);
          try { localStorage.setItem('hanlimDocumentColumns', columnToggle.checked ? 'revision-date' : ''); } catch {}
        });
      }

      var fillPreview = function (row) {
        if (!workspacePreview || !row) return;
        var setText = function (selector, value) {
          var target = workspacePreview.querySelector(selector);
          if (target) target.textContent = value || '-';
        };
        setText('[data-preview-name]', row.dataset.documentName);
        setText('[data-preview-number]', (row.dataset.documentNumber || '') + ' · ' + (row.dataset.documentRevision || '-'));
        setText('[data-preview-category]', row.dataset.documentCategory);
        setText('[data-preview-location]', row.dataset.documentLocation);
        setText('[data-preview-status]', row.dataset.documentStatus);
        var link = workspacePreview.querySelector('[data-preview-link]');
        if (link) link.href = row.dataset.documentUrl || '/app';
        document.querySelectorAll('[data-document-row]').forEach(function (item) {
          item.classList.toggle('is-selected', item === row);
          item.setAttribute('aria-selected', item === row ? 'true' : 'false');
        });
        workspacePreview.hidden = false;
      };

      document.addEventListener('click', function (event) {
        var target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-preview-close]')) {
          if (workspacePreview) workspacePreview.hidden = true;
          document.querySelectorAll('[data-document-row]').forEach(function (item) {
            item.classList.remove('is-selected');
            item.removeAttribute('aria-selected');
          });
          return;
        }
        var row = target?.closest('[data-document-row]');
        if (!row || target.closest('a, button, input, select, textarea, label')) return;
        if (window.matchMedia?.('(min-width: 1180px)').matches && workspacePreview) {
          fillPreview(row);
          return;
        }
        if (row.dataset.documentUrl) location.assign(row.dataset.documentUrl);
      });

      document.addEventListener('keydown', function (event) {
        var target = event.target instanceof Element ? event.target : null;
        var editing = target?.matches('input, textarea, select, [contenteditable="true"]');
        if (event.key === '/' && !editing && workspaceSearch) {
          event.preventDefault();
          workspaceSearch.focus();
          workspaceSearch.select();
          return;
        }
        var row = target?.closest('[data-document-row]');
        if (!row) return;
        var rows = Array.from(document.querySelectorAll('[data-document-row]'));
        var index = rows.indexOf(row);
        if (event.key === 'ArrowDown' && rows[index + 1]) {
          event.preventDefault();
          rows[index + 1].focus();
          if (window.matchMedia?.('(min-width: 1180px)').matches) fillPreview(rows[index + 1]);
        } else if (event.key === 'ArrowUp' && rows[index - 1]) {
          event.preventDefault();
          rows[index - 1].focus();
          if (window.matchMedia?.('(min-width: 1180px)').matches) fillPreview(rows[index - 1]);
        } else if (event.key === 'Enter' && row.dataset.documentUrl) {
          event.preventDefault();
          location.assign(row.dataset.documentUrl);
        }
      });

`;
}
