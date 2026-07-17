// 전역 클라이언트 스크립트의 일괄 작업·명령 팔레트 조각. 실행 순서는 clientScript.js에서 고정한다.

export function bulkCommandScript() {
  return `      var bulkBar = document.querySelector('[data-bulk-bar]');
      var bulkIds = document.querySelector('[data-bulk-ids]');
      var bulkCount = document.querySelector('[data-bulk-count]');
      var bulkSelectAll = document.querySelector('[data-bulk-select-all]');
      function syncBulk() {
        var items = Array.from(document.querySelectorAll('[data-bulk-item]'));
        var checkedItems = items.filter(function (item) { return item.checked; });
        var checked = checkedItems.map(function (item) { return item.value; });
        if (bulkBar) bulkBar.hidden = checked.length === 0;
        if (bulkIds) bulkIds.value = checked.join(',');
        if (bulkCount) bulkCount.textContent = checked.length + '건 선택';
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
          if (!count) {
            event.preventDefault();
            return;
          }
          if (!window.confirm('선택한 ' + count + '건을 일괄 폐기 처리할까요? 폐기 후에는 관리자만 해제할 수 있습니다.')) {
            event.preventDefault();
          }
        });
      }
`;
}
