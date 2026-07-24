// 선택 작업과 명령 팔레트 동작. 실행 순서는 clientScript.js에서 고정한다.

export function bulkCommandScript() {
  return `      var bulkBar = document.querySelector('[data-bulk-bar]');
      var bulkIds = Array.from(document.querySelectorAll('[data-bulk-ids]'));
      var bulkCount = document.querySelector('[data-bulk-count]');
      var bulkSummary = document.querySelector('[data-bulk-summary]');
      var bulkSelectAll = document.querySelector('[data-bulk-select-all]');
      var bulkConfirmCount = document.querySelector('[data-bulk-confirm-count]');
      var bulkConfirmCountInput = document.querySelector('[data-bulk-confirm-count-input]');
      var bulkConfirmButton = document.querySelector('[data-bulk-confirm-button]');
      var bulkDisposalButton = document.querySelector('[data-disposal-limit]');
      function syncBulk() {
        var items = Array.from(document.querySelectorAll('[data-bulk-item]'));
        var checkedItems = items.filter(function (item) { return item.checked; });
        var checked = checkedItems.map(function (item) { return item.value; });
        if (bulkBar) bulkBar.hidden = checked.length === 0;
        bulkIds.forEach(function (input) { input.value = checked.join(','); });
        if (bulkCount) bulkCount.textContent = bulkBar && bulkBar.hasAttribute('data-document-selection')
          ? checked.length + '건 선택'
          : '원본 ' + checked.length + '부 선택';
        if (bulkConfirmCount) bulkConfirmCount.textContent = checked.length + '부';
        if (bulkConfirmCountInput) bulkConfirmCountInput.value = String(checked.length);
        if (bulkConfirmButton) {
          var disposalLimit = bulkDisposalButton ? Number(bulkDisposalButton.dataset.disposalLimit || 0) : 0;
          bulkConfirmButton.disabled = checked.length === 0 || Boolean(disposalLimit && checked.length > disposalLimit);
          bulkConfirmButton.textContent = checked.length
            ? '예, 원본 ' + checked.length + '부를 폐기합니다'
            : '예, 폐기합니다';
        }
        if (bulkSummary) {
          bulkSummary.innerHTML = '';
          checkedItems.forEach(function (item) {
            var row = item.closest('[data-document-row]');
            var name = row ? row.querySelector('.viewer-result-name a, .name-cell a') : null;
            var number = row ? row.querySelector('.mono-cell, .mono') : null;
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
        if (bulkDisposalButton) {
          var maxDisposal = Number(bulkDisposalButton.dataset.disposalLimit || 0);
          bulkDisposalButton.disabled = Boolean(maxDisposal && checked.length > maxDisposal);
          bulkDisposalButton.title = maxDisposal && checked.length > maxDisposal
            ? '폐기는 한 번에 ' + maxDisposal + '건 이하만 선택하세요.'
            : '';
        }
      }
      document.addEventListener('change', function (event) {
        if (event.target && event.target.matches && event.target.matches('[data-bulk-item]')) syncBulk();
      });
      if (bulkSelectAll) {
        bulkSelectAll.addEventListener('change', function () {
          document.querySelectorAll('[data-bulk-item]').forEach(function (item) { item.checked = bulkSelectAll.checked; });
          syncBulk();
        });
      }
      syncBulk();

      var setSelectionForm = document.querySelector('[data-set-selection-form]');
      var setTarget = document.querySelector('[data-set-target]');
      var setVersion = document.querySelector('[data-set-version]');
      if (setSelectionForm && setTarget) {
        var syncSetTarget = function () {
          var option = setTarget.options[setTarget.selectedIndex];
          var setId = Number(option ? option.value : 0);
          setSelectionForm.action = setId ? '/sets/' + setId + '/add' : '/sets/0/add';
          if (setVersion) setVersion.value = option ? option.dataset.version || '' : '';
        };
        setTarget.addEventListener('change', syncSetTarget);
        syncSetTarget();
      }

      var commandPalette = document.querySelector('[data-command-palette]');
      var commandInput = document.querySelector('[data-command-input]');
      var commandItems = Array.prototype.slice.call(document.querySelectorAll('[data-command-item]'));
      var commandActiveIndex = -1;
      var commandPreviousFocus = null;
      var visibleCommands = function () {
        return commandItems.filter(function (item) { return !item.hidden; });
      };
      var setActiveCommand = function (index) {
        var visible = visibleCommands();
        commandItems.forEach(function (item) {
          item.classList.remove('is-active');
          item.removeAttribute('aria-current');
        });
        if (!visible.length) {
          commandActiveIndex = -1;
          return;
        }
        commandActiveIndex = Math.max(0, Math.min(index, visible.length - 1));
        visible[commandActiveIndex].classList.add('is-active');
        visible[commandActiveIndex].setAttribute('aria-current', 'true');
        visible[commandActiveIndex].scrollIntoView({ block: 'nearest' });
      };
      var filterCommands = function () {
        var query = (commandInput ? commandInput.value : '').trim().toLocaleLowerCase('ko-KR');
        commandItems.forEach(function (item) {
          var label = (item.getAttribute('data-command-label') || item.textContent || '').toLocaleLowerCase('ko-KR');
          item.hidden = Boolean(query && label.indexOf(query) === -1);
        });
        setActiveCommand(0);
      };
      var openCommands = function () {
        if (!commandPalette || typeof commandPalette.showModal !== 'function') return;
        commandPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      if (commandPalette) {
        commandPalette.addEventListener('close', function () {
          commandActiveIndex = -1;
          commandItems.forEach(function (item) {
            item.classList.remove('is-active');
            item.removeAttribute('aria-current');
          });
          if (commandPreviousFocus && document.contains(commandPreviousFocus)) commandPreviousFocus.focus();
          commandPreviousFocus = null;
        });
      }
      if (commandInput) {
        commandInput.addEventListener('input', filterCommands);
        commandInput.addEventListener('keydown', function (event) {
          var visible = visibleCommands();
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveCommand(commandActiveIndex + 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveCommand(commandActiveIndex <= 0 ? visible.length - 1 : commandActiveIndex - 1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            setActiveCommand(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            setActiveCommand(visible.length - 1);
          } else if (event.key === 'Enter' && visible.length) {
            event.preventDefault();
            visible[Math.max(0, commandActiveIndex)].click();
          } else if (event.key === 'Escape' && commandPalette && commandPalette.open) {
            event.preventDefault();
            commandPalette.close();
          }
        });
      }
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
`;
}
