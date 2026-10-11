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
