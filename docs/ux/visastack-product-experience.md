# VisaStack product experience — design system and information architecture

Written for PR 7 (master directive: `commercial-recovery-completion-ux-directive.md`
§7 "PR 7 — UX/UI foundation and information architecture"). This is the
canonical description of the product's navigation structure, visual system,
and UX patterns as they exist in the codebase today — not an aspirational
spec. Where something described here isn't fully built yet, it's named
explicitly in §7 rather than left implicit.

## 1. Experience principles

VisaStack must feel: trustworthy, calm, precise, private, modern, human,
competent, easy for non-technical travellers, efficient for agency
professionals.

It must not feel: like a developer dashboard, like a generic admin template,
like a crypto product, like an experimental AI demo, overloaded with cards,
full of internal IDs, overwhelming on first use, artificially colourful,
dependent on technical jargon.

In practice this means: real display names everywhere a raw ID would
otherwise show, one clear next action instead of a wall of equally-weighted
options, restrained neutral surfaces with a single accent color, and status
language that describes what's actually true (a document's real pipeline
stage, a mission's actual completeness) rather than something invented to
look reassuring.

## 2. Global navigation

Four separate navigation contexts, matching four separate audiences. None of
them nest inside each other — a user with agency or platform-admin access
switches into those areas explicitly rather than having every nav item
crowded into one bar.

**Applicant navigation** (persistent header on every signed-in page —
`apps/web/src/app/app/layout.tsx`, `app-nav.tsx`; the names are in
`apps/web/src/lib/navigation.ts`): Overview, Applicants, Shared with me, Alerts,
Privacy, Account. Agency Desk and Platform administration appear as
a secondary switch control in the same header, shown only to accounts that
actually hold that access (`listMembershipsForAccount`, `isPlatformAdmin`).

**Applicant workspace navigation** (`apps/web/src/app/app/applicant/[id]/layout.tsx`,
`subnav.tsx`): Overview, Profile, Documents, Cases, Sharing, Evidence, Expiry,
History. The product calls what a traveller opens a "case"; "mission" is the
stored entity's name and stays in code, URLs and the database (a test fails if
it appears in visible text). "Evidence" and "Expiry" aren't in the directive's
own list but are real, shipped functionality (responding to an agency's evidence
requests; document expiry) - kept as tabs rather than deleted or hidden to match
the list exactly.

**Agency navigation**: currently one list page (`/app/agency`) plus one
per-organization console (`/app/agency/[orgId]`) rather than the full six-item
structure (Case inbox, Assigned cases, Evidence requests, Reviews,
Organization, Access) as separate routes. See §7 for what's covered instead.

**Platform administration**: one page (`/app/admin`) with anchored jump-nav
sections — Readiness (links to the existing `/status` page), Security,
Organizations, Retention, Deletion, Processing failures, Usage, Audit —
rather than eight separate routes. See §7.

No page renders a raw UUID as its primary label; every list and detail view
resolves to a real display name (applicant name, organization name, mission
title) before it reaches JSX.

## 3. Visual system

Single stylesheet: `apps/web/src/app/globals.css`. Apple HIG-inspired:
clarity (legible type, clear hierarchy), deference (content-first,
translucent chrome), depth (subtle layering). System font stack only — no web
fonts, CSP-safe.

**Color** — light/dark pairs via `:root` + `prefers-color-scheme`:
`--bg`/`--bg-elevated`/`--bg-subtle`, `--text`/`--text-secondary`/`--text-tertiary`,
`--accent`/`--accent-hover`/`--accent-strong` (a deliberately distinct, darker
token for solid-fill contexts — white text on `--accent` alone fails WCAG AA
contrast in dark mode), `--hairline`/`--hairline-soft`,
`--success`/`--warning`/`--danger` with matching `-bg` tints. Contrast values
were verified and corrected in PR #53 (`docs/audits/current-product-baseline.md`).

**Spacing** — an 8px-rhythm scale, `--space-1` (4px) through `--space-8`
(64px), added in PR 7. Existing `clamp()`-based fluid spacing on hero/section
padding is left as-is; the scale is for new layout work going forward, not a
retrofit of every existing inline style.

**Shape & depth** — `--radius-sm`/`--radius`/`--radius-lg`/`--radius-pill`;
`--shadow-card`/`--shadow-raise` for the two elevation levels the product
uses (resting card, hover/raised card).

**States** — global `:focus-visible` outline; `prefers-reduced-motion`
disables all animation/transition/smooth-scroll; `.input[aria-invalid="true"]`
renders a danger-colored border and focus ring (added in PR 7 — see §7 for
which forms wire it up); `.skip-link` jumps keyboard users past the nav to
`#main`.

**Print** — `@media print` (added in PR 7) drops all navigation, buttons, and
chrome, flattens to black-on-white, and prevents cards from breaking across a
page edge — for mission/pack layouts a user prints or exports to PDF via the
browser.

**Dark mode** — driven by `prefers-color-scheme` (system-level), not a
user-facing toggle. Every token has a dark-mode pair, but there has not been
a dedicated component-by-component dark-mode verification pass beyond the
PR #53 contrast fixes — see §7.

## 4. Status language

Every status shown to a user reflects a real, persisted state — never an
invented "in progress" animation with no backing state machine.

- **Document safety**: Pending → Scanning → Clean / Quarantined
  (`safetyStatus`, enforced at the serving boundary — PR 3).
- **Document processing**: the full pipeline state machine
  (`packages/core/src/domain.ts`) — Uploading, In quarantine, Scanning,
  Structural validation, Processing, Needs review, Ready, Needs attention,
  Failed, Rejected — is now surfaced directly on each document card
  (`apps/web/src/app/app/applicant/[id]/documents/page.tsx`, PR 7). Before PR
  7 this state machine existed in the database but was never read by the UI;
  only the coarser safety badge was shown.
- **Mission readiness**: requirement-completeness only, explicitly never an
  approval-likelihood signal (`mission/[id]/page.tsx`'s own comment says this
  outright; carried through in `mission.readiness.*` message keys).
- **Grant status**: Pending acceptance / Awaiting your acceptance / Active /
  Paused / Revoked / Expired (`lib/grant-status.ts`).
- **Evidence request status**: Open / Fulfilled / Declined.

## 5. Key surfaces

**Home** (`apps/web/src/app/app/page.tsx`) answers: what needs my attention,
what's the one next useful action, what's my status at a glance. Attention
items are aggregated across every applicant (pending AI proposals, open
evidence requests, pending sharing invitations) rather than requiring a visit
to each applicant individually. No engineering/operational data is shown here
— that's platform-admin-only.

**Applicant Overview** (`applicant/[id]/page.tsx`) synthesizes what
previously required visiting five separate pages: Master Profile
completeness (core universal fields, filled vs. total — a bounded, honest
metric, not a claim about the whole 58-field registry), document health,
active missions, outstanding evidence requests, current active-grant count,
and one computed next action.

**Master Profile** (`profile-editor.tsx`) has progressive disclosure
(universal fields always visible; target-group packs behind `<details>`),
now with a live search box that filters fields by label and auto-expands any
pack containing a match, and a section jump-nav. Existing: repeating-record
cards, sensitivity/status/conflict badges, and (added in PR 7) a "last
confirmed" date per field, read from the fact's `updatedAt`.

**Document experience**: real per-document processing state (§4), upload
flow, and AI-proposal review (existing/proposed value, evidence snippet,
confidence, approve/edit/reject) — confidence is never presented as a
guarantee.

**Sharing**: pre-grant form (`sharing/grant-form.tsx`) now renders a live,
human-readable summary as the form is filled in — who, what they can do, why,
scope, expiry, whether downloading is allowed, and that they must accept
before anything is visible (PR 7). Post-grant list shows accepted-date
alongside the existing status/purpose/permissions/expiry, and states plainly
that pausing or revoking cannot remotely erase copies already downloaded.

**Agency Desk** (`agency/[orgId]/page.tsx`) gained a "Case inbox" card (PR 7):
every reachable mission as one row (applicant · mission · assignment ·
open-request count), sorted so unassigned or actively-blocked cases float to
the top. This is a bounded improvement, not the full six-view IA — see §7.

**Errors**: `error.tsx` now states plainly that nothing entered on the page
was lost. `not-found.tsx` and `global-error.tsx` unchanged from PR #53 (both
were already reasonable — see that PR's audit). None of the three ever
surface a raw stack trace or database error; only a correlatable digest.

## 6. Accessibility

Present: global focus-visible outline, skip link, `prefers-reduced-motion`
support, dynamic `<html lang>` (cookie-driven, not hardcoded), `role="alert"`
on inline error notices, real heading structure (workspace layouts own the
page's one `<h1>`; nested section pages use `<h2>`, fixed in PR 7 to remove
the duplicate-`<h1>` pattern the old single-page applicant view had), form
labels (swept in PR #53), an `aria-live="polite"` region on the document
processing-state badge so a status change is announced without a full page
reload, and `[aria-invalid]` styling wired into the shared `.input` class.

Automated coverage: `@axe-core/playwright` runs against public pages
(`e2e/ux-public.spec.ts`) in ordinary CI, and against the authenticated
dashboard in the WorkOS-staging-gated suite
(`e2e/authenticated-workspace.spec.ts`) — both fail the build on any
`critical`/`serious` violation.

## 7. What this PR does not cover (named, not hidden)

- **Agency Desk** is a bounded improvement (a Case-inbox summary card), not
  the full six-destination IA (Case inbox / Assigned cases / Evidence
  requests / Reviews / Organization / Access as separate routes) the
  directive describes. A full rebuild is materially larger than the rest of
  this PR combined and is better scoped as its own follow-up.
- **Platform administration** uses anchored jump-nav on one page rather than
  eight separate routes, to avoid restructuring an already-working,
  recently-verified admin console. "Readiness" links out to the existing
  `/status` page rather than duplicating that data here.
- **Document review** is not yet a two-pane desktop layout with an embedded
  live document preview next to AI proposals — preview still opens via a
  signed URL rather than rendering inline. Embedding it (`<iframe>` against
  signed blob URLs) needs verification against the real storage/CSP
  configuration that this environment cannot exercise; attempting it without
  that verification risked shipping a silently broken preview pane.
- **Bilingual (EN/BN) coverage** is real but partial. PR #53 covered consent
  and mission-readiness; PR 7 added document-processing states and applicant
  relationship labels. Several critical paths named in the directive —
  upload, AI review, evidence requests, agency/admin surfaces — are still
  English-only, falling back correctly (never a raw missing-key string, per
  `packages/i18n`'s English-fallback design) but not yet translated. Every
  Bangla string added is genuine translation, not machine transliteration,
  but has not been reviewed by a native speaker.
- **Dark mode** has token coverage everywhere but has not had a fresh,
  dedicated component-by-component verification pass beyond PR #53's
  contrast fixes.
- **Unsaved-change protection** (directive's Master Profile requirement)
  doesn't apply as a separate feature: every field is its own auto-submitting
  form (save-per-field, not a draft-then-submit-whole-form model), so there
  is no cross-field "unsaved changes" state to protect against losing.
- **`aria-invalid`** is styled at the CSS level and used where PR 7 touched a
  form, but has not been swept across every existing form in the app —
  that's a mechanical pass across ~15 components, not attempted here to keep
  this PR's diff reviewable.
- The authenticated-journey Playwright tests (dashboard a11y scan, unicode
  name handling, cross-tenant 404) are implemented but — like the rest of
  `authenticated-workspace.spec.ts` since PR #40 — not yet run against real
  WorkOS staging credentials in this environment. They run automatically in
  CI once the `workos-staging-e2e.yml` workflow's secrets are configured.
