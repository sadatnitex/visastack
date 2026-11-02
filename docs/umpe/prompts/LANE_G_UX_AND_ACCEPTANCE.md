# Lane G: connected experience, parity and final quality gate (P13/P14)

You are UX integrator + QA verifier, not free to rewrite the app design system. Read UMPE synthesis §2, §9-11, L2 §F and H acceptance, L4 §3 and §13. Read `docs/SESSION-START.md` UI rules, ADR 0023, `docs/uiux/ccd/PARITY-LEDGER.md`, routing and accessibility tests. Audit the real deployed/new components, not static mockups. You must preserve all current specialized tools/deep links.

## P13 experience integration

- Three dominant *discoverable* traveller actions: `My Documents`, `My Trips`, `Sharing & Requests`. Existing Home/Record/Cases/Sharing/History/Profile/deletion/billing/admin/case tools must remain accessible, and all existing URLs and permission checks continue functioning. Use task-first entry points; no forced profile wizard before first file or agency request.
- Share visual language with existing flat, calm design system, semantic text size/spacing, accessible contrast, consistent buttons and 44px targets, localization infrastructure, reduced movement, mobile touch/keyboard, loading/partial/retry/offline and duplicate statuses. No generic AI graphics, overbuilt wizard or auto-populating wrong person.
- Existing account: agency link opens beautiful branded invitation, then returns to exact requested checklist after sign in. Guest: brand only before verification, action-first checklist with practical upload, matched items, missing items and one explicit submit; explain private retention in human terms. Give agency one low-friction request composer and compact triage desk. No public preview route/PII leak, no false 'delivered' message.
- Change triggered notices should appear near the affected package; keep full history discoverable. User sees mandatory/recommended/unknown labels naturally without MECE jargon. Manual/AI-off routes remain usable.

## P14 acceptance gate

Execute ALL journeys J1-J8 in the audit using real test accounts, isolated providers/sandbox and synthetic docs, on the **exact intended release commit**; demonstrate actual browser actions and negative permission cases, not only rendered snapshots. Run repository required full check and CI once on stable candidate SHA. Verify production configuration/scan/email/migration readiness independently; record owner-dependent items without accidentally enabling live real-data switches.

Tests: 390/768/1280 plus desktop, keyboard/tab order, 200% zoom, screen reader labels, latency budget measured under slow connection, 80-file queue, folder fallback, agency authorized/unauthorized, guest forwarded/revoked, family child consent, expired/current snapshots, cross-tenant, no-AI, denied scanner, historical checksum. Every prior advanced feature remains accessible; accessibility, scroll-budget and UI ratchet guard tests remain passing.

## Hot file ownership

You are the only editor of global navigation and shared layout/CSS *when the lead leases them to you*. Product component owners retain their local files until integration; propose targeted edits via PR. Do not shift unrelated brand/theme standards. P13 PR(s) may land incrementally after matching backend states exist; P14 final verdict only after all required downstream PRs merge.

## End

Return proof table with per journey: user-visible outcome, exact commit, tests, role/tenant proof, device and runtime, remaining gaps. Use `operations/RELEASE_GATES.md`. If a journey is untested or blocked, call it that; do not claim complete commercial safety or 100% correct output.
