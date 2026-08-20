# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## DeepSeeker direction

- The DeepSeek Harness website may inform structure and scroll pacing, but its screenshots, video, fonts, code, and copy are not release assets. Keep public implementation original.
- Keep DeepSeeker and the rainbow whale visible in the first viewport. Preserve the approved blue-black underwater Canvas with restrained rainbow accents from the DeepSeeker mark.
- Product evidence must use a verified DeepSeeker capture. Feature explanations use code-native React/CSS UI scenes that are clearly DeepSeeker's own work.
- Use the approved order: product-led hero, Harness explanation, three-part sticky feature story, real DeepSeeker app preview, desktop install choices, FAQ, final download CTA, footer.
- Keep motion slow and continuous, with scroll-linked feature changes plus responsive and reduced-motion fallbacks. Do not copy third-party motion source or assets.
- Public copy should explain DeepSeeker's upstream relationship in plain language. Do not present borrowed media or wording as DeepSeeker product evidence.
- Do not let the Harness reference replace DeepSeeker's own product story. Keep the real desktop screenshot, local desktop access, conversation workspaces, file/context behavior, install steps, MIT license proof, and source-code actions visible in the site.
- Hero light trails must use the real DeepSeeker whale silhouette. Pair them with a restrained water surface and expanding pointer-responsive ripples; avoid unrelated abstract loops.
- Hero whales should swim slowly in the direction they face, flex subtly through each stroke, wrap only while offscreen, and leave small wake ripples behind them. Keep the motion calm and honor reduced-motion preferences.
- Keep a clear depth hierarchy in the hero: one bright lead whale, one mid-depth whale, and restrained far silhouettes. Desktop may show four total; mobile keeps only the lead and mid-depth whales. Do not restore the separate static whale badge at the bottom of the hero.
- Use two or three soft underwater light shafts inside the existing Canvas. Light may glint briefly on the nearer whale, but it must stay behind native text and controls.
- As the hero leaves the viewport, whales dive, the water field compresses toward the lower edge, and the hero copy/console fade down. This is the only scroll transition for the first viewport.
- Hero interaction uses local pointer steering plus click/touch sonar pulses; real controls must remain native and must not trigger the canvas pulse. Pause continuous Canvas work while offscreen, and use a sliding segmented thumb for install choices.
- Whale movement should follow shallow curved routes with independent speed changes and turn banking. Avoid rigid straight-line translation, obvious whole-body stretching, or synchronized movement.
- The Gallery reference at `https://gallery.dsh-market.com/` is approved only for click timing and spatial feedback. Translate its fluid displacement and denser click-local particles into DeepSeeker water pressure, bioluminescent particles, and nearby-whale avoidance; do not copy its starfield, logo, gallery copy, or visual assets.
- Click bursts must remain finite and capped: up to three active bursts, fewer particles on mobile, roughly 1.3-1.65 seconds of life, plus reduced-motion and offscreen-pause behavior.
- `video-shotcraft` is useful for future Remotion promo production and motion-direction references, but it is not a runtime dependency for the website Canvas effect.
- Keep every hero whale edge sharp. Show depth through scale, opacity, speed, and stroke weight; never blur the far or mid-depth whales.
- The hero exit must be fully reversible. Scrolling back to the top restores the copy and install console to visible, unshifted state.
- Product imagery must come from the real DeepSeeker repository or a verified running build. The homepage must show a DeepSeeker-branded capture, never an official Harness screenshot or generated replacement UI presented as the desktop application.
- Publish the skin collection at `/skins/` as a standalone DeepSeeker page based on the Apache-2.0 `dsh-web-ui` Gallery implementation. Preserve its real preview screenshots, three-column browsing density, search and category filters, pointer-responsive card lighting, WebGL background, preview simulator, theme toggle, and copy-command flow. Keep DeepSeeker branding at the page entry and preserve skin authorship, package names, source link, and license notice.
