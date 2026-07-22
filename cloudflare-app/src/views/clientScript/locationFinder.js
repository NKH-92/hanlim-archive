// 문서 상세의 현장 찾기·도면 확대·검색 복귀를 점진적으로 보강한다.

export function locationFinderScript() {
  return `      var documentDetail = document.querySelector('[data-document-detail]');
      if (documentDetail) {
        documentDetail.querySelectorAll('[data-back-to-results]').forEach(function (link) {
          link.addEventListener('click', function (event) {
            try {
              var previous = new URL(document.referrer || '', location.href);
              var sameSearchFlow = previous.origin === location.origin && (previous.pathname === '/app' || previous.pathname === '/documents');
              if (!sameSearchFlow || history.length < 2) return;
              event.preventDefault();
              history.back();
            } catch {}
          });
        });

        function centerInside(scroller, target) {
          if (!scroller || !target) return;
          var scrollRect = scroller.getBoundingClientRect();
          var targetRect = target.getBoundingClientRect();
          var left = scroller.scrollLeft + targetRect.left - scrollRect.left - (scrollRect.width - targetRect.width) / 2;
          scroller.scrollLeft = Math.max(0, left);
        }

        function centerLocationTargets(scope) {
          (scope || documentDetail).querySelectorAll('[data-rack-scroll]').forEach(function (scroller) {
            centerInside(scroller, scroller.querySelector('.mini-slot.active'));
          });
          (scope || documentDetail).querySelectorAll('[data-document-floor-scroll]').forEach(function (scroller) {
            centerInside(scroller, scroller.querySelector('.floor-rack.is-hit, .floor-rack[data-face-hit]'));
          });
        }

        requestAnimationFrame(function () { centerLocationTargets(documentDetail); });
        var locationResizeTimer = 0;
        window.addEventListener('resize', function () {
          clearTimeout(locationResizeTimer);
          locationResizeTimer = setTimeout(function () { centerLocationTargets(documentDetail); }, 80);
        });

        documentDetail.querySelectorAll('[data-document-floor-zoom]').forEach(function (button) {
          var scroller = document.getElementById(button.getAttribute('aria-controls') || '');
          if (!scroller) return;
          button.addEventListener('click', function () {
            var expanded = scroller.classList.toggle('is-zoomed');
            button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
            button.textContent = expanded ? '전체 보기' : '도면 크게 보기';
            if (expanded) centerInside(scroller, scroller.querySelector('.floor-rack.is-hit, .floor-rack[data-face-hit]'));
            else scroller.scrollLeft = 0;
          });
        });

        var actionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null;
        function syncDetailActions() {
          documentDetail.querySelectorAll('[data-detail-actions]').forEach(function (details) {
            if (actionQuery?.matches) {
              if (!details.dataset.mobileInitialized) details.open = false;
              details.dataset.mobileInitialized = 'true';
            } else {
              details.open = true;
              delete details.dataset.mobileInitialized;
            }
          });
        }
        syncDetailActions();
        actionQuery?.addEventListener?.('change', syncDetailActions);

        var finder = documentDetail.querySelector('[data-location-find-dialog]');
        if (finder) {
          var currentStep = 1;
          var previousButton = finder.querySelector('[data-find-previous]');
          var nextButton = finder.querySelector('[data-find-next]');
          var finishButton = finder.querySelector('[data-find-finish]');
          var progressText = finder.querySelector('[data-find-progress-text]');

          function showFindStep(step) {
            currentStep = Math.min(3, Math.max(1, Number(step) || 1));
            finder.dataset.locationFindStep = String(currentStep);
            finder.querySelectorAll('[data-find-step]').forEach(function (panel) {
              panel.hidden = Number(panel.dataset.findStep) !== currentStep;
            });
            finder.querySelectorAll('[data-find-progress-step]').forEach(function (item) {
              var itemStep = Number(item.dataset.findProgressStep);
              item.classList.toggle('is-current', itemStep === currentStep);
              item.classList.toggle('is-complete', itemStep < currentStep);
            });
            if (previousButton) previousButton.disabled = currentStep === 1;
            if (nextButton) nextButton.hidden = currentStep === 3;
            if (finishButton) finishButton.hidden = currentStep !== 3;
            if (progressText) progressText.textContent = currentStep + ' / 3';
            requestAnimationFrame(function () {
              centerLocationTargets(finder);
              finder.querySelector('[data-find-step="' + currentStep + '"] h3')?.focus?.({ preventScroll: true });
            });
          }

          nextButton?.addEventListener('click', function () { showFindStep(currentStep + 1); });
          previousButton?.addEventListener('click', function () { showFindStep(currentStep - 1); });
          documentDetail.querySelectorAll('[data-open-modal="location-find-modal"]').forEach(function (button) {
            button.addEventListener('click', function () {
              showFindStep(1);
              document.body.classList.add('is-location-finding');
            });
          });
          finder.addEventListener('close', function () {
            document.body.classList.remove('is-location-finding');
            finder.classList.remove('is-field-readable');
            var readability = finder.querySelector('[data-field-readability]');
            readability?.setAttribute('aria-pressed', 'false');
          });

          finder.querySelector('[data-field-readability]')?.addEventListener('click', function (event) {
            var pressed = finder.classList.toggle('is-field-readable');
            event.currentTarget.setAttribute('aria-pressed', pressed ? 'true' : 'false');
          });

          var rackInput = finder.querySelector('[data-rack-code-input]');
          var rackStatus = finder.querySelector('[data-rack-check-status]');
          finder.querySelector('[data-rack-check]')?.addEventListener('click', function () {
            var expected = String(finder.dataset.expectedRackCode || '').trim().toUpperCase();
            var entered = String(rackInput?.value || '').trim().toUpperCase();
            if (!entered) {
              if (rackStatus) rackStatus.textContent = '랙 표지의 코드를 입력해 주세요.';
              rackInput?.focus();
              return;
            }
            var matched = entered === expected;
            if (rackStatus) {
              rackStatus.textContent = matched ? '현재 찾는 랙과 일치합니다.' : '다른 랙입니다. 위치 Hero의 랙 코드를 다시 확인하세요.';
              rackStatus.classList.toggle('is-match', matched);
              rackStatus.classList.toggle('is-mismatch', !matched);
            }
            if (matched && navigator.vibrate) navigator.vibrate(40);
          });
        }
      }
`;
}
