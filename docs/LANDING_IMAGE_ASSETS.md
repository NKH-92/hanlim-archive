# 랜딩 이미지 장면 제작 기록

2026-09-23. 내장 image_gen 편집 도구 사용. 기존 `cloudflare-app/public/images/landing/archive-rack.png`를 두 구도의 공통 참조로 사용했다. 기존 원본은 보존했다. 아래 생성 이미지는 공간 분위기를 표현하는 시각 에셋이며, 실제 보관 좌표는 쇼릴 영상(왼쪽 1열·아래 1선반 기준)이 보여준다.

| 적용 파일 | 크기 | 용량 |
|---|---|---|
| `cloudflare-app/public/images/landing/archive-hero-desktop-v2.webp` | 1672 × 941 | 89,274 bytes |
| `cloudflare-app/public/images/landing/archive-hero-mobile-v2.webp` | 1122 × 1402 | 106,814 bytes |

생성 PNG를 WebP quality 85로 인코딩했다. 900px 이하에서는 모바일 이미지를 `<picture>`로 선택한다. 텍스트와 버튼은 이미지에 포함하지 않고 HTML로 렌더링한다.

## PC 최종 프롬프트

Use case: compositing. Edit the supplied mobile archive rack image into a wide editorial website hero asset, landscape 16:9. Preserve the recognizable brushed silver steel mobile shelving, crank handle, structural details and yellow/teal/white/black document binders. Recompose the shelving on the RIGHT 60 percent of the canvas, extending beyond the right edge slightly, with believable floor contact and soft daylight. LEFT 40 percent must be a quiet very light warm white wall and floor, no objects, clear negative space for HTML headline and buttons. A clean pharmaceutical document archive atmosphere, tactile realistic materials, restrained photography, natural light and subtle floor shadow, no glossy futuristic look. Maintain coherent shelf construction, no people, no plants, no computer screens. No text, labels with readable writing, logos, watermarks, UI cards or diagram overlays. Deliver a single image, not a website mockup.

## 모바일 최종 프롬프트

Use case: compositing. Edit the supplied archive shelving reference into a PORTRAIT 4:5 editorial photograph for a mobile website. Preserve the recognizable brushed silver steel mobile shelving, crank handle, bolts, and yellow/teal/white/black document binders. Frame a close three-quarter view of the end panel and TWO visible binder bays receding in depth; the rack should occupy most of this portrait frame, visible top through floor rails, minimal empty space. Calm warm white archive room and soft natural side daylight, tactile matte metal, credible shelf structure and binder scale. Same visual mood as the original, no people, no plant props, no computers, no fancy glow. No text, logos, readable labels, watermarks, UI cards or arrows. This is a standalone portrait image, not a collage or a website screenshot. Keep entire crank handle and bottom rail visible.

## 쇼릴 영상

2026-09-27. `outputs/showreel-20260927/`의 20초 쇼릴 마스터(1920 × 1080, 60fps, H.264 CRF 15 + AAC 256k, 61.7MB)를 랜딩 전송용으로 다시 인코딩했다. 장면 소스는 같은 폴더의 `showreel-source-20s.zip`(`reel.html`/`reel.js` 결정론적 모션, Playwright 프레임 캡처)이다. 원본과 마스터는 저장소에 넣지 않는다.

| 적용 파일 | 크기 | 용량 |
|---|---|---|
| `cloudflare-app/public/media/landing/archive-showreel-v1.mp4` | 1920 × 1080, 60fps, 20.0초 | 4,729,850 bytes |
| `cloudflare-app/public/images/landing/archive-showreel-poster-v1.webp` | 1920 × 1080 (1.6초 프레임) | 90,460 bytes |

- 영상: H.264 High CRF 26 preset slow, BT.709, 오디오 스트림은 원본 그대로 복사, `+faststart`. 챕터 시작점(0·2.5·5·12.1·15.2·17.5초)에 키프레임을 고정해 챕터 이동이 바로 재생되게 했다. 마스터 대비 SSIM 0.979이며 작은 화면 글자도 육안 차이가 없다.
- 포스터: 1.6초 "그 문서, 어디 있더라?" 프레임을 WebP quality 80으로 인코딩했다.
- 영상을 바꿀 때는 파일명 버전을 올리고 `landingView.js`의 챕터 시간, `DESIGN.md`의 쇼릴 계약, 랜딩 테스트의 전송 예산을 함께 갱신한다.

```bash
ffmpeg -i hanlim-archive-showreel-20s_master.mp4 -map 0:v:0 -map 0:a:0 -c:v libx264 -preset slow -crf 26 -profile:v high -level 4.2 -pix_fmt yuv420p -force_key_frames "0,2.5,5,12.1,15.2,17.5" -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -c:a copy -movflags +faststart archive-showreel-v1.mp4
ffmpeg -ss 1.6 -i hanlim-archive-showreel-20s_master.mp4 -frames:v 1 poster.png
ffmpeg -i poster.png -c:v libwebp -quality 80 -compression_level 6 archive-showreel-poster-v1.webp
```
