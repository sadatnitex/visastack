# MOT1 records: motion on every screen and for every visitor

Branch `claude/mot1-phone-motion`. Contract: ADR 0029, section "Amendment, 18 November 2026: motion for every screen and every visitor". The owner's four messages of 18 November 2026 are quoted there in the owner's exact words; the last one decides ("what's best for user experience ,if that's gentle fading, do that").

## 1. What changed

| Visitor | Before | Now |
|---|---|---|
| A phone, or a computer window under 600 px high or zoomed in | Still pictures | "reveal": each scene plays its steps once as it comes into view, nothing pinned, no page height added |
| A big screen with motion welcome | Pinned scroll scenes | Unchanged ("pinned") |
| Anyone whose device asks for less motion, any screen | Still pictures | "gentle": the same steps as fades of opacity and colour plus a rise of 8 px or less; no pinning, parallax, scaling, sliding or sweeping; at most 0.4 s a step |
| Anyone with data saver on | Still pictures | Same mode as without it (data saver never stops motion) |
| No JavaScript | Finished pictures | Unchanged: finished pictures (nothing can animate without script) |

Why it looked broken (verified on main 8a34717): the engine, the early mark and the runtime all ran scenes only on a screen at least 760 px wide and 600 px high, so phones never moved and a short or zoomed window showed stills.

## 2. How it works

- One rule, `sceneMode()` in `scene-engine.ts`: gentle if the device asks for less motion, else pinned where `SCENE_SCREEN_QUERY` matches, else reveal. `public/scenes-boot.js` mirrors it before the first paint; a test keeps the two in step.
- `html[data-scene-mode]` is `pinned`, `reveal` or `gentle`. `html[data-scenes]` is `live` (pinned only, so the pinning in `public-site.css`, the Home spacing and the How It Works tiles stay pinned-only), `reveal` or `gentle`. Guardian decision 18 Nov 2026 (no edit to `public-site.css`, `home-story.css` or `flip-tile.tsx`).
- `scene-reveal.ts` (new): two IntersectionObservers, no scroll listener. A scene within a screen of coming into view is set to its first step; when a quarter of it (or 40 percent of the screen height of a tall scene) shows, it plays once to its finished step and rests. Leaving mid-play snaps it finished (`data-reveal="snapped"`). A hidden tab pauses it. Steps rest at least 0.34 s (never more than three changes a second) and a whole play takes about 4 s at most, so no Pause button is needed for it. Gentle writes no `--p`, so nothing slides or scales.
- Which alternative words show follows the scene's finished step (`data-rest`, written by `<Scene>`), never the playing step: showing and hiding words changes layout, and an earlier build of reveal mode produced a layout shift of 0.075 on Home at 390 px because of it. Now measured 0.0000.
- Gentle overrides the global reduced-motion rule (`globals.css`, not edited) only in `kit/kit.css`, under `html[data-scenes="gentle"]`, with `!important`, for opacity and colour fades of at most 0.4 s and the 8 px rise. A guard test parses the stylesheet and fails on any other override (shown red on a bad example, and once on the real stylesheet by changing 0.4 s to 0.7 s).
- Loops over 5 s: the kit's timed share sheet and the /trust hero share picture now run for every visitor, only while on screen and with the tab showing (one shared hook, `kit/use-on-screen.ts`), with a visible keyboard-operable Pause button. Both Pause buttons keep their space in the server markup, idle and invisible (no shift, with or without the early mark; without script it is an empty gap). The /trust hero keeps one picture element across steps so its parts really fade in gentle mode (a key per step had swapped the whole picture). The kit scan sweep runs twice, never endlessly; a guard forbids `infinite` in the kit styles.
- Mode switches (resize, rotation, turning reduced motion on or off) need no reload: the engine stops, puts back every scene's finished step and starts the other mode. A scene already on screen or passed rests finished and is not replayed; scenes still below wait and play when they arrive.

## 3. Measured

| Check | Result |
|---|---|
| Layout shift on Home at 390 px (Playwright, scrolling the whole page with scenes playing) | 0.0000 (limit 0.05) |
| Home page height at 390 px | within 6 screens (spec and the scroll-budget specs pass) |
| Public JavaScript, gzipped, main b3cba3f vs this branch | Home 137,988 B to 138,874 B (+0.9 KB); How It Works 138,321 to 139,334 (+1.0 KB); Trust 126,353 to 126,497 (+0.1 KB); Countries 139,768 to 139,769; For Agencies 136,507 to 136,510; Privacy and Terms 123,420 to 123,406; Status 126,442 to 126,427. `check-public-budget.mjs` passes (route growth limit 10 KB) |
| Scroll engine file (`scene-engine.ts`, limit 2,048 B gzipped) | 1,615 B to 1,816 B. The reveal engine lives apart in `scene-reveal.ts` (about 1.5 KB gzipped, counted by the per-route budget, not by the engine-file check) |
| Local checks | typecheck, lint (biome, flat design, navigation, ui ratchet 286/0/0/189 unchanged), full web vitest 9,914 pass (892 files), `node --test scripts/*.test.mjs` 83 pass, em dash sweep 0 |
| Playwright on one fresh build (public-site, ux-public, browser-security, no-secret-auth, scroll-budget, type-scale) | 812 pass; the only reds are the two known local WP-SB2 case-page checks (page 3,480 against 3,470 at a phone; CI passes them) |
| Pinned forced at a phone width (temporary break, not committed) | `pins nothing below 900 px` in `pub2-home.spec.ts` goes red ("mode at 360", expected "reveal", received "live"), green again without the break |

Frame strips at 390 px (five frames per strip, 0.1 s to 3.5 s after a scene arrives): `docs/upgrades/programme/pub/mot1-shots/`. `home-hero`, `home-add`, `home-ready`, `home-journey`, `home-share` (reveal), `how-top`, `how-mid` (How It Works has no scenes: its rises play), `gentle-home-share` (reduced motion: switches fade, nothing slides).

## 3b. Accessibility review (motion, Pause, reduced motion)

Done as a manual checklist by the builder (the design review skill was not available in this session) plus the existing axe checks in `ux-public.spec.ts`, which pass.

| Need | How it is met |
|---|---|
| WCAG 2.2.2 Pause, Stop, Hide (motion over 5 s that starts by itself) | The two loops (kit timed share sheet, /trust hero) have a real `<button>`, visible, at least 44 px, keyboard operable, named "Pause the Animation" or "Play the Animation". A scene play lasts about 4 s plus a 0.4 to 0.9 s ease, so it needs no Pause |
| WCAG 2.3.1 Three flashes | A step rests at least 0.34 s, a scene has at most 12 steps, the loops step every 2.2 s; unit tests and two Playwright checks measure changes per second. Checked, ruling by the Guardian: the rule is about large brightness flashes; two neighbouring scenes stepping 0.34 s apart are crossfades, so no page-wide shared clock is needed |
| Vestibular safety (`prefers-reduced-motion`) | Gentle mode: no pinning, parallax, scaling, tilt, sweep or slide over distance, nothing moves more than 8 px, 0.4 s at most per step; the stylesheet guard fails on anything else, including step-driven scales and moves over 8 px in the base styles (the switch knob and the current-stage dot are replaced by fades) |
| WCAG 1.4.3 contrast while moving | Words never fade (rises only move); picture parts fade for 0.4 s at most |
| WCAG 1.4.10 reflow, 2.5.8 target size | Nothing is pinned on phones or short windows, so no stage can cut words off; the Pause button is 44 px |
| Screen readers | Motion changes no text and no reading order (which words exist is fixed by the finished step); the hidden idle Pause button is `aria-hidden` and out of the tab order |
| Not verified | A real screen reader and a real phone with reduced motion on |

## 4. Tests changed outside the manifest, each approved by the Guardian (18 Nov 2026)

`pub1-foundation.spec.ts`, `pub3-how-trust.spec.ts` (decision 1), `public-scenes.css` passport tilt and `public-site-guards.test.ts` (drops the data-saver condition only), `pub2-home.spec.ts` (pins-nothing test now asserts `data-rest`, sticky and fixed, mode, no runway; reduced-motion test), `pub4-countries-agencies.spec.ts`, `r1-reference-fidelity.spec.ts` (waits on the finished step, never a fixed time), `ux-public.spec.ts` (one test: waits for in-view scenes and rises to rest before each screenshot; the pixel comparison is untouched), `e2e/public-site/r3-reference-fidelity.spec.ts` (one test: reduced motion plays gently, Pause at least 44 px, Pause stops on the finished step, Play resumes, at most three changes a second), `app/trust/share-hero.tsx` and `app/trust/r3-story.test.tsx` (new tests: reduced motion plays and shows Pause, off-screen stops, hidden tab stops, at most three changes a second; the three that can fail on the old share hero were shown red on it).

## 5. Not changed, not verified

- Not changed: the picture stylesheet (`pictures-depth.css`, ADR 0027) and the Save-Data flag the root layout sets still keep picture motion still with data saver. Follow-up list.
- Known limit: a scene already on screen when the page loads was painted finished by the server, so right after the page comes to life it goes back to its first step and plays (no layout change). A server-side first step would remove it but would hide content without script.
- Not verified: a real phone and a real screen reader (Chromium emulation only); Safari and Firefox support for the registered `--p` number (without it the progress simply steps instead of easing); the live site (no deploy yet).
- Moving between pages without a reload: a page with no scenes still gets the mode marks while its runtime is mounted; `/trust` (R3) no longer mounts the scenes runtime, so after a client-side visit from a scene page its rises start un-lowered (visible, just not animated) until a full load. Same behaviour as before this unit on big screens.
- Generated CSS: `kit/kit-steps.css` gains a generated block (steps 0 to 11 only, like the block above it) and `kit/kit.css` 12 tab rules; both are kept in step by `kit/kit.test.tsx`. Inline custom properties would shrink them but the security policy forbids inline styles.
- The scroll engine budget check measures `scene-engine.ts` only; `scene-reveal.ts` is covered by the per-route growth limit.
