# ADR-0027: Visual depth for illustrations and hero cards

- **Status:** Accepted, 17 November 2026
- **Date:** 2026-11-17
- **Deciders:** Owner (picture-first upgrade decisions D1 to D10, 17 November 2026)
- **Unit:** WP-PIC0 (picture-first upgrade, Phase 1, presentation only)
- **Amends:** `docs/uiux/DESIGN-CONTRACT.md` and `docs/uiux/CONTRAST-AND-SURFACES.md`, in part, for one stylesheet only (section "Scope")

## Context

Since 11 October 2026 the product is flat: solid surfaces, edges by tone, no shadows, gradients, blur or translucent fills, enforced by `scripts/check-flat-design.mjs`. The only exception so far is the public landing stylesheet (`apps/web/src/app/landing-c1.css`, owner decision D1 of Programme X, 24 October 2026).

The picture-first upgrade adds real pictures to the product: a Bangladesh passport cover, a flag for every place with an ISO code, and illustrated hero cards. Pictures drawn flat on a flat page look pasted on. The owner chose to give them depth.

Owner decisions, 17 November 2026, exact words:

> "D1: 2, D2: 2, D3: we have web and pwa which eventually go to android/ios app, but for web and pwa i want all that u showed in two options, D4: 2. Also u must consider what we already realistically have, build/update on that."

> "use all that's possible via web & pwa(maximum of all that's possible in native) recommended answers for D5 to D10, hand the brief over. and dont break any existing feature, rather build the upgrade over them and what needed"

D2 option 2 is: visual depth (soft shadows, glow behind hero pictures) and gentle motion, for illustrations and hero cards only.

## Not the same "depth" as ADR 0023

ADR 0023 (Calm Core With Depths) uses "depth" for information levels: Glance, Browse and Everything, which decide how much of a screen is shown. That is a different idea. This ADR is about how pictures look (light and shadow), and changes nothing about levels, `data-depth`, `data-level` or the `vs_depth` cookie.

## Decision

### Scope

1. Only illustrations (everything under `apps/web/src/components/pictures/**`) and hero cards that hold one of those pictures may look raised.
2. All of their depth and motion styles live in ONE stylesheet: `apps/web/src/components/pictures/pictures-depth.css`. That exact path is the only new entry in the flat-design exception list (`EFFECTS_EXCEPTIONS` in `scripts/check-flat-design.mjs`). Any other file, including another stylesheet in the same folder, keeps the full flat rule.
3. Inline style effects in components (`style={{ boxShadow: ... }}`, gradients, blur) stay forbidden everywhere, pictures included. Depth is applied by class names that point into the picture stylesheet.
4. The flat rule is unchanged everywhere else: pages, cards, panels, forms, navigation, tables and dialogs stay solid and flat.

### Allowed inside the picture stylesheet

- Soft shadows under a picture or a hero card.
- A glow behind hero pictures. Gradients and blur are allowed for this, and only inside the picture stylesheet.
- Gentle motion that uses `transform` and `opacity` only (no animated layout, size, colour or shadow), so it stays smooth on low-end phones.
- At most ONE animated hero per screen.
- Motion uses the shared speeds (`--motion-press`, `--motion-state`, `--motion-arrive`, `--motion-ease`) plus ONE new slow speed, `--motion-slow: 600ms`, defined once in `globals.css` (block `WP-PIC0`). It may be used only inside `@media (prefers-reduced-motion: no-preference)`; a guard test enforces that.

### Motion is off when a person asks for less

- Under `prefers-reduced-motion: reduce` all motion is off. The existing global rule already turns every animation and transition off, and the slow speed is only ever used inside a `no-preference` block.
- When data saver is on, motion is off too. The picture layer sets `data-save-data` on the `html` element when the browser reports data saver (`navigator.connection.saveData`, or the `Save-Data` request hint), and the picture stylesheet gates every animation on `html:not([data-save-data])`. Pictures still show, standing still.

### Still forbidden

- Automatic dark appearance (`@media (prefers-color-scheme: dark)`) stays forbidden everywhere, in the exempt stylesheets too. The guard fails on it in both.
- No change to the security policy, Permissions-Policy, schema, backend, providers or permissions. This is presentation only.

## Consequences

- Pictures and hero cards can look like objects resting on the page, which makes the passport cover, flags and hero illustrations read as real.
- The rest of the product stays calm and flat; reviewers check one file for depth instead of the whole stylesheet.
- One more file to watch in reviews: anything added to `pictures-depth.css` must still respect the motion and dark-appearance rules above.

## Guards

- `scripts/check-flat-design.mjs` and `scripts/check-flat-design.test.mjs`: the exception list holds exactly two paths; shadows, glow and blur pass only in those paths; lookalike paths, other picture stylesheets and `globals.css` still fail; dark appearance fails in both exempt files; inline effects in picture components still fail.
- `apps/web/src/lib/a11y-guards.test.ts`: `--motion-slow` is defined exactly once (at most 700ms), and every use of it sits inside `@media (prefers-reduced-motion: no-preference)`.

## Alternatives considered

- Keep everything flat (D2 option 1): pictures would look pasted on; the owner chose depth.
- Allow depth anywhere: would undo the calm, flat product the owner approved on 11 October 2026.
- Put picture styles in `globals.css`: mixes exempt and non-exempt rules in one file, so the guard could not tell them apart.

## Rollback

Revert the PR that added this ADR. The exception list goes back to the landing stylesheet alone, the `--motion-slow` token goes away, and any picture stylesheet that relies on effects then fails the flat-design guard until it is made flat.
