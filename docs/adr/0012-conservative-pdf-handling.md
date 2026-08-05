# ADR-0012: Conservative PDF handling — abandon hand-rolled content parsing

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** VisaStack engineering
- **Spec link:** amends ADR-0011's structural scanner decision; see `docs/audits/post-programme-defect-register.md` for the full round-by-round history this ADR summarizes.

## Context

ADR-0011's `BasicSafetyScanner` originally allow-listed PDF via magic bytes
plus a small, hand-rolled active-content-marker check (a raw substring
search for `/JavaScript`, `/OpenAction`, etc.). A subsequent PR (PR-B3, #68)
hardened this into a full hand-rolled PDF stream/dictionary/filter/predictor
parser, attempting to detect active content hidden inside compressed object
streams. Across 8 independent automated review rounds, this parser
accumulated 20 distinct correctness findings — each fixed via a genuine,
non-vacuously-tested, invariant-driven redesign — without ever converging on
a sound implementation. One interim fix (masking PDF comment/string syntax
across an entire file in one pass) was itself unsound and had to be caught
and reverted before it ever reached review, when it broke the ability to
find a marker inside any genuinely compressed stream. PDF's grammar
(comments, strings, nested dictionaries, filter chains, and compressed
streams whose length is frequently an indirect object reference a bounded
scanner cannot safely resolve) is expressive enough that a dependency-free,
hand-rolled parser cannot soundly establish PDF content safety.

## Decision

- Abandon PR #68 and all custom PDF content parsing entirely, rather than
  continue patching it. PDF is removed from `BasicSafetyScanner`'s
  content-trust allow-list.
- Every PDF, regardless of content, is recognized by magic bytes only (to
  produce a clear, honest rejection reason) and unconditionally returns
  `safe: false`. Nothing in the scanner inspects PDF content of any kind —
  no stream decoding, no dictionary/filter/predictor parsing, no
  active-content marker search, no `%%EOF`/object/trailer inspection.
- This routes every PDF upload to `processingStatus: NEEDS_ATTENTION` /
  `safetyStatus: QUARANTINED` through the existing, unmodified intake
  pipeline (`processIntake`), which already structurally excludes it from:
  preview/download (`isDocumentVersionUsable` requires
  `safetyStatus === 'CLEAN'`), mission evidence (the same predicate,
  `missions.ts`), and AI extraction (`NEEDS_ATTENTION` is a terminal
  processing state — the extraction step is unreachable, so nothing is ever
  sent to a text extractor or OpenAI for a rejected PDF).
- `realMalwareScanner` stays hardcoded `false` in
  `apps/web/src/lib/commercial-readiness.ts`, unchanged — a real scanner
  adapter (free to safely depend on a mature, battle-tested PDF-parsing
  library rather than hand-rolled parsing) remains a genuine future PR, not
  a heuristic to refine in `BasicSafetyScanner`.

### Deferred: synthetic demonstration fixtures (PR-D2 / PR-E2)

For controlled product demonstrations, VisaStack may in the future need to
display a small number of its own synthetic PDF fixtures without claiming
they were malware-scanned. The following architecture is approved for that
future work — **not implemented as part of this decision**:

- Fixtures live in a separate, server-authoritative demo-fixture registry —
  never as ordinary user-uploaded document versions.
- Each fixture has an immutable identifier, an expected SHA-256, a
  static/private object reference, display metadata, and an enabled status.
- Fixtures never enter the ordinary document safety state machine
  (`document_safety_status` / `document_state`) and are never represented
  as `CLEAN`, scanned, or malware-free through that model.
- Fixtures can never become applicant mission evidence.
- Fixtures can never be shared as applicant evidence.
- Fixtures contain no real PII.
- Fixture display is read-only and clearly labelled as synthetic
  demonstration content — never presented as a real applicant document.
- A hash mismatch against the registered expected SHA-256 refuses the
  fixture outright.
- The demo surface is implemented and verified during the UX/external-
  shareability (PR-D2) and deployed-E2E (PR-E2) phases, not before.

## Consequences

- **Positive:** closes an active, unbounded-effort security liability (a
  parser that kept surfacing new gaps under review) with a policy that is
  trivially, structurally sound — "never trust PDF content" cannot itself
  contain a parsing bug. Zero PDF-content-parsing attack surface remains in
  `BasicSafetyScanner`.
- **Negative / trade-offs:** no PDF, however benign, can reach
  `AWAITING_REVIEW`/`APPROVED` through the built-in scanner alone. A real
  scanner adapter is required before PDF uploads are usable in the product.
  This is an accepted, deliberate gap — commercial readiness already
  reflects it (`realMalwareScanner: false`), and is unaffected by this
  change either way.
- **Follow-ups:** (1) a real malware-scanner adapter for PDF (future PR,
  outside this program's current sequence); (2) the demo-fixture registry
  described above (PR-D2/PR-E2).

## Alternatives considered

- **Keep hardening the hand-rolled parser** — rejected: 8 review rounds, 20
  findings, no convergence, including a self-inflicted unsound redesign
  attempt. The marginal cost of continuing was demonstrated, not
  hypothetical.
- **Depend on a mature PDF-parsing library now, inside `BasicSafetyScanner`**
  — deferred, not rejected: still requires building genuine active-content
  detection logic around the library and vetting the library itself as a
  new dependency; more appropriate to build once, deliberately, as part of
  the real-scanner-adapter follow-up than to half-adopt here under the same
  time pressure that produced the abandoned parser.
- **Represent synthetic fixtures as `CLEAN` through the ordinary safety
  model** — rejected: conflates "we chose to trust this specific,
  VisaStack-authored file" with "we scanned this and it's safe," which is a
  different, and false, claim. The deferred demo-fixture registry keeps
  these concepts structurally separate instead.
