# Response to the independent review

Source: `data/INDEPENDENT_REVIEW.md` (separate session; findings re-checked against the files). Status values: FIXED, PARTLY, OPEN, DISAGREE.

| # | Finding | Status | What was done |
|---|---|---|---|
| 1 | About 900 `serviceError('code', 'literal')` messages missing from the census, some shown on screen word for word | FIXED | New extractor rule records them as `ERROR_CALL` rows with handling note `MAY_REACH_SCREEN_VIA_error.message_PASS_THROUGH`. They are queued, not yet drafted |
| 2 | Coverage report stale and inconsistent (three group counts, old draft counts) | FIXED | Report regenerated from data after the last draft; group counts now explained (all-row groups vs register translation units) |
| 3 | The no-version rule applied to real versions (snapshot, pack, case state) | FIXED in checker and guardrails; five error drafts corrected in `data/drafts/bn-BD.corrections.jsonl` | Version words are banned only where English means a copy; dropping "version" where English says version is flagged `VERSION_CONCEPT_REVIEW` for an editor. Other drafts with that pattern are listed by the flag, not silently changed |
| 4 | 25 icon and form-field names and 970 starter-checklist `purpose` and `country` keys counted as translatable | FIXED | `name` props must contain a space; seed `purpose`, `country`, `reference` rows are `EXCLUDED_MATCHING_KEY` (matched by code in `build.ts`); machine reasons starting `system:` excluded |
| 5 | Stored answer values (catalogue choices) carry no "translate at display only" flag | FIXED | New `handling_note` column: `STORED_ANSWER_VALUE_TRANSLATE_AT_DISPLAY_ONLY` |
| 6 | Qualified review flagged but not sent | PARTLY | `data/review-queues/` splits the work into ordinary UI, commercial, privacy and legal, and official visa requirements. The owner has assigned themself as editor and legal reviewer (2026-11-12). That is the owner's decision, not a claim that they are a qualified legal reviewer; nothing has been reviewed yet |
| 7 | Platform evidence overclaimed | FIXED; limits OPEN | Attested rows are 248 Firefox (92 `bn-BD`, 156 generic `bn`) and 17 Google signed-out page rows (reproduced with redirects followed; an earlier downgrade of those rows was my own re-check error and is reversed). Only 79 attested rows match the English intent exactly. Glossary terms are classified observed exact form, different form, related only, or language-model recommendation. Bangladeshi sources remain unreachable |
| 8 | Glossary: legal hold used the Saved word; Received read as "found"; Safe copy vs the safety rule | FIXED | Legal hold is আইনি হোল্ড with সংরক্ষণ forbidden; Received is পাওয়া হয়েছে; নিরাপদ allowed only inside "Safe copy" |
| 9 | `document.quarantined` kept নথি while neighbours use ডকুমেন্ট | FIXED | Added to the existing-catalogue review with a proposed fix |
| 10 | Clipped-text measure identical across variants | FIXED | Measure removed from the report |
| 11 | Em dash, plural and locale-call counts did not reproduce | PARTLY | Counts regenerate by script and the grep used is printed in the report. Em dash product strings now include service messages. The locale-call count depends on the grep pattern; the reviewer used a wider one |
| 12 | Guard tags noisy; "Go to Workspace" classed as billing | PARTLY | Generic "checked", "safe" and "either" removed from the tags; billing class tightened. Tags remain heuristic |
| 13 | Checker passed a wrong draft ("Open Privacy") and failed a correct one | OPEN | Acknowledged: the checker is word-level and is not a proxy for review. The draft was corrected by hand |
| 14 | No sources cited for ar, fr, de, es, zh-Hans notes | OPEN | The notes are from general knowledge of CLDR and common practice; they must be confirmed by native reviewers before use |

## Follow-up closure of PR 511 (second pass)

| Item | Status | What was done |
|---|---|---|
| CodeQL: 4 high, 3 warning, 2 note | FIXED, to be proven on the final head | All nine were in the localization tooling. Regex tag and script stripping replaced by a tested regex-free scanner (`tools/text-markers.mjs`, `tools/text-markers.test.mjs`); Python file handles closed; unused imports and variable removed |
| Case versus uploaded document | FIXED | Case is written ভিসা ফাইল everywhere; uploaded evidence is ডকুমেন্ট or আপলোড করা ডকুমেন্ট; bare ফাইল is rejected by the checker. Complete register re-checked: 0 bare ফাইল, 14 drafts hold both objects and read distinctly |
| Transform bug found during the audit | FIXED | A compound-phrase replacement cut into প্রোফাইল ("Profile Name" became প্রোডকুমেন্টের নাম). Guarded for zero-width joiners and covered by a checker rule (`TRANSFORM_DAMAGE`) |
| Documents navigation term | FIXED | The English label Documents is ডকুমেন্টস in all 3 rows; 83 document-label strings listed for confirmation |
| 231 flagged drafts | AUDITED | `data/FLAGGED_AUDIT.csv`: 62 semantic errors fixed (legal hold, virus-check wording, version meaning), 83 checker false positives removed, the rest accepted by design, open for an editor, or source issues |
| Version wording | FIXED | Numbered pack, checklist, snapshot, letter and profile-detail versions keep সংস্করণ or স্ন্যাপশট; document history keeps কপি; 26 rows remain flagged for an editor to confirm |
| Number and date rules | DOCUMENTED | `data/NUMBER_DATE_FORMAT_RULES.md`, audit found no changed identifier; no runtime change |
| Review queues | SPLIT | Four queues; all items assigned to the owner and none reviewed |

## Second independent review (`data/INDEPENDENT_REVIEW_2.md`)

A fresh reviewer checked the fixes above and found 18 meaning errors the checker had missed. Disposition:

| Finding | Status | What was done |
|---|---|---|
| Legal hold still read as Saved in 5 long sentences (the cross-use check only ran on strings of 40 characters or fewer); one more said আইনি সংরক্ষণ | FIXED | The five drafts and the retention sentence corrected; new rule `LEGAL_HOLD_TERM` applies at any length |
| Runtime English text dropped with `{choice}` in 9 drafts; the rule let any `{choice}` go | FIXED | Rule now allows a drop only where `{choice}` is glued to a word (plural suffix) or the row is explicitly accepted; five drafts restored to keep the runtime text, three accepted with a reason, one noun restored; the rows that still print English at run time are `SOURCE_ISSUE_OPEN` |
| কপি written for real versions (About This Version, checklist and request revisions, a newer checklist, pinned version) | FIXED | Corrected to সংস্করণ; the checker now treats Revision like Version |
| Two misspellings সংস্করণর | FIXED | Corrected; rule `TYPO` added |
| "Creates their file" drafted as "document"; one garbled sentence; one missing genitive; a typed example in Bengali digits | FIXED | Corrected; typed examples keep Latin digits (`keep_latin_digits`) and are documented in the number audit |
| Audit called some rows fixed that were not; two runtime-plural rows marked accepted | FIXED | Audit now reports `FIX_INCOMPLETE_OPEN` for any changed row the checker still flags, and moves runtime-text rows to `SOURCE_ISSUE_OPEN` |
| Code scanning: unclosed `open()`, unused variable and import, shell command built from data, one-pass tag regex, `</scripture` ending a script block | FIXED | `execFileSync` with an argument array; `with open`; scanner end tag must be followed by `>`, `/` or whitespace (test added); entity decoding guarded |
| The landing page "file" (SG-e60ff7d8, SG-8da7faca, SG-c89d1fc2) means the person's private record, so ভিসা ফাইল reads as one visa case | OPEN, owner decision | Left as ভিসা ফাইল under the owner's case rule; the owner should say whether the landing-page "file" is the same object |
