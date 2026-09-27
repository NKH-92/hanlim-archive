// 전역 클라이언트 스크립트의 활성 내비·토스트·검색 클릭 집계 조각. 실행 순서는 clientScript.js에서 고정한다.

export const TOAST_MESSAGES = Object.freeze({
  created: "문서를 등록했어요.",
  "document-created": "문서를 등록하고 세트에 추가했어요.",
  updated: "문서 정보를 수정했어요.",
  revised: "새 개정 문서를 등록했어요.",
  moved: "문서를 새 위치로 옮겼어요.",
  disposed: "문서를 폐기했어요.",
  restored: "폐기를 해제했어요.",
  deleted: "문서를 완전히 삭제했어요.",
  saved: "저장했어요.",
  "bulk-disposed": "선택한 문서를 폐기했어요.",
  approved: "가입 요청을 승인했어요.",
  rejected: "가입 요청을 거절했어요.",
  enabled: "사용자 계정을 활성화했어요.",
  disabled: "사용자 계정을 비활성화했어요.",
  "permissions-saved": "사용자 권한을 저장했어요.",
  "template-saved": "역할 템플릿을 저장했어요.",
  "template-applied": "선택한 사용자에게 역할 템플릿을 적용했어요.",
  "password-reset": "임시 비밀번호를 설정했어요. 이 사용자는 다음에 로그인할 때 비밀번호를 바꿔야 해요.",
  "password-changed": "비밀번호를 바꿨어요.",
  "user-deleted": "계정을 완전히 삭제했어요.",
  "user-created": "승인 사용자를 추가했어요. 임시 비밀번호를 안전하게 전달해 주세요.",
  "set-locked": "준비 문서 세트를 잠갔어요.",
  "set-unlocked": "준비 문서 세트의 잠금을 풀었어요.",
  error: "요청을 처리하지 못했어요. 입력값을 확인해 주세요."
});

export function navigationFeedbackScript() {
  const toastMessages = JSON.stringify(TOAST_MESSAGES);
  return `      var currentPath = location.pathname;
      var currentUrl = new URL(location.href);
      var parentNavigation = /^\\/documents\\/\\d+(?:\\/|$)/.test(currentPath) ? '/app'
        : currentPath.startsWith('/document-snapshots/') ? '/documents/import'
        : currentPath.startsWith('/disposal-batches') ? '/documents/disposal'
        : currentPath.startsWith('/admin/users/') || currentPath.startsWith('/admin/role-templates') ? '/admin/settings' : '';
      var activeNavItems = Array.from(document.querySelectorAll('.archive-nav-item, .nav-sub-link, [data-command-item]')).filter(function (item) {
        var href = item.getAttribute('href') || '';
        if (!href) return false;
        var itemUrl = new URL(href, location.origin);
        var pathMatches = itemUrl.pathname === currentPath || (itemUrl.pathname.length > 1 && currentPath.indexOf(itemUrl.pathname + '/') === 0);
        var queryMatches = Array.from(itemUrl.searchParams.entries()).every(function (entry) {
          return currentUrl.searchParams.getAll(entry[0]).includes(entry[1]);
        });
        return (pathMatches && queryMatches) || Boolean(parentNavigation && href === parentNavigation);
      }).sort(function (left, right) {
        return (right.getAttribute('href') || '').length - (left.getAttribute('href') || '').length;
      });
      var activeHref = activeNavItems[0] ? activeNavItems[0].getAttribute('href') : '';
      activeNavItems.forEach(function (item) {
        if (item.getAttribute('href') === activeHref) { item.classList.add('active'); item.setAttribute('aria-current', 'page'); }
      });

      // 검색·위치는 항상 보인다. 그룹은 현재 화면이 속하면 열고, 그 밖에는 사용자가 마지막으로 둔 상태,
      // 기억한 상태가 없으면 서버가 정한 기본값(업무는 펼침)을 따른다. 이전 배열 형식 값은 무시한다.
      var storedNavigationGroups = {};
      try {
        var parsedNavigationGroups = JSON.parse(localStorage.getItem('hanlimNavigationGroups') || '{}');
        storedNavigationGroups = parsedNavigationGroups && typeof parsedNavigationGroups === 'object' && !Array.isArray(parsedNavigationGroups) ? parsedNavigationGroups : {};
      } catch { storedNavigationGroups = {}; }
      var navigationGroups = Array.from(document.querySelectorAll('[data-nav-group]'));
      navigationGroups.forEach(function (group) {
        var key = group.getAttribute('data-nav-group') || '';
        var hasActiveItem = Boolean(group.querySelector('.archive-nav-item.active, .nav-sub-link.active'));
        var remembered = storedNavigationGroups[key];
        group.classList.toggle('has-active', hasActiveItem);
        group.open = hasActiveItem || (typeof remembered === 'boolean' ? remembered : group.getAttribute('data-nav-default') === 'open');
        group.addEventListener('toggle', function () {
          var state = {};
          navigationGroups.forEach(function (item) {
            var itemKey = item.getAttribute('data-nav-group') || '';
            if (itemKey) state[itemKey] = item.open;
          });
          try { localStorage.setItem('hanlimNavigationGroups', JSON.stringify(state)); } catch {}
        });
      });

      var toastKey = new URLSearchParams(location.search).get('toast');
      if (toastKey) {
        var toastParams = new URLSearchParams(location.search);
        var toastMessages = ${toastMessages};
        var toastMessage = toastMessages[toastKey];
        if (toastKey === 'bulk-disposed') {
          var disposedCount = Number(toastParams.get('disposed') || 0);
          var skippedCount = Number(toastParams.get('skipped') || 0);
          toastMessage = '문서 ' + disposedCount + '건을 폐기했어요' + (skippedCount ? '. ' + skippedCount + '건은 건너뛰었어요' : '') + '.';
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
        if (document.body?.dataset.accessMode === 'demo_readonly') return;
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
`;
}
