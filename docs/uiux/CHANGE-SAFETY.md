# Changing the interface safely

Full record of the experience upgrade, the decisions waiting on the owner and the next steps: [EXPERIENCE-UPGRADE-HANDOFF.md](EXPERIENCE-UPGRADE-HANDOFF.md).

For anyone changing how VisaStack looks or reads, whether a person, Claude or Codex. The owner works with more than one tool in turn, so this page is the shared set of rules. It changes nothing about how the product behaves.

## Rules

1. Presentation only. Do not change routes, server actions, permissions, consent, stored values, readiness rules or case states in an interface change. Show a plain label for a stored value, never change the value.
2. Preview first. For each screen or behaviour, the owner sees a visual and a description of the behaviour and says yes before it is built.
3. One screen family per change. List the files allowed to change, and end the pull request with a "what I did not touch" note covering routes, actions, permissions and consent.
4. Prove it before and after. Capture the affected screens before the first edit, again after, and read each pair that changed.
5. Counters only go down. Inline style props and raw codes shown as page text must not rise (see below).
6. Nothing merges or deploys without the owner's word.

## The safety net

| Tool | What it protects | Command |
| --- | --- | --- |
| UI ratchet | Inline style props, raw database codes shown as page text, and visible long dashes may not rise in any file | `pnpm run scan:ui-ratchet` (also part of `pnpm run lint`) |
| Flat design check | No shadows, gradients, blur, translucent surfaces or automatic dark mode | `pnpm run scan:flat-ui` |
| Route and link check | Every page is reachable and no link points nowhere | `node scripts/check-route-navigation.mjs` |
| Plain language test | No engineering words on public pages | `apps/web/src/lib/plain-language.test.ts` |
| Page tests | Every page that already has a test keeps its text and structure | `cd apps/web && ./node_modules/.bin/vitest run` |
| Screen capture | Screenshots of every page the tests render, desktop and phone | below |

### Before and after screenshots

The capture reuses the pages the web tests already render, so it needs no sign-in and touches no live service. The data is the made-up data inside the tests.

```
UI_BASELINE_DIR=/tmp/ui/before-html ./apps/web/node_modules/.bin/vitest run   # run from apps/web
node scripts/ui-baseline/capture.mjs /tmp/ui/before-html /tmp/ui/before

# make the change, then repeat into /tmp/ui/after-html and /tmp/ui/after
node scripts/ui-baseline/compare.mjs /tmp/ui/before /tmp/ui/after
```

`compare` lists screens that changed, appeared or vanished, with how many pixels differ. A rare wobble of a few pixels counts as the same (set `UI_BASELINE_TOLERANCE` to tune it). A change on a screen the work was meant to touch is expected; a change anywhere else is a defect. Compare only captures made on the same machine: text uses the system font and the pictures are not a match for the live site.

### Lowering a counter

After a change removes inline styles or raw codes, run `node scripts/ui-ratchet.mjs --lower` and commit the updated `scripts/ui-ratchet.baseline.json`. Raising a number needs a hand edit to that file and a reason in the pull request.

### Showing a stored code to a person

Use a label from `apps/web/src/lib/labels.ts` (`membershipRoleLabel(role)`, `documentTypeLabel(type)` and so on). A stand-alone label has every word capitalised; inside a sentence, lower-case it. Where staff truly need the exact code (the audit log), show it with `ExactCode` next to the plain label. A new stored value without a label fails the type check and `labels.test.ts`.

## What is not covered yet

Pages without a test of their own (the traveller overview, the case page, expiry, history, evidence, cases list, help, privacy page and others) are not in the capture until each gets a characterization test, written in the same change set as its first redesign and before any edit to that page. Signed-in screens on a real sign-in are checked separately on the isolated staging project.
