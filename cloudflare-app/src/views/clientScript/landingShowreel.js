// 공개 랜딩 쇼릴 조각. 실행 순서는 clientScript.js에서 고정한다.
// 사용자가 누를 때만 재생하고, 챕터 표시와 종료 후 행동을 영상 시간에 맞춘다.

export function landingShowreelScript() {
  return `      var reel = document.querySelector('[data-landing-reel]');
      var reelVideo = reel ? reel.querySelector('video') : null;
      if (reel && reelVideo) {
        var reelPlay = reel.querySelector('[data-reel-play]');
        var reelEnd = reel.querySelector('[data-reel-end]');
        var reelReplay = reel.querySelector('[data-reel-replay]');
        var reelChapters = Array.from(document.querySelectorAll('[data-reel-from]'));
        // 휴대폰 폭에서는 영상 속 작은 화면 글자가 읽히도록 전체 화면으로 재생한다.
        var reelCompact = mediaQuery('(max-width: 600px)');
        var syncReelChapters = function () {
          var time = reelVideo.currentTime;
          reelChapters.forEach(function (chapter) {
            var from = Number(chapter.getAttribute('data-reel-from'));
            var to = Number(chapter.getAttribute('data-reel-to'));
            chapter.classList.toggle('is-played', time >= to);
            if (time >= from && time < to) chapter.setAttribute('aria-current', 'true');
            else chapter.removeAttribute('aria-current');
          });
        };
        var startReel = function (from) {
          if (reelEnd) reelEnd.hidden = true;
          if (typeof from === 'number') reelVideo.currentTime = from;
          else if (reelVideo.ended) reelVideo.currentTime = 0;
          reelVideo.controls = true;
          var playing = reelVideo.play();
          if (playing && typeof playing.catch === 'function') playing.catch(function () {});
          if (reelCompact.matches && !document.fullscreenElement && typeof reelVideo.requestFullscreen === 'function') {
            reelVideo.requestFullscreen().catch(function () {});
          }
        };
        // 스크립트가 없으면 기본 컨트롤로 재생하고, 있으면 포스터 위 재생 버튼으로 시작한다.
        reelVideo.controls = false;
        if (reelPlay) {
          reelPlay.hidden = false;
          reelPlay.addEventListener('click', function () { startReel(); reelVideo.focus(); });
        }
        if (reelReplay) reelReplay.addEventListener('click', function () { startReel(0); reelVideo.focus(); });
        reelChapters.forEach(function (chapter) {
          chapter.addEventListener('click', function () { startReel(Number(chapter.getAttribute('data-reel-from'))); });
        });
        document.querySelectorAll('[data-reel-start]').forEach(function (link) {
          link.addEventListener('click', function () { startReel(); });
        });
        reelVideo.addEventListener('play', function () {
          if (reelPlay) reelPlay.hidden = true;
          if (reelEnd) reelEnd.hidden = true;
          reelVideo.controls = true;
        });
        reelVideo.addEventListener('timeupdate', syncReelChapters);
        reelVideo.addEventListener('seeked', syncReelChapters);
        reelVideo.addEventListener('ended', function () {
          var focusInReel = reel.contains(document.activeElement);
          syncReelChapters();
          reelVideo.controls = false;
          if (document.fullscreenElement === reelVideo && typeof document.exitFullscreen === 'function') document.exitFullscreen().catch(function () {});
          else if (reelVideo.webkitDisplayingFullscreen && typeof reelVideo.webkitExitFullscreen === 'function') reelVideo.webkitExitFullscreen();
          if (!reelEnd) return;
          reelEnd.hidden = false;
          var endAction = reelEnd.querySelector('a, button');
          if (focusInReel && endAction) endAction.focus();
        });
      }
`;
}
