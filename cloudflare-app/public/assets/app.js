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
      function setNav(open) {
        if (!nav) return;
        nav.classList.toggle('is-open', open);
        if (scrim) scrim.classList.toggle('is-open', open);
      }
      if (hamburger) hamburger.addEventListener('click', function () { setNav(true); });
      if (close) close.addEventListener('click', function () { setNav(false); });
      if (scrim) scrim.addEventListener('click', function () { setNav(false); });

      document.querySelectorAll('[data-confirm]').forEach(function (form) {
        form.addEventListener('submit', function (event) {
          if (!window.confirm(form.dataset.confirm)) event.preventDefault();
        });
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
      function syncBulk() {
        var items = Array.from(document.querySelectorAll('[data-bulk-item]'));
        var checkedItems = items.filter(function (item) { return item.checked; });
        var checked = checkedItems.map(function (item) { return item.value; });
        if (bulkBar) bulkBar.hidden = checked.length === 0;
        if (bulkIds) bulkIds.value = checked.join(',');
        if (bulkCount) bulkCount.textContent = checked.length + '건 선택';
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
          if (!count || !window.confirm('선택한 ' + count + '건을 폐기 상태로 변경할까요?')) event.preventDefault();
        });
      }

      var currentPath = location.pathname;
      var activeNavItems = Array.from(document.querySelectorAll('.archive-nav-item')).filter(function (item) {
        var href = item.getAttribute('href') || '';
        return href === currentPath || (href.length > 1 && currentPath.indexOf(href + '/') === 0);
      }).sort(function (left, right) {
        return (right.getAttribute('href') || '').length - (left.getAttribute('href') || '').length;
      });
      var activeHref = activeNavItems[0] ? activeNavItems[0].getAttribute('href') : '';
      activeNavItems.forEach(function (item) {
        if (item.getAttribute('href') === activeHref) item.classList.add('active');
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
          error: '요청을 처리하지 못했습니다. 입력값을 확인하세요.'
        };
        var toastMessage = toastMessages[toastKey];
        if (toastKey === 'bulk-disposed') {
          var disposedCount = Number(toastParams.get('disposed') || 0);
          var skippedCount = Number(toastParams.get('skipped') || 0);
          toastMessage = '폐기 ' + disposedCount + '건 완료' + (skippedCount ? ' · 건너뜀 ' + skippedCount + '건' : '') + '.';
        }
        if (toastMessage) {
          var toast = document.createElement('div');
          toast.className = 'app-toast' + (toastKey === 'error' ? ' is-error' : '');
          toast.setAttribute('role', 'status');
          toast.textContent = toastMessage;
          document.body.appendChild(toast);
          setTimeout(function () { toast.classList.add('is-visible'); }, 30);
          setTimeout(function () { toast.classList.remove('is-visible'); }, 3200);
          setTimeout(function () { toast.remove(); }, 3700);
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
          var num = function (name) {
            var el = viewerForm.querySelector('select[name="' + name + '"]');
            return el ? Number(el.value) || 0 : 0;
          };
          var statusEl = viewerForm.querySelector('select[name="status"]');
          var sortEl = viewerForm.querySelector('select[name="sort"]');
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
          if (!searchIndex) { loadSearchIndex(); return; }
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
              return '<span class="chip active">' + escapeHtmlClient((chipLabels[chip.type] || chip.type) + ': ' + chip.label) + '</span>';
            }).join('') + '</div>';
          }
          if (top.length) {
            html += '<div class="viewer-result-table" role="table" aria-label="문서 검색 결과"><div class="viewer-result-header" role="row"><span>문서명</span><span>문서번호</span><span>개정</span><span>제·개정일</span><span>대분류</span><span>보관 위치</span><span>상태</span></div><div class="viewer-result-list" role="rowgroup">' + top.map(function (item) { return instantRow(item, text); }).join('') + '</div></div>';
          } else {
            html += '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 문서가 없습니다.</p></div>';
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
          fetch('/api/search-index', { headers: { Accept: 'application/json' } })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
              searchIndex = data && data.documents ? data.documents : [];
              window.__hanlimSearchIndexReady = true;
              indexLoading = false;
              renderInstant();
            })
            .catch(function () { indexLoading = false; });
        };

        viewerInput.addEventListener('input', function () {
          clearTimeout(renderTimer);
          if (searchLive && viewerInput.value.trim()) searchLive.textContent = '검색 중…';
          renderTimer = setTimeout(renderInstant, 100);
        });
        viewerInput.addEventListener('focus', loadSearchIndex);
        setTimeout(loadSearchIndex, 400);
      }

    });
  
