# Independent review of the localization inventory

Reviewer: separate session, read-only except this file and `independent-review-sample.csv`. Checked against the real source at HEAD `73666f3` (no product source changed since the report's `bc6c7a7`; only docs differ). Every judged item is a row in `data/independent-review-sample.csv`.

## 1. Census precision (seed 29, 16 rows per class)

Test per row: (a) English present at the anchor, (b) plausibly shown to a person, (c) needs translating.

| Evidence class | Sampled | Correct | Precision | False positives |
|---|---|---|---|---|
| SYNTAX_JSX | 16 | 16 | 100% | none (the fragments "of" and "on" are correctly flagged as fragments of a composed unit) |
| SYNTAX_ATTR | 16 | 16 | 100% | none |
| PROP_JSX | 16 | 14 | 87.5% | `Icon.name="chevronDown"` (icon id), `SubmitButton.name="proposalAction"` (form field name) |
| PROPERTY_HEURISTIC | 16 | 12 | 75% | `Tourist (base)` x2 and `Germany` in `starter-checklists/seed-rows.ts` (parse keys), `system: overdue {days} days ({invoiceRef})` in `billing-cycle.ts` (machine reason) |
| CANDIDATE_ONLY | 16 | 16 | 100% | none |
| All | 80 | 74 | 92.5% | |

Anchors were exact for all 80 rows (template literals normalised to `{name}` placeholders, as documented).

Findings behind the false positives:

- The earlier self-audit said lowercase single-word props were fixed. They are not: 25 PROP_JSX rows still carry a `name` prop value (icon ids, form field names), each marked `translation_unit=Y` and `P1_CORE_UI`. Translating `proposalAction` would break the server action.
- `Tourist (base)` was "doubtful but counted correct" in the self-audit. It is wrong: `purposeOf()` in `packages/core/src/starter-checklists/build.ts` matches it by regex, and `country` is looked up in `COUNTRY_CODES` (build.ts:193). Neither is shown as written. 970 seed `purpose`/`country` rows are classed `OFFICIAL_RULE_CONTENT` and `P2_RULE_CONTENT_QUALIFIED_REVIEW`, which inflates the qualified-review queue with data keys.
- `system: overdue ...` is parsed by `OVERDUE_REASON` in `apps/web/src/lib/billing-history-labels.ts`. The screen shows a different sentence ("Invoice X unpaid N days after its due date"). The translatable text is the output of `billingHistoryReason()`, not the stored reason.
- Choice options in `packages/core/src/catalogue/fields/*` (for example `Upheld (Refusal Maintained)`) are stored answer values. They are correctly in the census but carry no flag saying "translate at display only, never the stored value".

## 2. Recall gap: service error messages are silently dropped

`packages/services/src` and `apps/web/src` contain 1273 `serviceError(code, '<literal>')` calls. 906 of these literals are not in the census by line or text; 891 of those start with a lowercase letter (for example `this email already has an account [U+2014] no invitation needed`, `a valid email is required`, `only an agency owner or admin can change this`). They are not counted under `internal_error_literal` (that counter only covers `new XxxError(...)`) and are not mentioned anywhere in the coverage report.

At least some reach the screen word for word: `createInvitationAction` in `apps/web/src/app/app/admin/actions.ts:618` returns `invited.error.message` to the form. The census records that call site as one `DYNAMIC_REQUIRES_RENDERED_CHECK` row (`{invited.error.message}`), but the 900 possible source texts behind the 240 such pass-through rows are absent. Other actions (for example `agency/[orgId]/ai-actions.ts`) map codes to their own wording, so not all 891 are visible; the census cannot tell which, because it never recorded them. This is the "dynamic strings silently dropped" failure the brief asks about.

## 3. Coverage report claims checked

| Claim | Report | Independent count | Result |
|---|---|---|---|
| Non-test TS/TSX files parsed | 1369 | 1369 (git ls-files, minus `.test`, `.spec`, `test-support`) | match |
| Test and test-support files skipped | 1009 | 987 tests + 22 test-support = 1009 | match |
| Route files under `apps/web/src/app` | 192 (110 pages, 82 route handlers) | 110 `page.tsx`, 82 `route.ts` | match |
| `LANGUAGE_CHOICE_ENABLED` | off | `false` at `apps/web/src/lib/language-choice.ts:9` | match |
| `<html dir>` never set | true | only `lang` in `layout.tsx:72` and `global-error.tsx:23` | match |
| Physical-direction CSS in `globals.css` | 198 | 198 | match |
| Product strings with an em dash | 4 | at least 5: `services/src/pilot-access.ts:317` and `:327` (`this email already has an account [U+2014] no invitation needed`) is shown to the platform owner and is missing from both the census and `PRODUCT_COPY_FINDINGS.md`; `services/src/deletion.ts:387` is a further candidate | MISMATCH |
| `toLocale*` / `Intl.*` calls in the web app | 44, of which 30 fix English | 59 non-test lines with such a call, 26 of them with a literal `en`/`en-GB`/`en-US` | MISMATCH (method not stated; cannot reproduce either number) |
| English plural suffix switches | 201 | the report's own rule over the current census gives 204; the rule also counts every `{choice}` ternary, most of which are not plurals | MISMATCH (stale, and over-broad definition) |
| Semantic groups | 13505 (section 1) and 12213 (section 8) | census has 13505 distinct groups; the register has 11969 rows | MISMATCH (three different numbers; the 1536 groups missing from the register are not explained) |
| Groups with a bn-BD draft | 812 | 2824 | MISMATCH (section 8 is stale) |
| Drafts passing every check | 763 | 2680 | MISMATCH |
| Drafts flagged by a check | 49 | 144 | MISMATCH |
| Groups not drafted | 11400 | 9145 | MISMATCH |
| Draft confidence | HIGH 703, MEDIUM 102, LOW 7 | HIGH 2265, MEDIUM 398, LOW 161 | MISMATCH |
| Messages with more than one placeholder / addressing "you" | 509 / 1972 | 509 / 1972 from census `icu_flags` | match (self-referential: same extractor) |

The report states "Every count below is computed by a script". Section 8 was not regenerated after batch C; it understates the drafting by a factor of three.

Also suspicious: "clipped text blocks English 127, bn draft 127, RTL probe 127" are identical across three different texts and layouts, which suggests the measure counts a CSS property, not real clipping. Treat it as unverified.

## 4. bn-BD drafts (120 rows: 60 guarded, 60 others, seed 29)

| Set | OK | MINOR | ERROR |
|---|---|---|---|
| Guarded rows (guard_tags non-empty) | 54 | 2 | 4 |
| Other rows | 56 | 3 | 1 |
| All | 110 | 5 | 5 |

ERROR rows:

| Group | English | Draft | Problem | Fix |
|---|---|---|---|---|
| SG-70972319 | View Snapshot {version} | {version} নম্বর কপি দেখুন | "copy number N" is the numbered-copy wording C7 bans; Snapshot lost | স্ন্যাপশট {version} দেখুন |
| SG-8f13d48c | ...Review this version and decide again. | এই কপিটি পর্যালোচনা করে... | A changed case is not a copy; "অবগত হওয়ার" is awkward for acknowledged | কেসটি আপনি শেষবার স্বীকার করার পর বদলেছে। এই হালনাগাদ অবস্থা পর্যালোচনা করে আবার সিদ্ধান্ত নিন। |
| SG-01bcc005 | ...until a corrected version is published. | ...সংশোধিত কপি প্রকাশ... | An official pack version is not a document copy; implies a copy of a document is published | ...সংশোধিত তালিকা প্রকাশ না হওয়া পর্যন্ত কিছু বদলায় না। |
| SG-c28ad5fe | {toLocaleString} saved {choice} in all{choice}. | সব মিলিয়ে {toLocaleString}টি কপি সংরক্ষিত আছে{choice}। | {choice} dropped, noun invented. The checker caught it, but the draft is still in the register | Rewrite the source as an ICU plural first, then draft |
| SG-8c4aa9ee | Open Privacy | খোলা গোপনীয়তা অনুরোধ | A button linking to `/app/admin/privacy`; draft says "open privacy request". LOW confidence, yet checks PASS | গোপনীয়তা কার্যক্রম খুলুন |

Pattern: three of the five errors come from applying the "no version wording" rule (C7) to things that really are versions (a case state, a snapshot number, a published pack). The rule is right for document copies only, and the guardrail document does not say so. The drafter replaced "version" with "কপি" mechanically, which is itself a meaning change.

MINOR rows: legal hold written with সংরক্ষণ (SG-51785b82, see section 6), a permission label written as an imperative to someone else (SG-1c1992ca), and three wording preferences (SG-a68c9b89, SG-08c5c4a6, SG-d1d70b3f).

Checker behaviour: 3 of 7 checker flags in the sample were false positives (SG-f67989bc, SG-ee685677, SG-cb6538b8), and the checker passed SG-8c4aa9ee (a real error) and SG-9fa701af while failing SG-c28ad5fe for the same dropped-`{choice}` pattern. The automated check is not a reliable proxy for review.

Placeholders and markup were otherwise kept. Politeness (আপনি, করুন) and Bangladeshi forms were consistent. No draft in the sample made a stronger security, filing, verification or approval claim than the English.

## 5. Existing catalogue review

All 6 CRITICAL rows are real meaning or claim changes, verified against `packages/i18n/src/messages.ts`: `document.scanning`, `document.status.clean`, `document.status.scanning`, `document.processing.scanning` (stronger claim: scanned or clean), `document.processing.quarantined` (checking shown as quarantined), `document.processing.ready` (Reviewed and Approved shown as Ready; this one is weaker, not stronger, but merges two state words). The English and Bengali in all 46 rows match the file exactly.

KEEP rows: one should not be KEEP. `document.quarantined` keeps নথি while the glossary (T121) and the review's own fixes for neighbouring keys use ডকুমেন্ট; the same screen would show both words. The others are acceptable.

## 6. Gaps against the brief

| Requirement | Status |
|---|---|
| Complete inventory with source anchors | Not met. About 900 service error literals are missing (section 2); 25 identifier props and 970 seed data keys are included as translatable. The report does say the inventory is not verified complete, but it does not name the error-literal gap |
| Dynamic strings flagged, not silently dropped | Partly met. 4081 expressions are flagged, but the literals that feed `error.message` pass-throughs are dropped without a count |
| Rendered check | Met with honest limits: 92 of 110 page routes drawn, 82 route handlers and every email, PDF, calendar file and export not drawn. Only 4197 of about 18000 static rows are confirmed on a screen. The bn clipping figure is suspect (section 3) |
| Platform evidence with exact wording and quality labels | Overclaimed. All 248 attested rows are Firefox string files (156 of them generic `bn`, not `bn-BD`); there is no `DIRECT_SCREEN` or `BILINGUAL_OFFICIAL_PAGE` row and no Bangladeshi government, bank or app source attested. The glossary labels 16 terms `OFFICIAL_STRING_RESOURCE`, but the exact proposed form is not in the evidence for 4 of them (Download ডাউনলোড করুন, Sign in সাইন ইন করুন, Sign out সাইন আউট করুন, Close বন্ধ করুন). The guardrails (section 4) and the catalogue review (`error.generic.title`) cite Google Bengali as attested; every Google row is `UNVERIFIED` and was not reproduced on recheck |
| No stronger claims in translation | Met in the sample. But the glossary itself creates a collision: legal hold T106 uses সংরক্ষণ, the stem reserved for Saved (T002), which is critical error C1 by the document's own rule. Safe copy T036 uses নিরাপদ, the word C2 forbids for format checks; the document does not reconcile the two |
| Legal text sent to qualified review | Not met. 1771 groups are marked `qualified_review_required` and 164 of them (48 legal, 79 billing, 37 official rule) already have model drafts; `human_reviewer` is empty for all 11969 rows. Flagging is not sending: no reviewer, brief or date exists |
| Locale research for ar, fr, de, es, zh-Hans without drafting | Met. Notes are present, plausible (CLDR plural sets correct) and no draft exists (`other_locales` NOT_STARTED). No sources are cited for the notes |

Smaller points: the guard tags are noisy (for example "Something changed for one of your trips" tagged requirement level, "Date Checked" tagged file safety), and some review classes are wrong ("Go to Workspace" classed PAYMENT_BILLING). Glossary T007 Received = পাওয়া গেছে also reads as "was found"; পাওয়া হয়েছে or পৌঁছেছে is clearer.
