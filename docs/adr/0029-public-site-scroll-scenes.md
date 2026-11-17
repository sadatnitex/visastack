# ADR-0029: Scroll scenes and one depth stylesheet for the public site

- **Status:** Accepted, 17 November 2026
- **Date:** 2026-11-17
- **Deciders:** Owner (public site upgrade decisions, 17 November 2026)
- **Unit:** WP-PUB1 (public site foundation)
- **Amends:** ADR 0027 (visual depth for illustrations), for one more stylesheet only (section "Scope")

## Context

The owner approved an Apple-grade public site: one continuous scroll story over five pages (Home, How It Works, Privacy and Trust, Countries, For Agencies) that share one header, footer, buttons, cards, rings, flags and pictures. Its scenes pin to the screen while the visitor scrolls: documents fly in, a scan turns Suggested into Confirmed, flags switch around a ring, a case line fills, sharing switches end in Access Ended, and a passport tilts into place at the close.

Owner decisions, 17 November 2026, as relayed in the PUB requirement:

> "Approved and within our branding colors, hand it to the Guardian. should start after finishing running sessions as per rules."

Decisions in force with it: do not break existing features, build over them; Home may run up to 12 screen-heights on computers for scroll scenes, phones stay at 6 with still pictures; today's button labels, invite-only wording and sign-in flow stay; ONE new depth style file for scroll scenes, on the flat-guard exception list, recorded here; the menu names /trust "Privacy and Trust".

Since 11 October 2026 the product is flat, enforced by `scripts/check-flat-design.mjs`. ADR 0027 allowed depth in two stylesheets: the landing (`landing-c1.css`) and the picture stylesheet (`pictures-depth.css`). Scroll scenes need a deep navy canvas with a brand glow, headline words in tints of the brand blue, and pictures that rest raised and tilt. Those are effects the flat rule forbids.

## Decision

### Scope

1. All depth for the public site's scenes lives in ONE stylesheet: `apps/web/src/components/public-site/public-scenes.css`. That exact path is the third and last entry of `EFFECTS_EXCEPTIONS`. Any other file, including `public-site.css` next to it, keeps the full flat rule.
2. Every selector in that stylesheet is scoped to `[data-pub-depth]`. Only the shared public components set that attribute: a dark chapter (`<Chapter tone="dark">`), headline words (`<HeadlineWords>`), the tilting passport (`<PassportTilt>`) and a raised story card (`<StoryCard raised>`). The browser flat check in `e2e/ux-public.spec.ts` skips exactly those elements and their contents (`.c1-hero, .c1-darkstage, [data-pub-depth]`).
3. Inline style effects in components stay forbidden everywhere.

### Colour

Brand tokens only, from `apps/web/src/app/globals.css`: the canvas is `--chapter-bg` and darker tints of it (mixed with black), glows are `--accent` mixed with the canvas or with transparent, headline words run from `--brand-tint-3` to `--brand-tint-5` on dark chapters and from `--accent` to `--accent-hover` on light ones, green only where it means done (`--success`, the Confirmed chip), warm only where it already meant a warning (the Example tag, the Suggested chip). The reference page's cyan, mint and bright blue are not used. No colour literal (hex, rgb, hsl) appears in either public stylesheet; a guard test reads both files and fails on one. A contrast test reads the tone and chip blocks and holds every text at 4.5:1 or more and every chip at 3:1 against both chapter canvases.

### Motion

- A dependency-free scroll engine (`scene-engine.ts`, at most 2 KB gzipped, measured at 1.1 KB) writes `--p` (0 to 1) and `data-step` on each `[data-scene]`. One passive scroll listener throttled to animation frames, one IntersectionObserver, a fresh measure on resize and on return from the back-forward cache.
- The server always renders each scene's finished step. The engine runs, and sets `html[data-scenes="live"]`, only when motion is welcome: not under `prefers-reduced-motion: reduce`, not with data saver, not below 760 px wide (phones keep still pictures). Without JavaScript, every scene is an ordinary section showing its finished state.
- Scenes are pinned (sticky stage, 1 to 4 screen heights) only while `html[data-scenes="live"]` is set; pinning lives in the flat `public-site.css` since it is layout, not decoration.
- In `public-scenes.css`, movement uses `transform` and `opacity` only, driven by `--p` (no timed transitions or keyframe animations), inside `@media (prefers-reduced-motion: no-preference)` and under `html[data-scenes="live"]:not([data-save-data])`. A guard test enforces each rule and is shown failing on a bad example.

### Still forbidden

- Automatic dark appearance (`prefers-color-scheme: dark`) in any public stylesheet, the exempt one too. The public site stays forced light; dark chapters are designed sections.
- Inline pictures (`data:` or `blob:`) and anything from another origin: the security policy keeps `img-src 'self'`; pages stay dynamic so the per-request nonce applies to the engine's script.

## Consequences

- Units PUB2 to PUB4 build scenes from shared parts with one look, and reviewers check one file for depth.
- The exempt stylesheet is guarded by its own test, so depth cannot leak onto the flat product.
- Scenes add page height only while they move; without motion the pages are as long as their content.

## Guards

- `scripts/check-flat-design.test.mjs`: the exception list is exactly the landing, picture and public scene stylesheets; look-alike paths fail.
- `apps/web/src/components/public-site/public-site-guards.test.ts`: contrast, no inline pictures, no em dash, no colour literal, WP-PUB1 block markers, the depth stylesheet's scope and motion rules.
- `apps/web/src/components/public-site/scene-engine.test.ts` and `public-site.test.tsx`: engine maths, clamping, clean stop, reduced motion, data saver, phone width, finished steps from the server.
- `scripts/programme/check-public-budget.mjs`: per-route first-load JavaScript at most 10 KB gzipped over the baseline from main, engine at most 2 KB gzipped, pictures at most 150 KB per page, nothing from another origin.

## Alternatives considered

- Put scene depth into `pictures-depth.css`: mixes two units' rules in one file and loosens ADR 0027's picture-only scope.
- A scroll animation library: heavier, a new dependency, and harder to keep within the Vercel CPU and weak-network limits.
- CSS scroll-driven animations only (`animation-timeline`): not yet in every browser the pilot serves; the engine can be swapped for it later without changing the markup contract.

## Rollback

Revert the PR that added this ADR. The exception list goes back to two entries, the header returns to its previous four links, and nothing else on main uses the public site parts yet.
