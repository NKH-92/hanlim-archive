// 전역 클라이언트 스크립트의 검색어 제안 조각. 실행 순서는 clientScript.js에서 고정한다.

export function suggestionScript() {
  return `      document.querySelectorAll('[data-suggest-input]').forEach(function (input) {
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
`;
}
