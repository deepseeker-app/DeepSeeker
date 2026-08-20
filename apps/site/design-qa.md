# DeepSeeker Website Design QA

- Reference: approved DeepSeeker dark underwater direction and existing sticky-story layout
- Local URL: `http://127.0.0.1:4173/DeepSeeker/`
- Desktop viewport: `1440x900`
- Mobile viewport: `390x844`
- Build: `pnpm --filter @deepseeker/site run build`
- Browser: Codex in-app Browser

## Merge Result

- The dark hero, architecture explanation, and sticky feature story remain. Every feature visual is now original React/CSS UI, and the former demo slot shows a real DeepSeeker capture.
- DeepSeeker's original product content remains: local access, conversation workspaces, file/context behavior, install flow, MIT license panel, source actions, and FAQ.
- Navigation exposes Product, Harness, Demo, Skins, Download, Open source, and FAQ. Skins opens the standalone `/DeepSeeker/skins/` page.

## Hero Motion

- The abstract loops were removed.
- Canvas loads the path data from the real `whale.svg` asset and renders four slowly swimming whale outlines on desktop and two on mobile.
- The four desktop whales use three depth levels. Every whale edge stays sharp; size, opacity, speed, and stroke weight create the distance difference. Mobile keeps the lead and mid-depth whales, with the indigo whale moved fully into the viewport.
- The separate static color whale at the bottom of the hero was removed; the live Canvas whales now own the scene.
- Two light shafts on mobile and three on desktop move slowly from the top of the water. Near whales pick up a short pale-blue glint when they cross a shaft.
- Whales move in the direction they face, flex subtly through each stroke, wrap while offscreen, and leave small wake ripples behind them.
- Whale routes now combine two slow vertical curves with per-whale speed variation. The rendered body banks into the path and uses only a small breathing scale, replacing the earlier straight glide and whole-body shear.
- Pointer proximity now steers nearby whales; clicking or touching hero whitespace emits a finite sonar pulse. Download and platform tabs use a sliding segmented thumb.
- The Gallery click reference was inspected live and in source. Its verified pattern distorts the continuous background field and increases local particle density around a capped click ripple.
- DeepSeeker maps that pattern to a 1.3-1.65 second water-pressure burst: particles contract into the click, curve outward as bioluminescent trails, water lines bend at the wavefront, and nearby whales briefly orbit the disturbance.
- The water layer includes animated horizontal surface lines, whale wakes, pointer-created ripples, and at most three active click bursts. Mobile uses 20 particles per burst; desktop uses 38.
- Two desktop screenshots captured 2.6s apart differed across `45,323` PNG bytes after the swimming pass; mobile frames 2.2s apart differed across `32,654` bytes.
- `prefers-reduced-motion` keeps a static rendered state.

## Hero Exit

- Canvas scroll progress follows the first `72%` of the hero height. Near whales dive farther than distant silhouettes, while the water rows compress into a narrow lower band.
- Hero copy and the install console fade and descend through the existing GSAP scroll pass. No second Canvas or full-page scroll engine was added.
- At desktop `scrollY=480`, Canvas reports `data-scroll-progress=0.72`; the lead whale has moved down, water lines are compressed, and the product heading remains unobstructed.
- The intro animates children while one ScrollTrigger owns the hero containers. After scrolling to `720px` and returning to the top, both containers report `opacity: 1`, `visibility: visible`, and a zero transform.

## Product Image

- `public/deepseeker-app.png` restores the selected light Whale Song composition as a tightened `1440x810` PNG. The larger on-card controls keep the empty-session title, workspace, mode, and composer readable while excluding the session list, balance, detail panel, and desktop pet.
- The capture uses DeepSeeker's real empty-session screen. It keeps the native rainbow whale, composer, permission control, model selector, and active skin while excluding the personal session list and balance panel.
- The page no longer ships the Harness screenshot or the generated dashboard mock that previously appeared in this slot. The product frame stays flat and the bitmap is not enlarged beyond its source width.

## Skins Page

- The page is based on the Apache-2.0 `dsh-web-ui` Gallery implementation and keeps its source and license links visible.
- It lists the ten published skins with their real `2880x1800` light and dark preview images: Blue Fantasy, Whale Song, Harbor, QQ2008, Tonghuashun, Windows XP, Dragon Heir, Minecraft, Trading Terminal, and Hatsune Miku.
- Search matches names, authors, and tags. Category tabs cover retro, professional, art, and game skins.
- The original three-column density, WebGL fluid background, pointer-lit card tilt, light/dark hover preview, simulator dialog, theme switch, and copy-command flow are preserved. DeepSeeker branding replaces the Gallery page entry while package names and authorship remain intact.

## Browser Checks

- Desktop: `1440x900`, no horizontal overflow, hero and download panel remain readable.
- Mobile: `390x844`, no horizontal overflow, product facts, real empty-session capture, proof list, and MIT panel fit the viewport.
- Depth motion: desktop screenshots `1.8s` apart differed across `58,764` PNG bytes, while the lead and far layers stayed in their intended visual order.
- Mobile depth: `390x844` shows two whales, two light shafts, readable copy, and no overflow. The click burst still reaches `data-pulse-count=1` and `data-burst-count=1`.
- Motion Lab interaction: clicking a real tab keeps the hero pulse counter at `0`; clicking hero whitespace increments it to `1` and produces a visible sonar wave.
- Gallery interaction: desktop and `390x844` mobile clicks both increment `data-pulse-count` and `data-burst-count` to `1`; captured frames at roughly 120ms and 400ms show the contraction, particle expansion, curved trails, and water-field displacement.
- Motion Lab controls: source/download and macOS/Windows both update their selected state and sliding thumb; the Windows pending label remains visible.
- Pause behavior: hero Canvas reports `running` in view and `paused` when scrolled to the demo section, then resumes at the top.
- Updated pause behavior: after a `390x844` scroll to `scrollY=1523`, Canvas reports `paused`; platform-button clicks keep both pulse counters at `0`.
- Touch behavior: a `390x844` tap on hero whitespace increments the pulse counter to `1`; the page remains overflow-free.
- Product section: four original product facts render with the real DeepSeeker empty-session workspace.
- Product image: `src=/DeepSeeker/deepseeker-app.png?v=20260816-light-restored`, `naturalWidth=1440`, `naturalHeight=810`. The visible capture is DeepSeeker-branded and contains no test conversation or Harness logo. Its restored light composition keeps the approved visual direction, while the tighter crop enlarges the native controls and the version query prevents the rejected dark capture from remaining in browser cache.
- Hero return: after down/up scrolling, `.hero-copy` and `.hero-console` are visible at full opacity with `matrix(1, 0, 0, 1, 0, 0)`.
- Skins: both routes return HTTP 200; 10 cards and all 20 `2880x1800` preview images load; searching `鲸` returns 2; Retro returns QQ2008 and Windows XP; card tilt and the preview simulator work.
- Skins mobile: `390x844` has no horizontal overflow; all 20 images load, the WebGL canvas reaches ready state, and the full-viewport preview dialog keeps its close button usable.
- Feature story: mobile stage remains sticky at `68px`; the original plugin grid, task trajectory, and Profile/runtime panels activate in order.
- App preview: `deepseeker-app.png` loads at `1440x810`; there is no video player and no request for a `/harness/` media asset.
- Interactions: mobile menu exposes six links, Chinese/English updates the restored sections, source copy changes to `已复制`, and FAQ expansion works.
- Console: no relevant errors or warnings.

## Reference Review

- Fixed: every colored whale is sharp; distant whales no longer use Canvas blur.
- Fixed: scrolling back to the first viewport restores the hero content.
- Fixed: the Harness screenshot and generated dashboard mock are replaced with a capture from the running DeepSeeker empty-session workspace.
- Fixed: original product material no longer disappears beneath the Harness story.
- Fixed: the hero now has water-surface motion and expanding ripples.
- Fixed: whale movement no longer reads as uniform straight-line translation; the four whales use different route curves, stroke timing, and banking.
- Adapted: Gallery's click rhythm and local field displacement appear in the homepage hero as DeepSeeker water-pressure and bioluminescent effects.
- Added: the standalone skin browser is based on the Apache-2.0 Gallery implementation, uses its real skin previews and simulator, and replaces the page entry with DeepSeeker branding while keeping source, package, author, and license attribution.
- Fixed: all ten Harness screenshots, video, poster, and font files were removed. The page has zero image or media sources under `/harness/`.
- `video-shotcraft` was reviewed. Its Remotion recipes fit future promo-video work, while this live website uses a lighter Canvas runtime.

## Public Release Media QA

- Build passed with `4577` transformed modules. The existing skins manifest and unresolved build-time whale reference warnings remain unchanged.
- Desktop `1440x900`: title and DOM are correct, console errors/warnings `0`, horizontal overflow `0`.
- Desktop sticky story: active panel changed `0 -> 1 -> 2`; the sticky stage held at `106px`. The three panels show a plugin grid, traceable task run, and Profile/runtime selection.
- Mobile `390x844`: console errors/warnings `0`, horizontal overflow `0`, sticky stage held at `68px`, and all three panels activated.
- A mobile overlap between the fourth trajectory row and command bar was found and fixed. The final mobile frame is `343x302` and keeps all rows readable.
- System font stacks are used throughout. Computed styles no longer reference Host Grotesk or DM Sans.
- Desktop screenshots: `/tmp/deepseeker-site-original-ui-sticky-desktop.png`, `/tmp/deepseeker-site-original-ui-profiles-desktop.png`, `/tmp/deepseeker-site-real-app-preview-desktop.png`.
- Mobile screenshots: `/tmp/deepseeker-site-original-ui-sticky-mobile-fixed.png`, `/tmp/deepseeker-site-original-ui-profiles-mobile-final.png`, `/tmp/deepseeker-site-hero-mobile-390x844.png`.

final result: passed
