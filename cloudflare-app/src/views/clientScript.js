// 전역 클라이언트 스크립트와 검색 코어 전송 스크립트. page()가 인라인 <script>로 주입한다.

import { createSearchCore } from "../searchCore.js";
import { escapeHtml } from "../utils.js";

// 즉시 검색 페이지에 검색 코어 원본을 그대로 내려보낸다(로직 단일 출처).
// wrangler(esbuild) 번들이 함수 소스에 __name() 헬퍼를 주입하므로 브라우저용 shim을 함께 보낸다.
export function searchCoreScript() {
  return `<script>window.__name = window.__name || function (target) { return target; }; window.SearchCore = window.SearchCore || (${createSearchCore.toString()})();</script>`;
}

// escapeHtmlClient는 서버 utils.escapeHtml 소스를 그대로 내려보낸다(이스케이프 규칙 단일 출처).
// searchCoreScript와 같은 이유로 esbuild __name shim을 함께 보낸다.
export function clientScript() {
  return `
    document.addEventListener('DOMContentLoaded', function () {
      window.__name = window.__name || function (target) { return target; };
      var escapeHtmlClient = (${escapeHtml.toString()});
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

      document.querySelectorAll('[data-copy-text]').forEach(function (button) {
        button.addEventListener('click', function () {
          var text = button.dataset.copyText || '';
          if (!text) return;
          function done() {
            var original = button.textContent;
            button.textContent = '복사됨';
            setTimeout(function () { button.textContent = original; }, 1400);
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
      });

      document.querySelectorAll('[data-suggest-input]').forEach(function (input) {
        var datalist = input.parentElement ? input.parentElement.querySelector('[data-suggest-list]') : null;
        var timer = null;
        input.addEventListener('input', function () {
          clearTimeout(timer);
          var q = input.value.trim();
          if (!datalist || q.length < 2) return;
          timer = setTimeout(function () {
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

      var currentPath = location.pathname;
      var activeNav = Array.from(document.querySelectorAll('.archive-nav-item')).filter(function (item) {
        var href = item.getAttribute('href') || '';
        return href === currentPath || (href.length > 1 && currentPath.indexOf(href + '/') === 0);
      }).sort(function (left, right) {
        return (right.getAttribute('href') || '').length - (left.getAttribute('href') || '').length;
      })[0];
      if (activeNav) activeNav.classList.add('active');

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
        var homeExtras = document.querySelector('[data-home-extras]');
        var initialResults = {
          body: resultsBody ? resultsBody.innerHTML : '',
          title: resultsTitle ? resultsTitle.textContent : '',
          count: resultsCount ? resultsCount.textContent : ''
        };
        var initialHitCodes = Array.prototype.slice.call(document.querySelectorAll('.floor-rack.is-hit')).map(function (rack) {
          return rack.getAttribute('data-rack-code') || '';
        });
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
          return '<article class="doc-row' + rail + '">' +
            '<div class="doc-row-loc"><div>' +
            '<span class="loc-code">' + escapeHtmlClient(loc.main) + '</span>' +
            '<small class="loc-sub">' + escapeHtmlClient(loc.sub) + '</small>' +
            '</div><button type="button" class="icon-button" data-copy-text="' + escapeHtmlClient(loc.label) + '" title="위치 복사" aria-label="위치 복사"><i class="fa-regular fa-copy"></i></button></div>' +
            '<div class="doc-row-main"><div class="doc-row-title">' +
            '<a href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '">' + core.highlightHtml(doc.document_name || '문서명 없음', q, escapeHtmlClient) + '</a>' +
            instantBadges(doc) +
            '</div><div class="doc-row-meta">' +
            '<span class="mono">' + core.highlightHtml(doc.document_number || '', q, escapeHtmlClient) + '</span>' +
            '<span>' + escapeHtmlClient(doc.revision_number || '') + '</span>' +
            '<span>' + escapeHtmlClient(doc.revision_date || '제/개정일 미입력') + '</span>' +
            '<span>' + escapeHtmlClient(doc.disposal_due_year ? doc.disposal_due_year + '년 폐기 예정' : '폐기 예정 년도 미입력') + '</span>' +
            '<span>' + escapeHtmlClient(doc.category_name || '-') + '</span>' +
            (doc.match_reason ? '<span class="match-line">' + escapeHtmlClient(doc.match_reason) + '</span>' : '') +
            '</div></div>' +
            '<div class="doc-row-actions"><a class="button secondary sm" href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '"><i class="fa-solid fa-circle-info"></i>상세</a></div>' +
            '</article>';
        };

        var instantAnswer = function (doc, q, grade) {
          var loc = instantLocation(doc);
          var faceLabel = core.rackFaceLabel(doc);
          var head = (doc.zone_number ? doc.zone_number + '구역 ' : '') + (faceLabel ? faceLabel + '번 랙' : (doc.rack_code || ''));
          var gradeChip = grade === 'certain'
            ? '<span class="answer-grade certain">확실</span>'
            : '<span class="answer-grade likely">유력 · 확인 권장</span>';
          return '<section class="answer-card" data-answer-card>' +
            '<div class="answer-head"><small class="answer-label">가장 정확한 결과</small>' + gradeChip + '</div>' +
            '<div class="answer-loc">' + escapeHtmlClient(head) + '<span>' + escapeHtmlClient(loc.sub) + '</span></div>' +
            '<div class="answer-doc"><a href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '">' + core.highlightHtml(doc.document_name || '', q, escapeHtmlClient) + '</a>' + instantBadges(doc) +
            '<div class="answer-meta"><span class="mono">' + core.highlightHtml(doc.document_number || '', q, escapeHtmlClient) + '</span><span>' + escapeHtmlClient(doc.revision_number || '') + '</span><span>' + escapeHtmlClient(doc.revision_date || '제/개정일 미입력') + '</span><span>' + escapeHtmlClient(doc.disposal_due_year ? doc.disposal_due_year + '년 폐기 예정' : '폐기 예정 년도 미입력') + '</span><span>' + escapeHtmlClient(doc.category_name || '-') + '</span></div></div>' +
            '<div class="answer-actions">' +
            '<a class="button" href="/documents/' + doc.id + '" data-doc-click="' + doc.id + '"><i class="fa-solid fa-circle-info"></i>상세 정보</a>' +
            '<button type="button" class="button secondary" data-copy-text="' + escapeHtmlClient(loc.label) + '">위치 복사</button>' +
            '</div></section>';
        };

        var currentSelectFilters = function () {
          var num = function (name) {
            var el = viewerForm.querySelector('select[name="' + name + '"]');
            return el ? Number(el.value) || 0 : 0;
          };
          var statusEl = viewerForm.querySelector('select[name="status"]');
          var sortEl = viewerForm.querySelector('select[name="sort"]');
          var status = statusEl && statusEl.value === 'disposed' ? 'disposed' : 'active';
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
          if (f.status && doc.status !== f.status) return false;
          if (f.tagId) {
            var name = core.compactSearchText(tagNameById(f.tagId));
            if (!name) return false;
            if (core.compactSearchText(doc.tag_names || '').indexOf(name) === -1) return false;
          }
          return true;
        };

        var updateFloorHits = function (codes) {
          Array.prototype.forEach.call(document.querySelectorAll('.floor-rack'), function (rack) {
            var code = rack.getAttribute('data-rack-code') || '';
            rack.classList.toggle('is-hit', codes.indexOf(code) !== -1);
          });
        };

        var restoreInitial = function () {
          if (resultsBody) resultsBody.innerHTML = initialResults.body;
          if (resultsTitle) resultsTitle.textContent = initialResults.title;
          if (resultsCount) resultsCount.textContent = initialResults.count;
          if (homeExtras) homeExtras.hidden = false;
          if (viewerApp.classList.contains('is-home')) viewerApp.hidden = true;
          updateFloorHits(initialHitCodes);
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
          var answer = null;
          var answerGrade = 'likely';
          if (hasText && (merged.sort || 'relevance') === 'relevance' && top.length) {
            var compactQ = core.compactSearchText(text);
            var exactCode = compactQ && core.compactSearchText(top[0].document_number || '') === compactQ;
            if (exactCode || top.length === 1 || Number(top[0].relevance_score) >= Number(top[1].relevance_score || 0) * 1.5) {
              answer = top[0];
              answerGrade = exactCode ? 'certain' : 'likely';
            }
          }
          if (answer) {
            html += instantAnswer(answer, text, answerGrade);
            var rest = top.filter(function (item) { return item.id !== answer.id; });
            if (rest.length) {
              html += '<p class="rest-label">다른 결과 ' + (scored.length - 1) + '건</p>';
              html += '<div class="viewer-result-list">' + rest.map(function (item) { return instantRow(item, text); }).join('') + '</div>';
            }
          } else if (top.length) {
            html += '<div class="viewer-result-list">' + top.map(function (item) { return instantRow(item, text); }).join('') + '</div>';
          } else {
            html += '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>조건에 맞는 문서가 없습니다.</p></div>';
            var loose = [];
            for (var j = 0; j < searchIndex.length; j++) {
              var candidate = searchIndex[j];
              if (candidate.status !== merged.status) continue;
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
          if (homeExtras) homeExtras.hidden = true;
          viewerApp.hidden = false;
          updateFloorHits(top.map(function (item) { return item.rack_code; }));
        };

        var loadSearchIndex = function () {
          if (searchIndex || indexLoading) return;
          indexLoading = true;
          fetch('/api/search-index', { headers: { Accept: 'application/json' } })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
              searchIndex = data && data.documents ? data.documents : [];
              indexLoading = false;
              renderInstant();
            })
            .catch(function () { indexLoading = false; });
        };

        viewerInput.addEventListener('input', function () {
          clearTimeout(renderTimer);
          renderTimer = setTimeout(renderInstant, 100);
        });
        viewerInput.addEventListener('focus', loadSearchIndex);
        setTimeout(loadSearchIndex, 400);
      }

    });
  `;
}
