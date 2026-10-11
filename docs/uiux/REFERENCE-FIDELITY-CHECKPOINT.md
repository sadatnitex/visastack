# Reference fidelity checkpoint

Latest owner mandate: corrective UI/UX fidelity, navigation and functional completeness, 2026-10-11. PDF: VisaStack_10_Apple_Style_Website_Mockups (1).pdf. All ten pages have been rendered and visually inspected at 1600 x 1000 before any new styling changes.

Baseline source: a6d37cfc518bfec12b7f82be9dbaea932157cd4b. Baseline main: dbeeddc97ee29253ffab6bedddad2ddd996445d0. The local main synchronization has the same source tree. PR 194 is merged and verified in production: all three required source/main checks, deployment smoke checks, exact READY deployment and canonical/fallback readiness passed. Production deployment: dpl_6QvxHMJK2AAmFbCSd4JwEarQHZUK. Its published source is not changed by corrective working-tree edits.

## CF-00 inventory

- 52 real page routes retained, categorized by actor/context and entry mechanism.
- 715 source control instances and 130 exported server-action handlers inventoried with bindings and source locations.
- Existing source graph: no invalid destinations and no uncovered page routes. This does not prove authorized discovery or actual action activation.
- Twelve before screenshots capture actual local public/auth route components at 1600 x 1000 and 390 x 844 under light/dark preferences. No horizontal overflow. Signed-in role screenshots remain unverified.
- [PDF region/function mapping](PDF-TO-FUNCTION-MAPPING.md) and [complete baseline source inventory](evidence/reference-fidelity-before.json).

Inventory covers every detected production JSX control and exported action; behavior, loading/errors, persistence, keyboard/mobile reachability and role permissions still require action-level review and real browser evidence. No decorative control is counted as working merely because it appears in source.

## Corrective packages

| Package | Current state | Acceptance still needed |
| --- | --- | --- |
| CF-00 | Source inventory and ten-page reference inspection recorded | Authenticated baseline captures and full action activation are unverified |
| CF-01 | Implemented locally, acceptance incomplete | Authenticated role/mobile/keyboard screenshots and journeys remain unverified |
| CF-02 | Implemented in an isolated worktree, release checks pending | Authenticated search/menu/mobile and exact header screenshots remain unverified |
| CF-03 | Overview/profile implementation complete locally, release verification pending | Real authenticated desktop/mobile comparisons and full acceptance remain unverified |
| CF-04 | Wallet list/detail and case preparation/stage presentation implemented locally, release checks pending | Sharing composer composition, full package verification and authenticated visual acceptance remain incomplete |
| CF-05 | Not implemented | Agency pipeline, activity/requests and role-specific operation |
| CF-06 | Not implemented | Platform members/metrics/trends/providers/costs and existing tools |
| CF-07 | Not implemented | Public/signup pathway and exact composition corrections |
| CF-08 | Not implemented | Remaining route/action/mobile/a11y coverage |
| CF-09 | Blocked/incomplete | Actual isolated authenticated screenshots/journeys, full visual comparisons and regression |

Session artifacts: /workspace/.cloud-tools/reference-fidelity/pdf/page-01.png through page-10.png; before-public/capture.json and twelve PNG captures. These are retained local artifacts, not published acceptance evidence.

## Preserved contracts and resume point

Neon Auth/Resend, private EU R2, native encryption, queues, canonical records, schemas, permissions, consent, quarantine, AI human review, agency grants/assignments, audit, privacy and complimentary access remain unchanged. Sensitive-data intake stays disabled. No production migrations, identity transfer, provider activation, staging branch creation or real applicant fixture writes occurred.

Next: verify and publish CF-02/CF-03 together, then complete CF-04 wallet/case/sharing composition. Preserve every existing route/action; resolve missing PDF categories to actual bounded authorized views rather than decorative links. Use existing services; keep ordinary package release checks separate from final reference acceptance. Do not describe simplified fixture screenshots or device-theme parity as complete fidelity.

## CF-01 implementation checkpoint

The shared shell selects an owned traveller, active agency membership or current platform role. It preserves secondary routes, owner guards and real case/snapshot subject binding. Case navigation waits for its server-authorized subject after hydration instead of assuming the default traveller. New routes expose bounded recent accessible case notes, an owner-only paginated account directory, and truthful security/settings entry points. No new permission grant, schema or provider activation is introduced.

The source graph now includes 56 pages and 267 references without dangling or unreferenced routes; 733 control instances and the original 130 server-action handlers remain inventoried. This is source coverage, not full browser acceptance. Focused web checks passed 43 tests; the isolated PostgreSQL owner-directory suite passed four tests covering staff denial, revoked-owner denial, field minimization and bounded pagination. Final package checks are pending.

## CF-02 implementation checkpoint

The toolbar now uses real metadata search with selected-person and current agency membership/grant/assignment boundaries. Saved unread status counts all sent in-app notices; plan labels reflect recorded entitlements. Account controls retain the existing sign-out action. Component and endpoint checks cover debounce, cancellation, keyboard behavior, failure states, body/rate limits and trusted session identity. See [exact supported search scope](SCOPED-RECORD-SEARCH.md). Six isolated search tests, two saved-state tests, 35 focused endpoint/shell tests and four component behavior tests passed; workspace type checking passed. Full release verification and provider-backed screenshot acceptance remain pending.

## CF-03 implementation checkpoint

Selected-traveller overview now keeps the three real metrics, latest active case and actual requirement completeness, attention actions, upcoming saved case dates, and recent record changes. Empty and unavailable states retain the structural regions without inventing records or reporting failed reads as zero. The agenda explicitly leaves appointments in the individual case calendar. Case completeness is not an approval prediction.

The profile uses the existing canonical field registry, divided into personal, passport/identity, travel, employment, finances and additional sections. Business, medical and attendant packs, repeating records, immutable saves, backdating, provenance and per-field assurance remain accessible. Keyboard tabs, all-field search and the history route remain functional. Completeness counts core fields with values; it does not imply identity or email verification. Health and latest changes use recorded fact states and timestamps. Both pages independently enforce current ownership before reading facts, even if layouts render concurrently.

Focused checks passed 278 page/form-accessibility tests and four real profile-editor interaction tests. These include foreign-owner refusal, retained empty regions, actual case selection/progress, unavailable totals, consent-disabled editing, keyboard tabs, cross-section search and preserved repeating-record identifiers. This is implementation verification, not provider-backed authenticated screenshot acceptance. Full package checks and production publication are still pending.

## CF-04 partial implementation checkpoint

The wallet now has real status/category filters, local metadata search, twelve-row pagination, explicit selected-document state and a mobile details jump. The detail slot retains all existing safety-gated preview/download forms, document-date corrections, naming proposals, lifecycle/usage/access details, issuer confirmation, OCR and AI review actions. Selection never substitutes another document for an unavailable explicit ID. The page independently checks ownership before its reads. Latest version numbers and update timestamps come from the existing authorized batched document reader; no schema or storage-key exposure is added. A verified file format is not persisted in the existing metadata model, so the view states this accurately instead of inferring it from a filename.

Case presentation adds actual canonical/legacy stage labels with only the current state marked, legal-next descriptions and the unchanged guarded transition actions. Evidence progress uses computed required-item completeness and exact requirement state counts, keeping unknown applicability, optional gaps, non-applicable items and applicant confirmation distinct. It does not infer completed-stage history or approval likelihood. Existing case sections, sources, snapshots, acknowledgements, submissions and deeper actions remain reachable.

Local checks passed five wallet interaction tests and all 45 document service tests, including latest-version selection. Workspace type checks, flat-design and 56-route/303-reference navigation checks passed. Full browser/production build verification, sharing-composer composition and provider-backed visual acceptance remain pending. CI now retains the full workspace suites and three root self-tests with bounded package concurrency and two Vitest workers, matching the existing local regression command; assertions and timeouts are unchanged.


## CF-04 wallet/case regression checkpoint

The complete web suite passed 1,246 tests across 105 files after the final wallet and case changes. Twelve wallet page tests, five metadata-browser interaction tests and three case-summary tests cover ownership, unavailable explicit selection, quarantine exclusion, retained processing status, actual filters and distinct evidence states. The real wallet ownership guard was temporarily removed: the refusal test failed, then passed after the guard was restored. Web type checking and final repository lint, flat-design and navigation checks passed. Production build, complete package release checks and sharing composition remain pending.

## Verified releases CF-01 through CF-03

PR 195 merged at 74eaf610a07901a9e13c76c6770710b87d73febe and PR 196 merged at 84f879eca23a4cc9e85a5f58584f10851a9be655. All three required checks passed on their exact source and merged commits; deployment smoke checks and canonical/fallback readiness passed. PR 196 production deployment is dpl_4VYnzh2Fj4gx8AgqqZNtj4p8uHVi. Contextual navigation, scoped toolbar controls and traveller overview/profile composition are live. Actual authenticated visual and role-journey acceptance remains unverified; this release evidence does not close CF-09 or enable real applicant data.


## Combined CF-04 through CF-08 implementation checkpoint

Wallet/case presentation is joined by a two-column sharing layout retaining accepted/pending/paused/ended grants, exact owned document names, grant operations, scope expansion and recorded audit activity. The native composer requires an explicit review before confirmation; edits invalidate review. Existing all-category/all-document defaults remain explicit, and redacted downloads are distinguished from original downloads. Failed document reads withhold the composer; failed access reads never imply nobody has access. No grant semantics or backend authorization is broadened.

Agency composition now puts actual stage-count cards and the authorized case inbox beside administrator-only request and active-member summaries. Workers retain assigned-case links without roster/request-management access. Recent accessible case notes remain separate from a full organization audit log. Admin composition now uses independently authorized aggregate totals and a bounded thirty-day UTC event series, with actual operational exceptions and provider/capacity information beside the working area. All ten original granular operational panels and specialized routes remain available. Counts label saved traveller records accurately; the file-version approval percentage uses approved/failed/rejected terminal versions and is not an active-user or application-success measure. Empty/unavailable readings are explicit. The real global-aggregate permission guard was removed temporarily and its refusal test failed, then the guard was restored.

Signed-in users no longer receive the public beta registration banner. Mobile navigation now uses a single compact toolbar and five-slot bottom bar at a consistent 1023px breakpoint. Workspace switching and account-level privacy/support links are in the account disclosure; contextual tools remain in navigation. The account menu bounds direct workspace entries while retaining management links to every context. Before/after checks of the real navigation components with synthetic props measured the 390px bottom region shrinking from 140px to 61px, and the broken 1023px region shrinking from 800px to 61px. These are component geometry checks only, not authenticated screen acceptance. Native disclosure dismissal, route closing, 44px targets and no horizontal overflow were checked at 320/390/768/1023px under both appearance preferences.

A signed-in help route connects existing record, agency, account, privacy, confirmation and status functions. Signup adds reference-style traveller/agency starting guidance using one account for both spaces; this does not create membership or change authentication/confirmation/notice requirements. Actual signup and all remaining routes still require full reference comparison.

Focused evidence before full-package verification: 291 page/form-accessibility tests passed; 33 agency/admin/sharing/toolbar checks passed at the preceding checkpoint; three isolated PostgreSQL aggregate tests passed, including ordinary-account and revoked-owner refusal. All eight workspace type checks passed. Flat-design and source navigation checks passed with 57 pages and 318 references at that checkpoint. Full final regression/build/browser/supply-chain verification is pending. These results do not certify complete CF-04/05/06/07/08 acceptance.

## CF-09 execution correction and remaining acceptance

The legacy WorkOS staging workflow is manual and explicitly labelled as legacy diagnostics. Missing credentials, missing isolation/exact non-production deployment proof, or skipped authenticated checks fail visibly. It cannot count as Neon acceptance. A separate manual Neon route-evidence workflow uses the real Neon form, independent synthetic roles, ten actual routes, desktop/mobile light/dark captures and selected cross-account/role checks. No authenticated execution has been performed: isolated Neon staging and synthetic fixture bindings remain unverified. See [Neon staging acceptance prerequisites and open journeys](NEON-STAGING-ACCEPTANCE.md). Complete PDF comparison, every significant action/lifecycle, provider-backed permission tests and operational acceptance remain open. CI success and fixture screenshots never close this gap.


## CF-06/07 reference action follow-up

The admin header adds an actual CSV report download from the same independently authorized aggregate reader and a direct link to operational alerts. The report contains closed metric labels, integers and UTC dates only; no account identities, applicant values, document bytes or credentials. Denial is 403 with private/no-store headers; failed reads return an explicit unavailable response. Original granular tools remain accessible.

Authentication password fields add a keyboard-operable local show/hide button while retaining the same field name, value, constraints, autocomplete and server action. This does not change Neon Auth, form notices, rate limits or confirmation behavior. Focused regression and full release verification are pending; actual authenticated visual and workflow acceptance remains open.


The staging preflight additionally refuses a preview using the production database endpoint or Neon Auth origin, independently of the manual isolation attestation. A preview-only bearer-protected probe supplies resource identifiers and exact revision without credentials; production bindings are read privately through the Vercel API and never printed. This avoids sending synthetic sign-in credentials to a preview that secretly reuses production. Actual fixture/data/storage isolation and all authenticated acceptance remain unverified.


Follow-up focused checks passed 28 navigation/agency/password/report/probe tests, plus three production-probe tests after restoring its real preview-only guard. Temporarily removing that guard made the production refusal assertion fail. Source navigation checks cover 57 pages and 320 references without dangling or unreferenced destinations. Agency case-activity labels now describe the bounded note view, and stage counts retain actual canonical/legacy vocabulary order and an empty pipeline region. Full-package verification and actual authenticated acceptance remain pending.
