# Master Profile enrichment: handoff record

Living, append-only record for everyone who works on this programme (the owner, Claude sessions, Codex). Read this before touching profile fields, document types, purposes, packs, extraction keys or the catalogue. Add to it at the end of every work session. Never rewrite earlier entries; add a dated correction instead.

## Status at a glance (updated 2026-10-14)

| Item | State |
|---|---|
| Gap analysis against bidesh365 | Done, recorded in `docs/product/master-profile-gap-analysis-2026-10-14.md` (PR 213) |
| Architecture findings | Done, `ARCHITECTURE-FINDINGS.md` in this folder |
| Implementation plan | Done, `IMPLEMENTATION-PLAN.md` in this folder |
| Phase 1 (catalogue foundations, no screens, no migration, no behaviour change) | Built on branch `claude/keen-rubin-u4kzvp`, PR open. 657 new fields, 200 document types, 101 purposes, guards, generated report. See `CATALOGUE-REPORT.md` and `CATALOGUE-GUIDE.md` |
| Phase 2 (wiring) | Not started. Waits for the owner to confirm after Phase 1 |
| Title Case for the 81 existing field labels | Separate visible change, to be previewed first |

## 1. What this programme is

One profile that serves any Bangladeshi, anywhere, for any travel or purpose (visit, study, work, residency, citizenship, sponsorship, medical, pilgrimage and more). The enrichment covers fields, documents, data and categories, and every list must stay extendable without a rewrite. Source of ideas: the bidesh365 master profile (read-only reference at `/home/user/bidesh365`, never edited from here).

## 2. Owner rules for this programme

- Power-first, production quality, no prototypes.
- Capitalisation: terms and stand-alone labels in Title Case (Passport Number, Date of Birth). Sentences follow standard practice. Buttons stay in sentence style (earlier rule). Small connecting words (of, and, for, to) stay lowercase inside a label. Confirmed by the owner 2026-10-14.
- No em dashes anywhere. Plain wording in anything a user sees.
- Bangla and all translation work stays deferred.
- Six standing decisions (defaults the owner accepted by silence): keep all purposes with adviser-only handling for protection and investor routes; sensitive declarations are structure only now, wording is held for the adviser; Bangladesh pack in v1 with the strongest protection on identifiers; first country packs are Schengen, US, UK, Canada, Gulf, Australia; household builds on the existing several-applicants-per-account feature and respects the IAM-04 limits; Phase 1 produces exact curated lists for sign-off.
- Merge when green and report (table: Area | What changed | What you will see | Who notices; then Checked live / Not live yet / Not yet checked / Needs you).

## 3. What has been done, where, how and why

| Date | What | Where | Why |
|---|---|---|---|
| 2026-10-14 | Compared all 54 bidesh365 sections, documents and purposes with VisaStack | `docs/product/master-profile-gap-analysis-2026-10-14.md` | Numbers come from extracting both registries with the compiler, not from old planning notes |
| 2026-10-14 | Read VisaStack end to end for how fields, documents, packs, sharing, AI keys, rules, reminders and trust fit together | `ARCHITECTURE-FINDINGS.md` | The enrichment must plug into what exists, not beside it |
| 2026-10-14 | Wrote the staged plan | `IMPLEMENTATION-PLAN.md` | Phases are small, reversible and each ends in something checkable |

## 4. How to check the work

- Gap analysis: open the document, every count has a "how counted" note.
- Once Phase 1 lands: `pnpm --filter @visastack/core test` runs the catalogue guards, and a generated review report is checked in with a drift test that fails when the catalogue and the report disagree.

## 5. Key findings (short form, full text in ARCHITECTURE-FINDINGS.md)

- Field list is a hand-written registry of 81 fields in `apps/web/src/lib/profile-fields.ts`, registered lazily in the database on first edit (first writer wins).
- A pack is a sharing category that grants validate against. A layer is presentation only. Do not merge the two ideas.
- The AI extraction prompt carries every registered key, so the key list must be scoped per document type before the registry grows.
- Rule packs and requirements match field keys and document types by exact free text, with no validation. A renamed key silently breaks them.
- Reminders sweep document expiry dates and issuer verifications. A typed-in expiry fact is not swept.
- Sensitive and restricted values are encrypted per value; the protection level of a field is part of its identity and must never be downgraded.

## 6. Phases

Phase 1 foundations. Phase 2 wiring. Phase 3 screens for new layers. Phase 4 country packs. Phase 5 household and sponsor views. Detail and exit checks in `IMPLEMENTATION-PLAN.md`.

## 7. Decisions still waiting on the owner

- Approve the curated lists after Phase 1 produces them.
- Adviser review of any marked wording (declarations, protection and investor routes).

## 8. Known problems and gotchas

- Not verified: whether bidesh365 runs or what its database holds; what VisaStack's stored country rule packs already name; whether fact-level sharing to organisations exists beyond the recipient field views in `sharing.ts`; how the AI evaluation harness behaves when allowed keys grow; legal wording of declarations.
- Registered field definitions are first-writer-wins. Changing a label or protection level in code does not change an already registered definition. Phase 2 must decide the up-front registration approach.
- Production runs in controlled pilot: made-up data only. No production migration without the owner's explicit go for that run.

## 9. Conflict-avoidance protocol (Claude and Codex)

1. Before editing, read this file's status table and the last session log entry.
2. Claimed areas below are owned by whoever is listed until they mark it released. Do not edit a claimed file; add a note under "Requests" instead.
3. Work on your own branch. Never push to another session's branch.
4. After finishing, append a session log entry: date, who, what changed, files, how verified, what is left.
5. If the catalogue and legacy registry disagree, the checked-in guard tests say which wins. Do not edit a guard to make code pass without recording why here.

### Claimed areas

| Area | Owner | State |
|---|---|---|
| `packages/core/src/catalogue/**` | Claude | Built (Phase 1). Other agents: read `CATALOGUE-GUIDE.md` and add through the rules there; do not edit guards |
| `apps/web/src/lib/profile-fields.ts` | Nobody | Frozen until Phase 2. Do not change keys, packs, sensitivity or types |
| `packages/services/src/{sharing,classification,packs,ai}.ts` | Nobody | Phase 2. Ask first |
| `docs/product/master-profile-enrichment/**` | Everyone | Append only |

### Owner requirements added 2026-10-14 (after Phase 1 merged)

1. Keep all fields, without clutter: sections visible but locked, opened by a checkbox. A few common sections open by default.
2. Completion counts only open fields; opening a section adds its fields immediately. (Built: `completion.ts`.)
3. Bangladesh tax: the Tax Return Acknowledgement Slip is a document type and has fields. (Built.)
4. "Other" always exists, for choices, sections, documents and purposes. (Built.)
5. Fields must be fully synced and scoped, not labels only. Fields, documents (`supports`) and sections are cross-checked by tests.
6. Decision 6 ("targets") means: follow the owner's overall requirements, no separate instruction.

### Owner decisions recorded

- 2026-10-14: the 54 common live fields stay as the default-open set. The other 27 live fields (self-employment, dependants, business and investment, medical treatment, medical attendant) stay locked until opened or until they hold data.

### Wiring progress

- **Wiring A (document names and pick-lists), built:** `documentTypeLabel` resolves any catalogue name or alias; the admin boxes for a requirement, a reminder ladder and a retention rule now offer pick-lists and save the one canonical key (an unknown name is refused with a hint to use an Other type). New entries only; nothing saved is changed. The pick-lists render on the server, so the catalogue does not ship to the browser. `@visastack/core` is marked side-effect free so unused catalogue parts stay out of bundles.
- Wiring B (AI reads only what a document supports), C (new sharing categories), D (registry built from the catalogue), storage and screens: not built.

### Still to build for this to be usable (not done)

- Storage for which sections a person opened, and for "does not apply" and "none" marks: needs a new database table (a migration, which needs the owner's explicit go for that run) plus an audit event.
- The screens: locked-but-visible sections with a checkbox, a progress bar, "suggested for your plan". Needs a preview first.
- Deriving the live registry, document names, sharing categories and AI field scoping from the catalogue (Phase 2 wiring).

### Requests

(none yet)

## 10. Phase 1 summary

- Data only. Nothing in the app reads the catalogue yet, and the 81 live fields are frozen by `profile-fields-frozen.test.ts`.
- New sensitive data sits in sharing categories that do not exist yet, so no grant can reach it until Phase 2 creates them.
- Document types keep the other product's lossy folds out (a fixed deposit receipt is not a bank statement); exact duplicates are aliases.
- Open decisions for Phase 2 are listed at the end of `CATALOGUE-REPORT.md` and in `ARCHITECTURE-FINDINGS.md` section 10.

## 11. Session log

### 2026-10-14, Claude: investigation and plan

- Read the profile, documents, sharing, classification, packs, rule conditions, expiry, reminders, assurance, wallet, contributor requests, AI and mission readiness code, plus the schema tables for fields, facts, versions, evidence links, conflicts, expiry policies and pack requirements.
- Wrote the three documents in this folder and a root `AGENTS.md`.
- Nothing in source, schema or stored data changed.
- Left: Phase 1.

### 2026-10-14, Claude: owner decisions

- Owner confirmed small connecting words stay lowercase in Title Case labels, and approved a pointer in `CLAUDE.md`, now added under section 2 (Authority).
- Files: `CLAUDE.md`, this file.

### 2026-10-14, Claude: Phase 1 catalogue

- Added `packages/core/src/catalogue/` (types, naming rules, layers, 101 purposes, 200 document types, 657 fields in ten layers, frozen snapshot of the 81 live fields, lookups, report renderer).
- Added guards: `catalogue.test.ts` (core), `profile-fields-frozen.test.ts` (web), `catalogue-consistency.test.ts` (services). Proved each can fail by breaking the real data 13 ways and restoring.
- Added `CATALOGUE-REPORT.md` (generated, drift-tested) and `CATALOGUE-GUIDE.md`.
- No database change, no behaviour change, no live field changed.
- Left: owner sign-off on the lists, then Phase 2.

### 2026-10-14, Claude: sections, completion, Other, Bangladesh tax slip

- Added `modules.ts` (82 sections: 10 open by default, 72 locked (5 live ones, 9 extra-detail, 58 new)), `completion.ts`, Other text boxes for every choice, one Other Item record per category, an Other document type per group, an Other purpose per family, the Tax Return Acknowledgement Slip (document and fields) and richer `supports` lists so documents and fields line up.
- Default-open sections hold only live fields: 54 counted fields. The other 27 live fields (self-employment, dependants, business and investment, medical treatment, medical attendant) are locked until opened or until they hold data.
- Added `modules.test.ts` and `completion.test.ts`. Proved the new guards can fail in 11 ways.
- No database change, no behaviour change.

### 2026-10-14, Claude: wiring A

- Added `lib/catalogue-input.ts`, `components/catalogue-datalists.tsx`, `document-lookup.ts` and `knownFieldOptions()`; changed the three admin actions and forms; `documentTypeLabel` now resolves aliases.
- Found while doing it: the old admin hint suggested typing `bank_statement` in lower case, but scanned documents are stored as `BANK_STATEMENT`, so a requirement typed that way would never match. New entries are now saved in canonical form. Existing saved entries are not changed and have not been audited.

### 2026-10-14, Claude: storage for opened sections (owner approved the migration)

- Migration 0086 adds two new tables and changes nothing existing: `profile_section_states` (sections a person opened or closed) and `profile_field_exemptions` (a field marked "does not apply", or a repeating record marked "none"). Both delete with the applicant. The default-open set and sections that already hold data are worked out from the catalogue, not stored.
- `profile-sections.ts` in services: `getProfileSectionState`, `setSectionOpen`, `setExemption`. Owner only, consent required, denials and every change audited, names checked against the catalogue. Always-open sections cannot be closed.
- Both tables are in the person's own data export (JSON). Not added to the CSV tables or the manifest counts.
- Proved the owner check and the name check can fail. Production migration is a separate step run through the migration workflow with the owner's go-ahead.
- Still not done: wiring B, C, D and the screens (section cards, completion strip).

### 2026-10-14, Claude: wiring B (AI reads only what a document carries) and wiring C (sharing names)

- Migration 0086 ran on production on 2026-10-14 (87 migrations, both new tables present). The storage service is built; no screen uses it yet.
- Wiring B: `ai-field-scope.ts` narrows the fields the model may propose to the registered fields the document type is known to carry (75 of 215 types have a list). A document with no type, or a type with no list, behaves as before. Where none of a type's listed fields is registered yet the full registered list is kept, so nothing stops reading: bank statements are in that state today (6 listed fields, none live). A narrowed reading has its own cache key; unnarrowed readings keep theirs.
- Wiring C: `SHARING_CATEGORIES` (the five live packs plus the seven new ones) is the single list a grant may name. A new category matches nothing until fields or documents are filed under it, so no existing access widens. The grant screen is unchanged and still offers only the live packs.
- The offline AI evaluation needs a real provider key and was not run; it passes its own fixed list, so this change does not touch it.
- Found: the Deploy Smoke and Playwright Deploy Smoke workflows also fire for the migration workflow's own deployment record and fail with 404 against the job page. A false alarm, but noisy; filter by environment when next touching those workflows.
- Still not done: wiring D (registry from the catalogue) and the section screens.

### 2026-10-14, Claude: the profile screen, registry fallback, sharing and Title Case

- New profile screen (`profile-editor.tsx`, `profile/page.tsx`): ten areas (the catalogue layers) as tabs; inside each, a card per section. Common sections are open for everyone; every other section is visible but locked (its details are listed, nothing is editable) until the person ticks "Use this section". Opening a section adds its details to the completion at once; a section that already holds a detail is open and cannot be closed; a section opened on purpose can be closed. The percentage is `computeCompletion` and is the same on the profile page and the traveller overview.
- Server builds the sections (`lib/master-profile.ts`, catalogue-heavy, server only) and passes plain data (`lib/master-profile-types.ts`) to the browser, so the catalogue stays out of browser code. `lib/master-profile-fixture.ts` is a small hand-written view for tests and the visual fixture.
- Actions (`section-actions.ts`): open or close a section, open every closed section a chosen purpose suggests (the list is rebuilt on the server), "does not apply" for a detail and "none" for a record, and a free "something else" item per section (one record filed under the section's pack, section recorded by its key so completion treats that section as open).
- Choices that accept Other get "Other" added in the view (the frozen live list is untouched) and a text box that opens as soon as Other is chosen.
- Registry: saving works for any live or added field (`savableField`); live definitions always win. Added fields register on first save, as live ones do. `fieldLabel` names a detail wherever facts are listed (history, evidence, cases, shared view, AI review).
- Sharing: the grant screen offers the five live parts and, in addition, a new category only once it holds a saved detail for the person (`newCategoriesWithData`).
- The 60 distinct live labels were put into Title Case (small connecting words lowercase) in the live registry and its frozen snapshot together; the generated report did not change.
- Accessibility rule kept: tick boxes stay enabled while saving and ignore a second click.
- Not done: agencies can still request only the live fields in the evidence form; an AI reading can offer an added field only after it has been saved once (registration is at first use); document type "Other" is in the catalogue but not yet offered in a screen; purpose suggestion is a simple choice of family, not a stored purpose.
- Standing rule from the owner (also in CLAUDE.md): keep Neon branches below 9 at all times and delete a branch once it is proven unneeded, after a deep investigation.

### 2026-10-14, Claude: agency requests, AI fields from the first upload, and the document type screen

- Agency evidence form: it now offers every live detail and every detail the catalogue added, grouped by part of the profile (`evidenceFieldGroups` in `lib/master-profile.ts`, built on the server and passed in, so the catalogue stays out of browser files), and every document type grouped as the catalogue groups them (`evidenceDocumentGroups`), plus "Something else" with a typed name. The server action now checks a requested detail against the catalogue (an unknown one is refused with a hint) and stores a known document type under its one standard key; a name typed for something else is kept as typed.
- AI: before a reading, `ensureDocumentFieldsRegistered` registers only the fields that document's type carries (`registerFieldDefinitions` in services, one round trip, first writer wins, safe to repeat). A field the catalogue added is therefore offered from the first upload. Deliberately NOT done: registering the whole catalogue, because an untyped document keeps every registered field and would hand the model hundreds it cannot hold. A document with no type, or a type with no list, changes nothing.
- Document type screen: each document on the documents page has "Kind of document" (every catalogue type, grouped, "Not set" to clear) and, for an Other type, a short name for what it is (stored in the existing `subject` column, no migration). `setDocumentType` in services: owner only, name checked against the catalogue and stored as the standard key, audited as DOCUMENT_TYPE_SET, and missions that use the document are told because readiness can change.
- Still not done: the type is chosen by hand or by approving an AI suggestion; there is no bulk change. The name given to an Other document is not yet shown in lists outside the documents page. Purpose is still a simple family choice.

### 2026-10-14, Claude: document kinds now map to sharing categories

- `documentCategory` (and the grant snapshot, the recipient view and the wallet) now file every document kind under the category the catalogue gives it, by key or any alias. The three original kinds (Passport, Bank Statement, Employment Certificate) are looked up first and never change. A kind the catalogue does not know, or files under no category, still gets none and stays out of category-limited grants (fail closed).
- No existing grant widens. A category grant is frozen to the documents it was created with; a kind's documents join only a grant created afterwards, or one the owner expands after seeing the confirmation list. Proved with a test for each case.
- This finishes the Phase 2 item "derive the document-to-category mapping from the catalogue". Still open in Phase 2: deriving the whole legacy field list from the catalogue (the live list is deliberately frozen; added fields sit beside it).


### 2026-10-14, Claude: country entry and visa-route reference data (batch 001)

- The owner's three sheets (156 countries, 61 routes, 85 requirement lines) are stored under `docs/product/master-profile-enrichment/country-intake/batch-001/` and built into `packages/core/src/destinations/batch-001.json` by `scripts/country-packs/build-destinations.mjs`. Read it through `@visastack/core/destinations` (`DESTINATIONS`, `DESTINATION_ROUTES`, `destinationByIso2`, `routesForCountry`, `lastCheckedOn`).
- Owner decision: the data is trusted as given; every screen shows the source link and the "Checked on" date. 24 countries have only an official link and are `researched: false`.
- `scripts/country-packs/validate-intake.mjs` checks future sheets (and `--live` checks links and quotes from a machine with internet). Both scripts have node tests, run in CI.
- Not done: no screen shows this data yet, nothing is stored in the database, and no pack or readiness decision uses it.
- Follow-up (same day): 18 of the 24 empty countries now carry an entry status taken from non-official visa-information sites (owner allowed this), flagged low confidence and needs-check; 6 stay not yet researched. See the country-intake README.

### 2026-10-14, Claude: page fetch workflow for the country sheets

- `scripts/country-packs/fetch-pages.mjs` and the manual workflow `.github/workflows/country-intake-pages.yml` save the text of every cited page and run the quote check on GitHub's machines. Use it to fill fees, stays and passport rules from the official pages themselves. It writes nothing to the repository.

### 2026-10-14, Claude: every document gets a kind, and the category is visible

- Why "no categories" showed: a document has a category only when its kind is set (by hand, by approving an AI suggestion, or when the built-in reader is confident). Uploads started with no kind, so the Documents filter was empty and category sharing left those files out.
- Upload form: an optional "Kind of document" choice (catalogue groups, "Not sure yet" first) and, for an Other kind, a name. `uploadDocumentAction` checks it with `prepareDocumentKind` (services, shared with `setDocumentType`) and stores the standard key; a wrong kind is refused on that field before any space is reserved. `registerDocument` and `registerDocumentWithVersion` now take an optional `subject`.
- Documents list: shows the kind in plain words with the sharing category it files under ("Passport · Identity"), an AI suggestion labelled as a suggestion, a filter with "Not set yet", and a note counting documents with no kind with a "Show them" button.
- Sharing page: when parts of the profile are chosen, a note says how many documents have no kind (they are left out) and links to the Documents page.
- Not done: nothing sets a kind for existing uploads on its own (AI suggestions stay a person's decision); the old raw-body upload route does not take a kind (the form does not use it).

### 2026-10-15, Claude: page check of the country sheets

- Ran the manual page workflow (`country-intake-pages`) on all 187 cited pages: 126 opened, 61 did not. Details and decisions are in `country-intake/README.md`.
- Corrected the 23 Schengen quotes (EU Regulation 2018/1806, Article 3(1); Annex I names Bangladesh) and Benin's quote; flagged rows whose pages do not hold the copied words (low confidence, needs check). Facts were not changed.
- The quote checker now decodes HTML character codes and ignores a space before a full stop. `fetch-pages.mjs` can print the stretches around chosen words (`show_pages` input, `url|word,word`) and keeps original capitals.
- Not done: the 61 unreachable pages (open them by hand or find another route), and Kazakhstan and Fiji (a person should check them first).

### 2026-10-15, Claude: profile areas without sideways scrolling

- The ten profile areas are now a side list on a laptop, each with how many details are filled (for example 6/20; the pack areas that count none show no number), and one "Area" box on a phone that opens the same list. The row of tabs that scrolled sideways is gone (`profile-editor.tsx`, `.profile-area-*` in `globals.css`).
- Keyboard: up, down, left, right, Home and End move between areas. While a search shows results from every area, the list stops acting as tabs, as before.
- Counts come from each section's `answered` and `total`; nothing new is stored or fetched.
- Checked in a real browser at laptop and phone width (no sideways overflow). Not checked: a signed-in walk-through on production.

### 2026-10-15, Claude: the countries screen

- New signed-in screen `/app/countries` (main menu: "Countries") lists all 156 countries with search and filters by entry rule, and `/app/countries/[code]` shows one country: the short version (entry rule, stay, passport, how to apply, where to submit in Bangladesh, fee) and its visa types with what to submit.
- Every fact shows its source link, "Checked on" date and warnings ("Not from an official page", "Needs checking before you rely on it"), and the words copied from the source are one tap away. A country not yet researched says so and never reads as "no visa needed". A visa type with fewer than five listed requirements says the list may be incomplete.
- Data comes from `@visastack/core/destinations` on the server only; the list sends the browser a small summary (no full data). The thirty Schengen states share one Schengen visa type (`SCHENGEN_ISO2`, `routesForDestination`).
- Not done: nothing here feeds readiness or any decision; agencies do not have the link in their own menu yet; the 61 unreachable source pages and the flagged rows still need a person.

### 2026-10-15, Claude: the Countries link was not in the sidebar (found and fixed)

- Mistake found: the first Countries release added the link to `PRIMARY_NAV`, which feeds only the "Find a page" box in the top bar. The sidebar the person actually sees is built by `workspaceNavigation` (`lib/workspace-navigation.ts`), so "Countries" was reachable only by searching for it or typing the address. An earlier report said it was in the main menu; that was wrong.
- Fix: "Countries" is now the last item in the personal sidebar (also before a traveller exists) and in the agency sidebar. The agency one opens `/app/agency/[orgId]/countries`, so the sidebar does not switch to the personal space; both use the same views (`countries/countries-view.tsx`, `countries/country-view.tsx`) with a `basePath`. The agency layout still checks membership.
- The sidebar now lists the six principal destinations plus Countries. On a phone the bar still shows the first four links; Countries sits under "More".
- Rendered the sidebar in a real browser at laptop and phone widths to confirm the link and icon.
- 2026-10-15, agency branding: the logo no longer shows as a broken picture (own logo route), the workspace header, settings preview and invitation share one mark and brand description, and settings has a live preview with ready-made accents and a reading check. Rendered and tested here; not verified on production signed in. Later branded documents: `docs/product/agency-brand-kit-direction.md`.

- 2026-10-15, country sheets: Kazakhstan and Fiji confirmed correct by the owner (flag cleared, confidence medium, note records it). One stale Neon preview branch deleted after proof (see known-issues).

### 2026-10-25, Claude: before or after tax for the three live amounts

- Owner decision (25 Oct 2026): record whether an income amount is before or after tax. Three new catalogue fields, one beside each live amount: `annual_income_tax_basis` (Income and Funding, universal), `monthly_salary_tax_basis` (Employment, professional) and `self_employment_income_tax_basis` (Self-Employment, professional). Choices "Before tax" and "After tax"; blank means not recorded. Each shares its amount's category, so whoever can see the amount sees its basis and nobody else.
- Live fields are not touched: `profile-fields.ts` and `legacy.ts` are unchanged (still 81), so the frozen test passes as it was.
- New field role `amount_detail` (`types.ts`): an optional fact about a live amount, shown right after the amount and its currency (`apps/web/src/lib/master-profile.ts`) and never counted toward completion, like the Other boxes. The default figure stays 54. A role field offers no "Other" (`define.ts`): it is a fixed two-way fact, and blank already means not known.
- Guard changed on purpose (`modules.test.ts`, "open by default only what is live today"): an open-by-default section may now hold `other_detail` or `amount_detail` fields. The guard's intent is unchanged: nothing in an open section may change the default completion figure, and both roles never count.
- Comparisons (`packages/services/src/consistency.ts`): the before-or-after-tax detail is read for each side the same way as the currency, so two amounts both before tax are compared as amounts, and one before against one after is a Context difference. With no basis recorded the answer is still Insufficient information.
- Verified: core catalogue suite (67), services catalogue consistency (3), web frozen and master profile tests, consistency tests (31); the report was regenerated (`CATALOGUE-REPORT.md`, 804 added fields). New guards were proved to fail when the code is broken.
- Left: documents do not yet suggest a basis (`supports` unchanged; payslips usually show both, so no automatic link was added); agencies cannot request the basis on its own as an evidence item (role fields are left out of that list, as Other boxes are).
- 2026-10-25 review follow-up (tax basis): a third choice "Not sure" lets a person undo a mistaken pick, because a saved answer cannot be emptied; it reads as not recorded. The basis is not asked when its amount is marked as not applying, unless it already holds an answer. The option wording and the amount-to-basis key link live in one place (`packages/core/src/catalogue/fields/amount-basis.ts`: `TAX_BASIS`, `taxBasisKey`, `amountKeyOfTaxBasis`), used by the profile view and the comparison.
- 2026-10-25 owner request (documents behind the details): a detail such as the tax acknowledgement slip number is not enough on its own; the person needs the slip itself on file, and embassies usually want the original handed in. Each open profile section now lists the catalogue document types whose `supports` cover its fields, with how many are on file and an Upload link that opens the documents page with that kind chosen (`?type=KEY`). 26 more document types carry `handling.original: true` (tax acknowledgement slip, solvency certificate, bank statement and reference letter, birth, child birth and marriage certificates, employment and salary certificates, employer no objection and leave approval, police clearance, invitation and sponsorship letters, affidavit of support, medical, TB, yellow fever and vaccination certificates, approved medical centre result, government no objection and order, parental and minor travel consent, degree and transcript); choosing one of them on the upload form says the original is usually handed in and a scan here keeps it ready. Wording says "usually", never a rule. CATALOGUE-REPORT regenerated.
- 2026-10-25 owner decision: `packages/services/src/ai.ts` is released to Programme X for the AI review experience only (settling a difference with a value on file, accepting all clear details at once, and the source link). `profile-fields.ts` stays frozen; `sharing.ts`, `classification.ts` and `packs.ts` stay "Phase 2, ask first".

### 2026-10-27, Claude: one place that says what each field is, for shared outputs

- New `packages/core/src/catalogue/field-policy.ts` (`fieldPolicyOf(key)`): for any field, live or added by the catalogue, its layer, kind, protection level and record. The selected-output engine (`packages/services/src/selected-output.ts`, Small Commercial V1 S8) reads it to decide what may leave the record: identifiers are masked, legal history needs the declarations layer, health detail needs the health layer, special-category and biometric fields never leave.
- The 81 live fields have no kind of their own (the frozen list is untouched), so `LEGACY_FIELD_KINDS` names the 14 that are not general. A test fails if a live field protected above Standard has no kind, and another pins the layer of those 14, because sharing now depends on it. `refusal_reason` is stored as Sensitive but is legal history; it is the one live field below its kind's floor, listed on purpose in the test.
- No field, document type, purpose or pack was added or changed. `legacy.ts` and `profile-fields.ts` are unchanged.

### 2026-10-27, Claude: Essentials First on the profile (package UX-C, owner findings 5 to 7)

- Owner finding: a new profile opened on "0% of 179 details" with no starting point. New `apps/web/src/lib/profile-essentials.ts` (`PROFILE_ESSENTIALS`) is the one list of the twelve details most visa forms ask for first: given and family name, date of birth, sex, place of birth, nationality, passport number, issue and expiry dates, email, phone and the home address (the live Address record). A test pins that the list stays between eight and twelve entries, has no repeats, and names only live details in sections open for everyone, so each can always be filled in.
- The profile screen opens on an "Essentials First" card with its own count ("4 of 12 essentials added") and the essentials editable in place; every section, the search and the purpose suggestions sit behind "Show All Sections" (the essentials list steps aside there, so no detail is drawn twice). It opens on all sections once every essential is added, and a link to one section (`#section-<key>`) always does. "Add Information" goes to the first essential still to add. The banner at the top and the traveller overview lead with the essentials; the full figure follows once they are done (and is always shown under Show All Sections). No field, section or document type changed; every field stays reachable.
- One rule in one place: `packages/core/src/catalogue/completion.ts` now exports its existing per-field rule as `isFieldAnswered` (renamed from the private `isAnswered`, behaviour unchanged; core catalogue suite still 65 passing). The essentials are judged with it, so a detail marked "does not apply", or a home address marked "none", counts there exactly as in completion. `profile-fields.ts` and `legacy.ts` are unchanged.
- Same package, outside the catalogue: History and the Dates and Expiry page now say why something is empty or has no date (an expiry date is today read only from a passport's machine-readable lines, so the wording never offers to type one in); Add an Applicant starts on Family Member once a Myself record exists and marks Myself "Already Added" (the service still accepts a second record for yourself, so it stays a choice, with a note on what it does).
- Verified: web tests for the touched screens and the guards (title case, vocabulary, plain language, page titles, accessibility), lint, type check. New guards were proved to fail by breaking the real code once.
- Left: document expiry dates cannot be typed in anywhere (only read from a passport), so other documents keep "No Date on File" until that exists; the essentials list is the same for every purpose (a purpose-specific list would need the owner's choice of fields per purpose).

### 2026-10-31, Claude: gap review of trip plan, yellow fever, allergies and student extras (steps 1 to 3)

- Owner asked whether four gaps from the old app matter. A read-only review of the code found most are already covered: the vaccination record holds the yellow fever certificate number, date and expiry (`health.ts`), `YELLOW_FEVER_CERTIFICATE` supports those fields, the student identifiers (SEVIS ID, CAS number, CoE number, school and course codes) exist in the country and study packs, and the case already stores travel start and end dates. Allergies stay out: the medical pack has a health declaration with an "Allergy" topic and an allergy card upload, and no visa form asks for a profile field.
- Step 1, catalogue: new document type `FORM_I901_FEE_RECEIPT` ("SEVIS I-901 Fee Receipt", study pack, origin proposed) so fees paid is proved by a document and no status is stored. `FORM_DS2019` now supports `us_sevis_id`. `CATALOGUE-REPORT.md` regenerated. No field was added or changed.
- Step 2, suggestions: the United States, United Kingdom and Ireland, and Australia and New Zealand sections are now suggested for the Study purpose. Nothing opens by itself. Not destination-aware, because a case destination is free text; a structured destination would be needed for that.
- Step 3, readiness: a requirement's condition can now compare against the case's own travel dates through two reserved names, `case_travel_start` and `case_travel_end` (`rule-conditions.ts`). They resolve from the case, never from a saved fact of the same name, and read as unknown (not false) when the case has no date. Used by readiness, the case snapshot and the cover letter; the prepare-again plan does not pass dates (the new case has none). No migration. No pack uses them yet: the checks (passport valid past the trip, insurance cover, bank statement window) are admin pack content to author.
- Case checklist: a missing flight, return ticket or hotel booking now shows a one-line reminder to keep bookings free to cancel until the decision (`apps/web/src/lib/booking-reminder.ts`).
- Left for the owner or a later package: author the optional yellow fever requirement in the relevant packs ("only if you stay in or pass through a risk country"; needs official citations per country); author the date-based conditions; a structured trip-legs table only if the date checks show people need it (new table, tolerant read, never a column on cases).

### 2026-10-31, Claude: Study suggestions follow the case destination

- Owner asked to make the case destination a structured choice so Study suggestions follow it. Finding: the new-case form already makes it a structured choice (a listed country, checked by `caseCountry` in `apps/web/src/lib/case-choices.ts`; the saved text is the country name and the purpose label). So no new field, no migration and no form change. What was missing was using it.
- New optional `suggestedForCountries` on a module (`types.ts`), set on the United States, United Kingdom and Ireland, and Australia and New Zealand sections (`modules.ts`). New `isModuleSuggested(module, family, caseCountries)` in `queries.ts`: with no case for that purpose naming a country, the whole family sees every section as before; once a case for that purpose names a country, only the sections listing that country are suggested.
- New `caseCountriesForFamily(cases, family)` in `case-choices.ts` reads a person's cases (purpose in the family, destination a known country; older free-text cases are ignored so they never narrow a suggestion). The profile page passes it to the view, and "Open Suggested Sections" (`section-actions.ts`) rebuilds it on the server with the same rule, so the button opens exactly what was shown.
- Not done: a country-aware suggestion for purposes other than Study (only these three sections carry countries), and counting only live cases (every saved case of that purpose counts today).

### 2026-10-31, Claude: trip date checks on the case page (option A, no migration)

- Correction first: the earlier note that readiness rules could flag a failing date check was wrong. A rule condition only decides whether a requirement applies; it cannot mark something as failing. The reserved names `case_travel_start` and `case_travel_end` remain useful for deciding when a requirement applies. A real "passport must be valid N days after the trip" rule, with a source per country, needs a new field on pack requirements (database first, owner go-ahead) and is parked as option B.
- Option A, built: a pure set of checks in `packages/core/src/trip-checks.ts` (`evaluateTripChecks`, `tripChecksApply`, `tripChecksNeedingAction`). Facts only, no country rule: the case's dates against the passport expiry and any travel insurance record, plus end before start, start date passed, and target date after the trip starts. Dates compare as calendar days in UTC. The six-month passport figure is worded as a prompt to check the destination's rule, never as a requirement.
- `packages/services/src/trip-checks.ts` (`computeTripChecks`) takes the case the page already loaded, skips cases with no dates or that are handed in, closed or cancelled, and reads only `passport_expiry` and the two `travel_insurance_valid_*` fields. A malformed or impossible date counts as not recorded.
- Case page: a "Trip Date Checks" card (only when the case has a travel date), a "Dates" jump link, a "date to check" item in the attention list and the next-step card, a one-line prompt when a case has no dates, and a plain message when the lookup fails. Layout is in `globals.css` under `WP-TRIP-CHECKS`.
- Built so later work reuses one source: the cover letter, the agency view or a country-rule version can call the same core function.
- Left: cover letter and agency view do not show the checks yet; hotel nights and flight dates are not checked (they are not read from documents into facts); closed cases are skipped, live cases of any age count.

Correction, same day: `computeTripChecks` no longer takes the case the page loaded. The full check's access ratchet (`access/enforcement.test.ts`) requires every exported service function that reads a traveller's facts to take an access proof, so it now takes `AuthorizedApplicant<'VIEW_METADATA'>` for the case and answers for the owner alone (a passport date is profile detail, not case metadata). The case page asks the gate only when the case has a travel date and is not handed in, closed or cancelled, so a case with no dates makes no extra gate call. The date parser also avoids a regular-expression `exec` call, which the supply-chain static scan reads as shell execution.
