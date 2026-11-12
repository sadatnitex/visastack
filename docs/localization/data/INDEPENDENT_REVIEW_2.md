# Independent review 2 of the bn-BD register

Reviewer: a separate read-only session, 2026-11-12. Every claim below was checked against the files in `docs/localization` at the current working tree, using scripts for counts and reading the drafts named. The row-by-row verdicts are in `data/independent-review-2-sample.csv` (275 rows: task, id, verdict, reason, suggested fix). Nothing else was changed.

## Headline

| Task | Checked | Errors | Minor or editor points |
|---|---|---|---|
| 1 Terminology (whole register) | 3205 drafts by script; 50 random drafts read; 3 "Documents" rows | 2 | 4 |
| 2 Semantic fixes | 31 legal-hold rows, 2 virus rows, 25 sampled + all 79 version rows by script, 5 correction lines | 18 | 5 |
| 3 Flagged audit | 47 rows (12 SOURCE_ISSUE_OPEN, 5 OPEN_EDITOR_DECISION, 10 of each of three other classes) plus 3 found elsewhere | 7 wrong dispositions | 1 |
| 4 State words | 435 rows by heuristic; 60 sampled and read | 4 (none is a wrong state word) | 3 |
| 5 Numbers | 124 protected tokens and numbers by script; 15 drafts with Bengali digits | 0 | 1 risk |
| 6 Code scanning | all `tools/*.mjs` and `*.py`; tests run | 4 | 11 |

The owner's terminology rules hold across the whole register: no bare ফাইল, no নথি, no দলিল outside a deed, nothing glued before ডকুমেন্ট. The weak spots are legal hold (5 sentences still say সংরক্ষণ), version wording (15 drafts use কপি for a real version or misspell সংস্করণের), the checker (two rules hide real errors), and the flagged audit (it calls some rows fixed that are not).

## The five most serious problems

1. **Legal hold is still সংরক্ষণ in 5 drafts.** SG-3a0802f1, SG-51785b82, SG-ac643c77, SG-3b5872c4 and SG-c3018512 say আইনি কারণে সংরক্ষণ, which reads as Saved. "This case is under a legal hold" says the case "has been saved for legal reasons". The checker misses these because it tests forbidden stems only when the English is 40 characters or less (`guardrail-check.mjs` line 144). With that limit removed, exactly these 5 rows fail, plus 5 harmless ones. Fix: use আইনি হোল্ড (fixes are in the CSV), and run the T106 check at every length.
2. **The `{choice}` rule hides lost content.** `guardrail-check.mjs` line 113 lets any `{choice}` be dropped, and it flags a kept `{choice}` as PLACEHOLDER_MISMATCH (for example SG-1e7fb770, where both sides match). 14 drafts drop `{choice}`. In at least 4 of them the dropped text matters. SG-d2f7880a loses "starter list, not official", "your agency's list" and "review due", and the not-official hedge is a claim-strength guard. SG-5a0259b5 and SG-92cd6d79 lose the document type, file size and decision time. SG-8564a22b loses a hint from an accessible name. In SG-8dc7be44 the noun "files" is gone. Fix: compare placeholders as multisets, and allow a drop only where the census marks `{choice}` as an English plural switch.
3. **Product and numbered versions are written কপি.**
   - SG-8296a0aa and SG-81955cdb, "About This Version", is the product release notice in `version-notice.tsx` (it is in the layout, so on every page) and on the status page. The draft এই কপি সম্পর্কে means "about this copy". The audit even marks it ACCEPTED_DOCUMENT_HISTORY_WORDING.
   - SG-7e0dba4b and SG-b494ca72 call an issued checklist revision a নম্বরযুক্ত কপি. The second also uses কপি for "copy the link" in the same sentence.
   - SG-1d4b17e8 and SG-53e68a7b use নম্বর কপি for a request revision, while SG-b1873bf1 uses অনুরোধের সংস্করণ for the same thing.
   - SG-c5d6f692 writes নতুন কপিটি for a newer checklist version.
4. **The flagged audit marks some rows fixed that are not.** SG-c172189f is SEMANTIC_ERROR_FIXED with still_flagged=no, but "This request follows Version {pinnedVersion}" is still কপি {pinnedVersion}. SG-1fbade6c was "fixed" into the grammar error সংস্করণর (SG-afc89023 has the same error). SG-76d5a28d still says আজ ব্যবহৃত কপির for a profile-detail version. SG-9d556125 turns "never changes a snapshot" into "an earlier copy never changes", which is a change of meaning.
5. **Runtime English plurals were accepted by design.** SG-98550bda and SG-d5319908 keep `{plural}`, which is `plural(needsYou, 'item')` (agency `page.tsx:810`) and prints English such as "3 items" inside a Bengali sentence. This is the same problem as the 12 rows marked SOURCE_ISSUE_OPEN, and these 2 should be moved there. 10 drafts in the register contain `{plural}`.

## Task 1. Terminology across the whole register

My script read the `bn_BD_draft` column of `VISASTACK_TRANSLATION_REGISTER.csv` (12523 rows, 3205 drafted). It removed U+200C and U+200D before matching, and it skipped ফাইল that follows "প্রো" (প্রোফাইল) or "ভিসা ".

| Check | Rows |
|---|---|
| Bare ফাইল | 0 |
| নথি | 0 |
| দলিল with no "deed" in the English | 0 |
| A Bengali letter glued directly before ডকুমেন্ট | 0 |
| ভিসা ফাইল and ডকুমেন্ট within 14 characters | 3, all clear lists or a genitive (SG-b6c2f783, SG-06ae3f5e, SG-d063da5d) |
| Zero-width joiners | 2, both the correct র‍্য (ra plus ya-phala) in র‍্যাংকিং |
| English exactly "Documents" | 3 (SG-7c0b3e31, SG-bec3e0f9, SG-dbef4398), all ডকুমেন্টস |

**50 random drafts that contain ভিসা ফাইল or ডকুমেন্ট.** In 47, the visa file and an uploaded document are always distinguishable and the Bengali is natural. The other 3 are below.

- SG-8ee1a9d7, error: "Each one gets a link, creates their file" became নিজের ডকুমেন্ট তৈরি করেন ("creates their document"). Use নিজের প্রোফাইল তৈরি করেন.
- SG-01ee78a8, minor: "PNG ডকুমেন্ট" is unnatural for an image file.
- SG-7194c4e9, minor: ভিসা ফাইল ইতিহাস needs the genitive: ভিসা ফাইলের ইতিহাস.

**Found by the follow-up scan of rows whose English has file, document or upload but whose draft has no ডকুমেন্ট:**

- SG-8dc7be44, error: the noun was lost with `{choice}`. Use {held}টি ডকুমেন্ট অপেক্ষায় আছে.
- SG-b52c081d, minor: "on file" is written সংরক্ষিত আছে here but রাখা আছে in SG-245a2ce7, which has the same English. Pick one form.
- SG-e60ff7d8, SG-8da7faca and SG-c89d1fc2, owner decision: the landing-page "file" means the person's private record. Writing it ভিসা ফাইল makes it read as one visa case.

## Task 2. Semantic fixes

**Legal hold.** 31 rows have "legal hold" in the English and 11 of them are drafted. 6 drafts use আইনি হোল্ড correctly. The 5 listed above still use সংরক্ষণ, and the 20 undrafted rows have no Bengali at all. A related row, SG-175e0c07 ("subject to legal retention"), says আইনি সংরক্ষণ, which also collides with Saved. A suggested fix is আইন অনুযায়ী রেখে দেওয়ার নিয়ম প্রযোজ্য.

**"Checked for viruses."** SG-65a98d6a and SG-7732e69e both say ভাইরাসের জন্য পরীক্ষা করা হয়েছে. Neither uses স্ক্যান, and neither makes a stronger claim than the English. Correct. One nearby minor point: SG-60e4285a drops "exact" (হুবহু).

**Version.** I read 25 random version rows, then scanned all 79 by script for কপি or a missing version word. Document history uses কপি correctly (SG-7223211d, SG-ed5e9e58, SG-5901df1f, SG-24b2871c and others). Pack and snapshot versions use সংস্করণ or স্ন্যাপশট in most rows.

The errors fall into four groups:

- **কপি used for a real version:** SG-c172189f, SG-c5d6f692, SG-76d5a28d, SG-8296a0aa, SG-81955cdb, SG-7e0dba4b, SG-b494ca72, SG-1d4b17e8 and SG-53e68a7b.
- **Meaning changed:** SG-9d556125.
- **Spelling:** SG-1fbade6c and SG-afc89023 (সংস্করণর should be সংস্করণের).
- **Minor:** SG-97ea1f95 (the shared list is called a কপি) and SG-63dab094 (a "versioned" letter is called a কপি).

SG-4df4a534 ("new version of VisaStack" written নতুন আপডেট) is natural and acceptable.

**The five CORRECTED_AFTER_INDEPENDENT_REVIEW lines** cover 4 groups, because SG-01bcc005 appears twice. In the register:

- SG-70972319 is correct.
- SG-01bcc005 is correct: the later line wins and uses সংস্করণ.
- SG-8f13d48c is correct. The corrections file still has কেসটি, and the builder turns it into ভিসা ফাইলটি.
- SG-8c4aa9ee is minor: "Open Privacy" adds কার্যক্রম. It is marked LOW for the editor.

## Task 3. Flagged audit

The audit has 231 rows. 145 are still_flagged=no and 86 are yes. Every draft_now matches the register.

| Disposition | Rows sampled | Problems found |
|---|---|---|
| SOURCE_ISSUE_OPEN | all 12 | SG-c5d6f692 hides a separate version error (নতুন কপিটি) that fixing the source will not cure |
| OPEN_EDITOR_DECISION | all 5 | none: English menu names in calendar and home-screen steps, a real editor choice |
| SEMANTIC_ERROR_FIXED | 10 | SG-1fbade6c and SG-76d5a28d are not fully fixed; outside the sample, SG-c172189f is not fixed |
| CHECKER_FALSE_POSITIVE_REMOVED | 10 | none; each dismissal was right (typed DELETE, Property Deed, acronyms, "securely" and "safely" matching the English) |
| ACCEPTED_BY_DESIGN | 10 | SG-98550bda should be SOURCE_ISSUE_OPEN (and SG-d5319908 outside the sample); SG-e4847ccc renders "Send" as দফা (round), acceptable but loses the send idea |

Among the CHECKER_FALSE_POSITIVE_REMOVED rows, I found no dismissal that hides a real meaning error. The bigger gap is rows that were never flagged at all: the 5 legal-hold sentences and the 14 `{choice}` drops passed the checker, so they never reached the audit. Outside the sample, SG-8296a0aa is wrongly classed as ACCEPTED_DOCUMENT_HISTORY_WORDING.

## Task 4. State words

435 drafted rows contain Saved, Submitted, Sent, Received, Reviewed, Accepted, Verified, Confirmed, Approved or Ready. A heuristic based on the glossary's required and forbidden stems picked out 42; I read all 42 and they are correct. Most are sentences where জমা or পাঠানো belongs to another word in the same sentence. The deliberate মঞ্জুর for a support decision on a removal request is reasonable.

In the 60 sampled rows, no state word is wrong. The errors I did find are of other kinds:

- SG-5f2daee2, error: "A verified format is not recorded in this metadata view" is garbled. Use যাচাই করা ফরম্যাটের তথ্য এই মেটাডেটা অংশে রেকর্ড করা হয় না.
- SG-5a0259b5, error: `{choice}` content dropped (see problem 2).
- SG-92cd6d79 and SG-d2f7880a, errors found outside the sample: `{choice}` content dropped.
- SG-ad36e94f, minor: "the scan on file" became "a copy kept inside the document".
- SG-8564a22b, minor: `{choice}` dropped from an accessible name.

## Task 5. Numbers and protected values

My script pulled emails, URLs, reference codes (`C-7K2Q9M` style), all-capital tokens, file extensions, snake_case values, mixed letter-digit tokens and every number from the English (outside placeholders and tags). It then checked that each appears unchanged, or as the same digits in Bengali numerals, in the draft.

- 124 tokens checked, 0 changed.
- The only 3 misses are translations, not corruptions: NID was spelled out as জাতীয় পরিচয়পত্র, and "NEXT ACTION" was translated. Both are acceptable.
- 57 drafts use Bengali digits. I read 15 and all are correct (durations, sizes, limits, dates); the MB unit and placeholders are kept.
- 8 drafts keep Latin digits inside form names (DS-160, I-20, Form 14A and similar), which is correct.

`NUMBER_DATE_AUDIT.csv` has only a header, which matches the "0 exceptions" statement in the rules.

Risk: SG-5e451d92 gives the example for a typed amount as ২,৫০০.০০. Rules section 5.3 says inputs validate on the Latin form, so a person who copies the example may be rejected. The example should match whatever the field accepts.

## Task 6. Code scanning

Tests: `node --test tools/text-markers.test.mjs` passes 4 of 4. Biome lint on `tools/` is clean. I did not run CodeQL itself.

**Patterns that are still present:**

- `attestation-report.py` lines 21 and 61: `open()` without close. This is the py/file-not-always-closed pattern that was supposedly fixed.
- `attestation-report.py` line 12: unused variable `loc`.
- `glossary-join.py` line 6: unused import `re`.
- `coverage-report.mjs` line 55: a shell command built by interpolation (`git ls-files '${g}' | wc -l`) from census data. Use `execFileSync('git', ['ls-files', g])`.
- `format-rules.mjs` line 95: one-pass `<[^>]*>` regex tag strip. It is only used to compare text, but it is the pattern CodeQL flags; use `stripMarkers`.

**Correctness of `text-markers.mjs`:**

- `removeBlocks` finds the end tag with a bare prefix, so `</scripture` ends a `script` block. `removeBlocks('<script>x</scripture>y</script>z','script')` returns `' y</script>z'`. Require `>`, `/` or whitespace after the tag name, as `isOpenAt` already does for the start tag.
- `stripMarkers` removes only markers without attributes, so `<a href="u">t</a>` leaves `<a href="u">t`. This is fine for census markers but should be documented.
- The test file has no case for a prefix-named end tag or for attribute markers.

**Other robustness points:**

- `rendered-check.mjs` line 158: the tag regex mis-splits when a quoted attribute contains `>`.
- `rendered-check.mjs` `decode`: throws on an out-of-range numeric entity.
- `journey-packet.mjs` line 108: uses the draft as a `String.replace` replacement, so `$&` in a draft would expand. Use a function replacer.
- `guardrail-check.mjs` line 167: the bare-file test lets any Bengali letter come before ফাইল, so a glued word would pass. Whitelist প্রোফাইল instead.

No path traversal from untrusted input was found. The only argument path is `census.mjs --out`, which the operator supplies. `evidence-verify.py` calls curl with a list (no shell), on URLs from the repository's own CSV.

`data/drafts/OWNER_DECISIONS.json`, `follow_up_2026-11-12.case_written_as`, contains ফাইল typed with a Devanagari ল (U+0932). It is the only non-danda Devanagari character in the folder.

## What I did not check

- I did not read all 3205 drafts. Task 1 read 50 by hand and the rest by script only. Naturalness outside the samples is not verified.
- I did not check the 9318 undrafted rows, the census for completeness, the review packet screenshots, the glossary's Bengali choices beyond the state words, or `CASE_FILE_COLLISION_REVIEW.csv` and `NAV_TERM_REVIEW.csv` row by row.
- I did not run CodeQL. The Python check was a small syntax-tree scan for unused names and unclosed files, not pyflakes (which is not installed).
- My state-word and version heuristics can miss errors where a correct stem appears for the wrong reason.
- I am a language model, not a native qualified reviewer. Every Bengali suggestion here still needs the owner's review.
