// 전역 클라이언트 스크립트의 즉시 검색 조각. 실행 순서는 clientScript.js에서 고정한다.

export function instantSearchScript() {
  return `      // 즉시 검색 (아이디어 3): /app에서 타이핑 즉시 로컬 인덱스를 스코어링해 렌더한다.
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
            var answerDecision = core.decideDominantAnswer({
              query: text,
              documentNumber: top[0].document_number || '',
              firstScore: top[0].relevance_score,
              secondScore: top.length > 1 ? top[1].relevance_score : 0,
              resultCount: top.length
            });
            if (answerDecision.show) {
              answer = top[0];
              answerGrade = answerDecision.grade;
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
              window.__hanlimSearchIndexReady = true;
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
`;
}
