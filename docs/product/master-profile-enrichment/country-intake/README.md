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

- 24 countries (South Korea, Vietnam, Kuwait, Bahrain and others) hold only an official link and no stated
  facts. They are marked `researched: false` and must be shown as "not yet researched".
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
