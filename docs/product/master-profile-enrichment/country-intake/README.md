# Country intake

Country entry and visa-route facts for Bangladeshi ordinary-passport holders, collected by the owner and
turned into reference data the app can read.

## Decision (2026-10-14)

The owner chose to trust the three sheets as supplied ("trust these data, just mention source and update
date"). So the data is used as given. It is not turned into a pass or fail check on anyone's file, and every
screen that shows it must show the source link and the "Checked on" date next to the fact.

## What is here

| File | What it holds |
| --- | --- |
| batch-001/0-countries.csv | 156 countries: entry status, stay, passport rule, how to apply, fee, source |
| batch-001/1-routes.csv | 61 visa routes with name, purpose, fee, official channel, source |
| batch-001/2-requirements.csv | 85 requirement lines tied to a route, each with a source |
| batch-001/validation-report.csv | What the checker found in the sheets (for the owner's follow-up) |

The app reads `packages/core/src/destinations/batch-001.json`, built from the sheets by
`node scripts/country-packs/build-destinations.mjs`. A test fails if the file and the sheets disagree, so
change the sheets, rebuild, and commit both.

## What the checker found (not changed, shown for follow-up)

- 24 countries (South Korea, Vietnam, Kuwait, Bahrain and others) held only an official link and no stated
  facts. On 2026-10-14 the owner allowed well-known non-official sources for them. For 18 of the 24, only
  the entry status (and, where sources agree, the way to apply) was filled from visa-information sites that
  mostly agree. Each is marked source type "other", confidence LOW and "needs check", and carries no fee,
  stay or passport rule, because those sources contradict each other. Saint Vincent and the Grenadines uses
  the Tourism Authority's own page, which may be out of date. Kuwait, Mongolia, Djibouti, Madagascar, Sierra
  Leone and Gambia stay "not yet researched" because the sources conflict (or only claim visa-free entry,
  which is not loaded from non-official sources). Screens must show these as unconfirmed.
- Only 4 routes list five or more requirements and 16 routes list none, so a route's list is not a full
  checklist. Do not use it to say a file is ready.
- Some fees read 0 and some route lists look like templates; these were kept as given.
- Some requirement lines are steps in the process rather than documents, and a few use a date-age limit to
  describe a statement period.
- One source link (Lesotho) is not https.

Run `node scripts/country-packs/validate-intake.mjs --countries ... --routes ... --requirements ...` to
repeat the check; add `--live` on a machine with internet access to test the links and quotes.

## One change made to the sheets

Six long dashes in quoted wording and publisher names (Brazil, Kyrgyzstan) were replaced with a plain hyphen,
because the project does not use the long dash anywhere. No words changed.

## Checking the cited pages

The sandbox Claude works in has no internet, so pages cannot be opened there. The manual workflow
"Country intake pages" (Actions tab, Run workflow) runs on GitHub's machines: it saves the text of every
page named in the sheets and checks that the copied words appear on the cited page. Download the result
named `country-intake-pages` (kept 7 days). It reads files and public pages only and changes nothing.

## Page check results (2026-10-15)

The manual workflow was run against all 187 cited pages. What it showed, and what was done:

- 126 pages opened. 61 did not (connection refused, forbidden, errors, PDFs); those quotes are untested and need a person.
- 23 Schengen countries cite EU Regulation 2018/1806. The page names Bangladesh in Annex I, so "visa required" is confirmed from the law itself. The old quote joined Article 3(1) to wording from Article 4(1), so it now holds the exact Article 3(1) sentence. The 90 days in any 180 days is the general short-stay rule, not part of that sentence.
- Benin's quote was in French while the page is in English, so it now holds the real English wording.
- Quotes with a dash, a middle dot or a space before a full stop were wrongly reported as missing. The checker now decodes the page's character codes and ignores that space, so Ireland, Belarus, Malawi and Brunei pass.
- Australia, Qatar, Ethiopia, Myanmar, South Africa, Kenya, Kazakhstan and Fiji pages do not contain the copied words when fetched (several build their text with scripts). Their country, route and requirement rows are marked low confidence and "needs check"; the facts were not changed.
- Two rows to look at first: Kazakhstan (the quote says visa-free for Bangladesh while the status says visa required, and the page never names Bangladesh) and Fiji (marked visa-free from a page that does not name Bangladesh).
