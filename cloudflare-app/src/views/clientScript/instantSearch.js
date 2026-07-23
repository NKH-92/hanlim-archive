// 전역 클라이언트 스크립트의 즉시 검색 조각. 10,000건 전환부터 브라우저 전체 인덱스를 받지 않는다.

export function instantSearchScript() {
  return `      // 서버 즉시 검색: Search D1 후보 → Core 재검증 → 최대 30건 cursor 응답.
      var viewerApp = document.querySelector('[data-viewer-app]');
      var viewerForm = document.querySelector('[data-viewer-form]');
      var viewerInput = viewerForm ? viewerForm.querySelector('input[name="q"]') : null;
      if (viewerApp && viewerInput && window.SearchCore) {
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
        var activeRequest = null;
        var currentCursor = '';
        var currentItems = [];

        var restoreInitial = function () {
          if (activeRequest) activeRequest.abort();
          currentCursor = ''; currentItems = [];
          if (resultsBody) resultsBody.innerHTML = initialResults.body;
          if (resultsTitle) resultsTitle.textContent = initialResults.title;
          if (resultsCount) resultsCount.textContent = initialResults.count;
          if (searchLive) searchLive.textContent = '검색어를 입력하면 보관중 문서를 바로 찾습니다.';
          if (homeExtras) homeExtras.hidden = false;
          if (viewerApp.classList.contains('is-home')) viewerApp.hidden = true;
        };

        var formValue = function (name) {
          var control = viewerForm.elements ? viewerForm.elements.namedItem(name) : null;
          return control && typeof control.value === 'string' ? control.value : '';
        };

        var searchParams = function (cursor) {
          var params = new URLSearchParams({ q: viewerInput.value.trim(), limit: '30' });
          ['category','tag','zone','status','sort','rack','face','column','shelf'].forEach(function (name) {
            var value = formValue(name);
            if (value) params.set(name, value);
          });
          if (cursor) params.set('cursor', cursor);
          return params;
        };

        var resultRow = function (item, query) {
          var location = item.location || {};
          var disposed = item.status === 'disposed';
          return '<article class="viewer-result-row' + (disposed ? ' is-disposed' : '') + '" role="row">' +
            '<span class="viewer-result-name" role="cell" data-label="문서명"><a href="/documents/' + Number(item.id) + '" data-doc-click="' + Number(item.id) + '">' + window.SearchCore.highlightHtml(item.documentName || '문서명 없음', query, escapeHtmlClient) + '</a></span>' +
            '<span class="mono" role="cell" data-label="문서번호">' + window.SearchCore.highlightHtml(item.documentNumber || '', query, escapeHtmlClient) + '</span>' +
            '<span role="cell" data-label="개정">' + escapeHtmlClient(item.revisionNumber || '-') + '</span>' +
            '<span role="cell" data-label="제·개정일">' + escapeHtmlClient(item.revisionDate || '-') + '</span>' +
            '<span role="cell" data-label="대분류">' + escapeHtmlClient(item.categoryName || '-') + '</span>' +
            '<span class="viewer-result-location" role="cell" data-label="보관 위치">' + escapeHtmlClient(location.label || '위치 미지정') + '</span>' +
            '<span role="cell" data-label="상태"><span class="status ' + (disposed ? 'disposed' : 'active') + '">' + (disposed ? '폐기' : '보관중') + '</span></span>' +
            '</article>';
        };

        var renderPayload = function (payload, append) {
          var query = viewerInput.value.trim();
          currentItems = append ? currentItems.concat(payload.items || []) : (payload.items || []);
          currentCursor = payload.nextCursor || '';
          var html = '<div class="viewer-result-table" role="table" aria-label="문서 검색 결과">' +
            '<div class="viewer-result-header" role="row"><span>문서명</span><span>문서번호</span><span>개정</span><span>제·개정일</span><span>대분류</span><span>보관 위치</span><span>상태</span></div>' +
            '<div class="viewer-result-list" role="rowgroup">' +
            currentItems.map(function (item) { return resultRow(item, query); }).join('') +
            '</div></div>';
          if (!currentItems.length) {
            html = '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 문서가 없습니다.</p><div class="empty-actions"><a class="button secondary sm" href="/documents">전체 문서 보기</a><a class="button secondary sm" href="/app">검색 초기화</a></div></div>';
          } else if (payload.hasMore && currentCursor) {
            html += '<nav class="pagination"><button type="button" class="button secondary sm" data-search-more>더보기</button></nav>';
          }
          if (payload.fallback) {
            html = '<div class="alert warning" role="status">검색 인덱스 점검 중입니다. 결과가 제한될 수 있습니다.</div>' + html;
          }
          if (resultsBody) resultsBody.innerHTML = html;
          if (resultsTitle) resultsTitle.textContent = '"' + query + '" 검색 결과';
          if (resultsCount) resultsCount.textContent = Number(payload.candidateCount || currentItems.length).toLocaleString('ko-KR') + '건';
          if (searchLive) searchLive.textContent = currentItems.length ? currentItems.length + '건을 표시했습니다.' : '검색 결과가 없습니다.';
          if (homeExtras) homeExtras.hidden = true;
          viewerApp.hidden = false;
        };

        var renderError = function (message) {
          var params = searchParams('');
          if (resultsBody) resultsBody.innerHTML = '<div class="alert danger" role="alert">' + escapeHtmlClient(message || '검색을 처리하지 못했습니다.') + '</div><div class="empty-actions"><button type="button" class="button secondary sm" data-search-retry>다시 시도</button><a class="button secondary sm" href="/app?' + escapeHtmlClient(params.toString()) + '">검색 화면에서 계속</a></div>';
          if (resultsTitle) resultsTitle.textContent = '검색을 계속할 수 없습니다';
          if (resultsCount) resultsCount.textContent = '-';
          if (searchLive) searchLive.textContent = '검색 요청을 처리하지 못했습니다.';
          viewerApp.hidden = false;
        };

        var requestSearch = async function (cursor, append) {
          var query = viewerInput.value.trim();
          if (!query) { restoreInitial(); return; }
          if (activeRequest) activeRequest.abort();
          activeRequest = typeof AbortController === 'function' ? new AbortController() : null;
          if (searchLive) searchLive.textContent = append ? '다음 결과를 불러오는 중…' : '검색 중…';
          try {
            var response = await fetch('/api/viewer/search?' + searchParams(cursor).toString(), {
              headers: { Accept: 'application/json' },
              ...(activeRequest ? { signal: activeRequest.signal } : {})
            });
            var payload = await response.json().catch(function () { return {}; });
            if (response.status === 409 && payload.code === 'SEARCH_CURSOR_STALE') {
              return requestSearch('', false);
            }
            if (!response.ok || payload.ok === false || !Array.isArray(payload.items)) {
              throw new Error(payload.message || '검색 요청에 실패했습니다.');
            }
            window.__hanlimSearchIndexReady = true;
            renderPayload(payload, append);
          } catch (error) {
            if (error && error.name === 'AbortError') return;
            renderError(error && error.message);
          }
        };

        viewerInput.addEventListener('input', function () {
          clearTimeout(renderTimer);
          if (!viewerInput.value.trim()) { restoreInitial(); return; }
          renderTimer = setTimeout(function () { requestSearch('', false); }, 180);
        });
        resultsBody?.addEventListener?.('click', function (event) {
          var target = event.target instanceof Element ? event.target : null;
          if (target?.closest('[data-search-retry]')) { requestSearch('', false); return; }
          if (target?.closest('[data-search-more]') && currentCursor) requestSearch(currentCursor, true);
        });
        if (viewerInput.value.trim()) requestSearch('', false);
      }
`;
}
