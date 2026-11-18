# U6 records: All Records on the Wallet rows

Unit U6, Class B. Branch claude/u6-all-records. Example data only. Owner request (18 Nov 2026): every item on All Records repeated its status, version, saved date, "Not used in a case yet" and "Not shared" as long text lines. No behaviour, data, access, download or server action changed.

## What changed

| Where | Change |
|---|---|
| record/record-row.tsx (new) | One item is one row built on Expandable Section: the document picture (or the generic mark for a profile section), the name, one status picture with its Explain note, the chevron, and ONE action beside it (below it on a phone). The row opens to a short list: version, saved date, expiry, used in cases, shared with, and a link to the item's own page. |
| record/record-status.ts (new) | Which of the six Wallet status pictures each Record state wears, and its one plain sentence. The name next to the picture is always the state's own word from record-hub.ts. |
| record/u6-records.css (new) | Row grid, filter chips, details list, Not Started rows. Flat, tokens only, 44 px controls, wraps down to 320 px. Imported by the row component. |
| record-browser.tsx | Groups draw rows through the row component; the filter strip is now five separate chips (class u6-filters). Group cards are plain headings with rows, so no card sits inside a card. Search, Category, count, paging, the empty line and the Nothing Saved Yet line are unchanged. |
| record-hub.ts | An optional detailRows list on each item (the same facts as rows named by id, not by English label). facts and searchText are untouched, so search finds exactly what it found before. layoutRecordPage now returns `notStarted` instead of a per-group nothingSaved line. |
| record/page.tsx | One-line description (new key) and the explanation behind the About fold. |
| i18n/app-applicant.ts | The appended catalogue blocks (below). |
| ci-signed-in/routes.ts | The two /record entries removed from KNOWN_FAILING (the guard requires this once fixed). |
| e2e/wallet/u6-records.spec.ts, e2e/fixtures/u6-records.fixture.tsx (new) | Layout guard, row anatomy, opened row, filters and paging, accessibility. |
| record-browser.test.tsx | Updated for the new row classes; new tests for the opened row and the stylesheet. |

## Cause of the two pinned findings

`.record-hub-filters` was one clipped strip (`overflow: hidden` with a rounded edge). The rounded clip cuts the hit area at the corner buttons (Everything, Profile Details, Previous Versions), so a press at their edge reaches the fieldset behind. Fix: five separate chips, each with its own border and corners and nothing clipping them. The old rules were removed in the review batch (see below).

## Red then green

- Red: the fixture with the old strip class `record-hub-filters` fails the layout guard exactly as the signed-in guard reported: `<button> "Everything17" ... is under <fieldset.record-hub-filter-set>`, same for Profile Details and Previous Versions. Green with `u6-filters`.
- Before and after pictures at 1280 and 390: docs/upgrades/programme/wal/u6-shots/ (before-1280, before-390, after-1280, after-390). Made-up records on the real stylesheet.

## Status pictures (which drawing for which state)

Rule applied: the green "Backed by a Document" picture (ADR 0030) is never used on the Record, because the Record does not know that a file backs a value (a typed profile section has no file, and a Current Version only means the file passed its safety check). A finished state wears the plain thin ring (Entered); anything still open wears the dashed ring (Suggested); a problem wears the broken ring; an old copy wears the clock.

| Record state | Wallet picture |
|---|---|
| Current Version, All Details Saved | Entered (thin ring) |
| Still Being Checked, Needs Your Check, Expiring Soon, Partly Filled In, Nothing Saved Yet | Suggested (dashed ring) |
| Cannot Be Used, Expired | Does Not Match (broken ring) |
| Previous Version | No Longer Current (clock) |

The Explain sentence for Current Version says only "The file passed its safety check and nothing is waiting for you."; it adds "is not past its end date" only when the row has a known end date (second key stateCurrentVersionDated). Still Being Checked says "The file is saved and we are still checking and reading it." The name beside the picture and these sentences replace the Wallet's own sentences, so no sentence says something the Record does not know.

## Review batch (Opus, 18 Nov 2026), all fixed

Sentence wording as above; neutral pictures; "About Current Version" is a level 2 heading; each Open Document link is named "Open Document: <item name>"; the unused rules `.record-hub-filters`, `.record-hub-item`, `.record-hub-list`, `.record-hub-facts`, `.record-hub-actions`, `.record-hub-nothing-saved` (and the unused `.record-hub-item-head`) were removed from globals.css together with the test lines that pinned them (`.record-hub-item-title` stays). The catalogue key `appApplicant.appApplicantIdRecordPage.everythingSavedForDisplaynameInOne` is now unused by this page and is left in place on purpose (PR #581 holds its Bengali); remove it in the refill.

## Owner screenshot additions (18 Nov 2026, Guardian message)

| Ask | Done |
|---|---|
| One compact row per file and per profile group, status as a ring, one action, details in the row body | Yes (record-row.tsx). A profile group's count ("5 of 11") is the first line inside its row. |
| "Nothing saved yet: links" lines become one quiet row per section | Yes: one quiet row per group, "N more to add", with the links inside. |
| Empty sections fold into one "Not Started" group at the end | Yes: shown on the last page, never under the Profile Details filter, and out of the count and the paging as before. A group with only empty sections no longer gets a card of its own. |
| Two intro paragraphs shrink to one line; "Current Version means..." behind an info toggle | Yes: the description is one sentence; the explanation sits behind "About Current Version" (the shared About fold). |
| Count tiles stay as the filters, compact | Yes: five separate compact chips. |

## New words (message catalogue, one marked block "WP-U6 All Records rows" appended at the end of the English map of app-applicant.ts; one more line at the end of the Bengali map; nothing moved or renamed)

Keys all start `appApplicant.appApplicantIdRecordRow.`: waitingOnYou, version, saved, expires, replacedBy, usedInCases, sharedWith, detailsSaved, detailsSavedValue, noneYet, noOne, notConfirmed, openDocument, notStarted, moreToAdd, aboutCurrentVersion, allRecordsIntro, and the twelve Explain sentences stateCurrentVersion, stateCurrentVersionDated, stateExpiringSoon, stateNeedsYourCheck, statePartlyFilledIn, stateStillBeingChecked, stateNothingSavedYet, stateAllDetailsSaved, stateCannotBeUsed, stateExpired, statePreviousVersion, stateSavedHere.

Bengali: only `allRecordsIntro` has a Bengali value (the first sentence of the existing Bengali description, unchanged). Every other new key is English only, so a Bengali reader sees English for it until the localization refill; a missing key shows English by design. Bengali word list for the refill: Waiting on You = আপনার জন্য অপেক্ষায়; Version = সংস্করণ; Saved = সংরক্ষিত; Expires = মেয়াদ শেষ; Replaced By = যার দ্বারা প্রতিস্থাপিত; Used in Cases = যেসব কেসে ব্যবহৃত; Shared With = যাদের সাথে শেয়ার করা; Details Saved = সংরক্ষিত তথ্য; Open Document = নথি খুলুন; Not Started = শুরু হয়নি; None yet = এখনও নেই; No one = কেউ নয়; Not confirmed = নিশ্চিত নয়; About Current Version = বর্তমান সংস্করণ সম্পর্কে; {count} more to add = আরও {count}টি যোগ করার আছে. The eleven sentences are in the catalogue in English.

Existing hard-coded English labels reused exactly (not in the catalogue today, as before this unit): the state names Current Version, Expiring Soon, Needs Your Check, Partly Filled In, Still Being Checked, Nothing Saved Yet, All Details Saved, Cannot Be Used, Expired, Previous Version; the action labels Share, Update Details, Update or Replace, Choose the Kind, Open the Current Version; the review reasons (Expiry date not set, Kind needs your check, New name waiting for your decision); the filter names and the group names.

## Not verified

- The real signed-in /record page with real data (the specs render the real list with made-up records on the real stylesheet; the signed-in guard runs in CI).
- Safari and Firefox, real phones, screen readers.
- Bengali wording of the new words.
