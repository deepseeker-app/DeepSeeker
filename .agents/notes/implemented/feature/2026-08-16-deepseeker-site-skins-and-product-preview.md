# Agent Note: DeepSeeker website skin browser and product preview

Status: implemented

English | [中文](2026-08-16-deepseeker-site-skins-and-product-preview.zh.md)

## Problem

The website used a low-resolution product screenshot whose conversation text and test output became the main visual detail when enlarged. A later replacement accidentally showed the official Harness interface, and the first skin page used CSS-drawn mock cards instead of the real skin previews. The hero also assigned Canvas blur to three whale layers and let intro and scroll animations write the same container opacity, which made the scene uncomfortable to inspect and could leave first-viewport content hidden after reverse scrolling.

## Decision

Every hero whale renders without Canvas blur. Scale, opacity, speed, and stroke weight carry depth, and one ScrollTrigger writes explicit visible opacity and translation values to the hero copy and install console so reverse scrolling restores both containers.

The product section uses `apps/site/public/deepseeker-app.png`, a tightened `1440x810` PNG that restores the selected light Whale Song composition. It shows the real DeepSeeker empty-session screen without the old test conversation, personal session list, balance panel, right file panel, or desktop pet. The tighter crop makes the native title and composer larger inside the website card, while restrained resampling avoids changing the approved light visual direction. The website adds no duplicate title bar, generated dashboard content, or perspective tilt. The image URL carries a version query so browsers do not keep the rejected dark capture.

`apps/site/skins/index.html` is a second Vite entry at `/DeepSeeker/skins/`. It is based on the Apache-2.0 `dsh-web-ui` Gallery implementation and keeps the ten real light/dark skin screenshots, three-column browsing density, search and category filters, WebGL background, pointer-lit card tilt, simulator dialog, theme switching, and copy-command flow. The page entry uses DeepSeeker branding while source, package, author, and license attribution remain visible.

## Alternatives considered

**Keep the old screenshot and hide its text with CSS.** The text is baked into the bitmap, and enlarging the 1203x768 source still exposes compression and soft edges.

**Use blur to preserve whale depth.** Blur made the colored whales look like rendering defects. Size, opacity, speed, and stroke weight preserve hierarchy while every silhouette remains inspectable.

**Link directly to the external gallery.** That would leave the product flow and uptime in another site's hands. The local route keeps the complete browsing and preview experience inside the DeepSeeker website.

**Keep the CSS-drawn skin cards.** They were vague placeholders and did not show what users actually install. The Apache-2.0 source supplies the real screenshots and simulator behavior required for an honest preview.

## Consequences

The homepage product image is a clear, real empty-state capture, the hero survives down-and-up scrolling, and all whales keep sharp edges. The website build has two HTML entries. The skin page ships the Gallery runtime and 20 high-resolution preview images, so updates must keep its manifest, screenshots, source attribution, and license in sync.

## Verification

The Vite production build emits both HTML entries. Browser checks cover the hero's restored opacity and transform, the DeepSeeker-branded product-image source and dimensions, all ten skin cards and 20 screenshots, search and category results, card tilt, WebGL readiness, simulator dialog and theme switch, desktop and `390x844` layouts, horizontal overflow, and console errors.
