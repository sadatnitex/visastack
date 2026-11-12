# Response to the independent review

Source: `data/INDEPENDENT_REVIEW.md` (separate session; findings re-checked against the files). Status values: FIXED, PARTLY, OPEN, DISAGREE.

| # | Finding | Status | What was done |
|---|---|---|---|
| 1 | About 900 `serviceError('code', 'literal')` messages missing from the census, some shown on screen word for word | FIXED | New extractor rule records them as `ERROR_CALL` rows with handling note `MAY_REACH_SCREEN_VIA_error.message_PASS_THROUGH`. They are queued, not yet drafted |
| 2 | Coverage report stale and inconsistent (three group counts, old draft counts) | FIXED | Report regenerated from data after the last draft; group counts now explained (all-row groups vs register translation units) |
| 3 | The no-version rule applied to real versions (snapshot, pack, case state) | FIXED in checker and guardrails; five error drafts corrected in `data/drafts/bn-BD.corrections.jsonl` | Version words are banned only where English means a copy; dropping "version" where English says version is flagged `VERSION_CONCEPT_REVIEW` for an editor. Other drafts with that pattern are listed by the flag, not silently changed |
| 4 | 25 icon and form-field names and 970 starter-checklist `purpose` and `country` keys counted as translatable | FIXED | `name` props must contain a space; seed `purpose`, `country`, `reference` rows are `EXCLUDED_MATCHING_KEY` (matched by code in `build.ts`); machine reasons starting `system:` excluded |
| 5 | Stored answer values (catalogue choices) carry no "translate at display only" flag | FIXED | New `handling_note` column: `STORED_ANSWER_VALUE_TRANSLATE_AT_DISPLAY_ONLY` |
| 6 | Qualified review flagged but not sent | OPEN | `data/QUALIFIED_REVIEW_QUEUE.csv` lists every group needing a qualified reviewer. No reviewer exists or was contacted; the owner must name one |
| 7 | Platform evidence overclaimed | FIXED in wording; limits OPEN | Attested rows are Firefox only, 92 `bn-BD` and 156 generic `bn`; Google rows downgraded; glossary attestation now exact-form only. Bangladeshi sources remain unreachable |
| 8 | Glossary: legal hold used the Saved word; Received read as "found"; Safe copy vs the safety rule | FIXED | Legal hold is আইনি হোল্ড with সংরক্ষণ forbidden; Received is পাওয়া হয়েছে; নিরাপদ allowed only inside "Safe copy" |
| 9 | `document.quarantined` kept নথি while neighbours use ডকুমেন্ট | FIXED | Added to the existing-catalogue review with a proposed fix |
| 10 | Clipped-text measure identical across variants | FIXED | Measure removed from the report |
| 11 | Em dash, plural and locale-call counts did not reproduce | PARTLY | Counts regenerate by script and the grep used is printed in the report. Em dash product strings now include service messages. The locale-call count depends on the grep pattern; the reviewer used a wider one |
| 12 | Guard tags noisy; "Go to Workspace" classed as billing | PARTLY | Generic "checked", "safe" and "either" removed from the tags; billing class tightened. Tags remain heuristic |
| 13 | Checker passed a wrong draft ("Open Privacy") and failed a correct one | OPEN | Acknowledged: the checker is word-level and is not a proxy for review. The draft was corrected by hand |
| 14 | No sources cited for ar, fr, de, es, zh-Hans notes | OPEN | The notes are from general knowledge of CLDR and common practice; they must be confirmed by native reviewers before use |
