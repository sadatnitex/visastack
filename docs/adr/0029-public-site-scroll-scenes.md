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
2. In that stylesheet the last part of every selector carries `[data-pub-depth]` itself (never inside `:not()`), so depth sits only on the marked element. Only the shared public components set that attribute: a dark chapter (`<Chapter tone="dark">`, for its canvas), headline words (`<HeadlineWords>`), the glow (`<DepthGlow>`), the tilting passport (`<PassportTilt>`) and a raised story card (`<StoryCard raised>`). The browser flat check in `e2e/ux-public.spec.ts` skips only an element that carries the attribute itself, not its contents: a shadowed chip inside a dark chapter still fails.
3. Inline style effects in components stay forbidden everywhere.

### Colour

Brand tokens only, from `apps/web/src/app/globals.css`: the canvas is `--chapter-bg` and darker tints of it (mixed with black), glows are `--accent` mixed with the canvas or with transparent, headline words run from `--brand-tint-3` to `--brand-tint-5` on dark chapters and from `--accent` to `--accent-hover` on light ones, green only where it means done (`--success`, the Confirmed chip), warm only where it already meant a warning (the Example tag, the Suggested chip). The reference page's cyan, mint and bright blue are not used. No colour literal (hex, rgb, hsl) appears in either public stylesheet; a guard test reads both files and fails on one. A contrast test reads the tone and chip blocks and holds every text at 4.5:1 or more and every chip at 3:1 against both chapter canvases.

### Motion

- A dependency-free scroll engine (`scene-engine.ts`, at most 2 KB gzipped, measured at about 1.5 KB) writes `--p` (0 to 1) and `data-step` on each `[data-scene]`. One passive scroll listener throttled to animation frames, one IntersectionObserver, a fresh measure on resize and on return from the back-forward cache.
- The server always renders each scene's finished step. The engine runs, and sets `html[data-scenes="live"]`, only when motion is welcome: not under `prefers-reduced-motion: reduce`, not with data saver, not below 760 px wide (phones keep still pictures), not below 600 px high (a pinned stage is one screen high, so a short or zoomed screen would cut its words off). Without JavaScript, every scene is an ordinary section showing its finished state.
- Scenes are pinned (sticky stage just below the sticky header, 1 to 4 screen heights) only while `html[data-scenes="live"]` is set; pinning lives in the flat `public-site.css` since it is layout, not decoration. A tiny same-site file (`public/scenes-boot.js`), loaded synchronously in the head with the request's nonce, sets that mark in the page head before the first paint with the same tests as the runtime, so scenes have their length from the start and nothing jumps when the page comes to life; without JavaScript it never runs. The engine reads every box before it writes and writes a step only when it changes.
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

## Amendment, 18 November 2026: motion for every screen and every visitor (owner decisions)

Four owner messages of 18 November 2026, in order, in the owner's exact words. The last one decides.

1. The owner asked "why doesn't the animation work on mobile view and sometimes desktop view?" and then chose, verbatim, "Phone motion (Recommended)", the option described as: "Phones get light motion built for small screens: pictures animate as they scroll into view and the share/readiness pictures play their short loops, with a Pause button. No pinned scroll scenes, page stays within 6 screens. Still off for people who ask their device for less motion or save data."
2. "motion/animation should be always activr for all device and states" (typed as sent).
3. "yes, carry on, full motion and comfirmed(3)" (answer to whether people whose device asks for reduced motion get full motion; replaced by message 4 before any build).
4. **Deciding:** "what's best for user experience ,if that's gentle fading, do that".

Together they supersede, for motion only, the line in Context above "phones stay at 6 with still pictures" and the Motion rule "not under `prefers-reduced-motion: reduce`, not with data saver, not below 760 px wide (phones keep still pictures), not below 600 px high". Superseded, replaced by this amendment (18 Nov 2026). The 6-screen phone page budget is unchanged. The older text above stays as history.

Why it looked broken: the engine, the early mark and the runtime all ran scenes only on screens that match `SCENE_SCREEN_QUERY` (at least 760 px wide and 600 px high), so phones never moved, and a computer window under 600 px high (or zoomed in) showed still pictures.

### Three motion modes from one rule

`sceneMode()` in `scene-engine.ts` is the one rule. The runtime uses it and the early mark (`public/scenes-boot.js`) mirrors it; a test keeps the two in step.

| Mode | Who | What happens |
|---|---|---|
| gentle | everyone whose device asks for less motion, any screen | The same steps play once as a scene comes into view, as crossfades of opacity and colour and a rise of 8 px or less: no pinning, no parallax, no scaling, no sliding over distance, no sweep, at most 0.4 s a step. `html[data-scenes="gentle"]` |
| pinned | a screen that matches `SCENE_SCREEN_QUERY` (and motion is not reduced) | Today's scroll scenes, unchanged: `html[data-scenes="live"]`, stage pinned, progress follows the scroll |
| reveal | every other screen: phones, short or zoomed windows | `html[data-scenes="reveal"]`, nothing pinned, nothing stretched, no page height added; each scene plays its steps once as it comes into view |

`html[data-scene-mode]` names the mode (`pinned`, `reveal` or `gentle`). Only the pinned mode sets `data-scenes="live"`, so every rule keyed on it (the pinning in `public-site.css`, the Home spacing, the disclosure tiles on How It Works) stays pinned-only and cannot leak onto a phone or into gentle mode (Guardian decision 18 Nov 2026).

Data saver never stops motion: it is CSS and transforms, with no extra download. No script, style or test now keys the mode on it. Without JavaScript no motion can run and every scene shows its finished step.

### Accessibility trade-off (read this before changing the gentle mode)

Before this amendment, `prefers-reduced-motion: reduce` meant stills. It now means gentle fading, by owner decision (message 4). That keeps the protection that matters for motion sickness (nothing pins, slides, scales, tilts or sweeps; no movement over 8 px; no step lasts over 0.4 s; nothing changes more than three times a second, WCAG 2.3.1) while every visitor still sees the pictures play. The global rule in `globals.css` that switches every transition and animation off under reduced motion is not edited. The gentle rules in `kit/kit.css` override it with `!important`, only under `html[data-scenes="gentle"]` (which exists only for people who asked for less motion), only for opacity and colour fades of at most 0.4 s plus the 8 px rise; a guard test parses `kit.css` and fails on any other override. The depth stylesheet `public-scenes.css` is not touched by gentle mode.

### Reveal and gentle rules

- A scene far from the screen keeps the server's finished step. Within a screen of coming into view it is set to its first step (one observer); when a quarter of it shows, or 40 percent of the screen height shows of a tall scene (a second observer, 5 percent steps), it plays once to its finished step and rests there (`scene-reveal.ts`).
- No scroll listener. Timers run only while a scene is playing on a visible tab; a scene that became visible while the tab was hidden plays when the tab shows. Leaving the screen mid-play snaps the scene to its finished step, so nothing is left half drawn.
- A step rests at least 0.34 s, so a scene (12 steps at most) never changes more than three times a second, and the whole play of a scene never takes more than about 4 seconds, so no Pause button is needed for it (WCAG 2.2.2). Any loop longer than 5 seconds carries a visible, keyboard-operable Pause button: the timed sharing picture (`kit/share-sheet-timed.tsx`) now runs for every visitor, only while on screen and with the tab showing. The button keeps its space in the server markup (no layout shift) and takes none without JavaScript.
- Reveal moves with `transform` and `opacity` only (the eased `--p` is a registered number that feeds transforms; gentle never writes it). Which alternative words show follows the scene's finished step (`data-rest`, written by `<Scene>`), never the playing step, because showing and hiding words changes layout; a tab label keeps its width the same way. Playing therefore adds no layout shift (measured CLS 0.0000 on Home at 390 px).
- Resizing or rotating across a line, or turning reduced motion on or off, switches mode without a reload: the engine stops, restores every scene's finished step and starts the other mode, and never replays a scene.
- The depth stylesheet `public-scenes.css` keeps its motion only under `html[data-scenes="live"]` and `prefers-reduced-motion: no-preference`; the `:not([data-save-data])` condition on the passport tilt is dropped. The reveal and gentle rules live in the flat kit stylesheet (`kit/kit.css`, `kit/kit-steps.css`).

### Not changed

The picture stylesheet (`pictures-depth.css`, ADR 0027) and the Save-Data flag the root layout sets still keep picture motion still with data saver; that is outside this unit and on the follow-up list. The /trust share picture (R3) is not touched here.

### Guards added

`scene-reveal.test.ts` (reveal and gentle engine, three-changes-a-second limit), `scene-engine.test.ts` (mode rule, early mark in every mode, data saver changes nothing), `public-site.test.tsx` (runtime modes and switching), `public-site-guards.test.ts` (depth motion stays under pinned mode), `kit/kit.test.tsx` (Pause button, on-screen and hidden-tab gating, reveal styles, gentle overrides scoped, 0.4 s, opacity and colour only), `e2e/public-site/mot1-phone-motion.spec.ts` (390 px and 1280 px Home, layout shift under 0.05, 6-screen budget, short window, gentle, data saver, mode switch).

### Rollback

Revert the MOT1 PR: `scene-reveal.ts` goes away, the early mark and runtime return to pinned-or-still (reduced motion and data saver back to stills), phones show still pictures again, and the passport tilt condition returns. Nothing else depends on the new attributes.
