# 랜딩 이미지 장면 제작 기록

2026-09-23. 내장 image_gen 편집 도구 사용. 기존 `cloudflare-app/public/images/landing/archive-rack.png`를 두 구도의 공통 참조로 사용했다. 기존 원본은 보존했다. 아래 생성 이미지는 공간 분위기를 표현하는 시각 에셋이며, 실제 보관 좌표는 별도의 HTML 격자에 표시한다.

| 적용 파일 | 크기 | 용량 |
|---|---|---|
| `cloudflare-app/public/images/landing/archive-hero-desktop-v2.webp` | 1672 × 941 | 89,274 bytes |
| `cloudflare-app/public/images/landing/archive-hero-mobile-v2.webp` | 1122 × 1402 | 106,814 bytes |

생성 PNG를 WebP quality 85로 인코딩했다. 900px 이하에서는 모바일 이미지를 `<picture>`로 선택한다. 텍스트와 버튼은 이미지에 포함하지 않고 HTML로 렌더링한다.

## PC 최종 프롬프트

Use case: compositing. Edit the supplied mobile archive rack image into a wide editorial website hero asset, landscape 16:9. Preserve the recognizable brushed silver steel mobile shelving, crank handle, structural details and yellow/teal/white/black document binders. Recompose the shelving on the RIGHT 60 percent of the canvas, extending beyond the right edge slightly, with believable floor contact and soft daylight. LEFT 40 percent must be a quiet very light warm white wall and floor, no objects, clear negative space for HTML headline and buttons. A clean pharmaceutical document archive atmosphere, tactile realistic materials, restrained photography, natural light and subtle floor shadow, no glossy futuristic look. Maintain coherent shelf construction, no people, no plants, no computer screens. No text, labels with readable writing, logos, watermarks, UI cards or diagram overlays. Deliver a single image, not a website mockup.

## 모바일 최종 프롬프트

Use case: compositing. Edit the supplied archive shelving reference into a PORTRAIT 4:5 editorial photograph for a mobile website. Preserve the recognizable brushed silver steel mobile shelving, crank handle, bolts, and yellow/teal/white/black document binders. Frame a close three-quarter view of the end panel and TWO visible binder bays receding in depth; the rack should occupy most of this portrait frame, visible top through floor rails, minimal empty space. Calm warm white archive room and soft natural side daylight, tactile matte metal, credible shelf structure and binder scale. Same visual mood as the original, no people, no plant props, no computers, no fancy glow. No text, logos, readable labels, watermarks, UI cards or arrows. This is a standalone portrait image, not a collage or a website screenshot. Keep entire crank handle and bottom rail visible.
