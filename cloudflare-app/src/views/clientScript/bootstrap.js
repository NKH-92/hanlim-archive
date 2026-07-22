// 전역 클라이언트 스크립트의 초기화·전역 UI 조각. 실행 순서는 clientScript.js에서 고정한다.

export function bootstrapScript(escapeHtmlSource) {
  return `    document.addEventListener('DOMContentLoaded', function () {
      var escapeHtmlClient = (${escapeHtmlSource});
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
`;
}
