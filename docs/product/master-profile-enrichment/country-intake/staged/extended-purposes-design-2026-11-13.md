# Design note: starter lists for more purposes (proposal, not built)

Date: 13 November 2026. Status: proposal for the owner. Nothing here is built.

## Where things stand

`packages/core/src/starter-checklists/build.ts` knows three purposes in its `PURPOSES` table:
Tourist (case purpose `tourism`), Business (`business_visit`) and Medical (`medical_treatment`).
The sheet's purpose column is read by a word match ("Tourist...", "Business...", "Medical...").
Each country gets one Tourist list (the base); a Business or Medical list is the base plus that
purpose's extra lines. Keys are `starter.<country code>.<tourist|business|medical>`, and
`packages/services/src/starter-packs.ts` (export for editing) accepts only those three endings.

The staged sheet (`visastack_extended_purposes_not_loadable_yet.csv`) uses catalogue purpose keys
from `packages/core/src/catalogue/purposes.ts`. All 11 keys it names exist there:
family_or_friends_visit (120 lines), vocational_training_or_apprenticeship (41),
employer_sponsored_skilled_job (39), spouse_or_partner (29), conference_or_trade_fair (28),
transit_or_airside_transit (22), highly_skilled_or_blue_card_type (14),
foundation_pathway_or_language_course (13), medical_treatment (11), researcher_or_scientist (10),
dependants_joining_main_applicant (10). 103 lines carry a CONFIRM marker instead.

## Proposal

1. **Purposes come from the catalogue.** Replace the fixed `PURPOSES` table with a lookup over
   `CATALOGUE_PURPOSES`: the sheet names a catalogue key (or its label), and the build takes the
   key, label and family from there. The three existing purposes keep their key endings
   (`tourist`, `business`, `medical`), so lists already loaded in Pack Studio keep their keys. New
   purposes use the catalogue key as the ending (`starter.de.spouse_or_partner`). A key ending is
   permanent once loaded, so it is decided once here.
2. **Base or own list, by family.** A visit-family purpose (family or friends visit, conference,
   transit, medical) builds on the Tourist base plus its extra lines, as Business does today. A
   study, work or settle purpose stands alone: a student visa list is not a tourist list plus
   extras. The family is already in the catalogue, so this needs no new data.
3. **Several routes, one purpose.** Some countries have more than one route for one purpose (Japan
   has 145 lines across many routes). Proposal: one list per country and purpose, with the route
   name kept in "Applies when" so nothing is lost; a later step can split by route if needed.
4. **Adviser-only purposes are refused.** Purposes marked `adviser_only` in the catalogue (for
   example official or diplomatic travel, protection and investor routes) are never built into a
   starter list; the build reports them as skipped with a plain reason.
5. **The sheet.** `sheet.ts` writes and reads the purpose column; it would write the catalogue
   label plus "(extra)" or "(own list)", and the reader would accept either the label or the key.
   `starter-packs.ts` would accept any catalogue key ending instead of the three fixed ones.

## What would change in the doc-type rules

`doc-type-rules.ts` reads visit documents well but has no words for most study and work papers, so
those lines would land as "Other" and never count a document. New rules, each pointing at a
catalogue document type that already exists: admission or offer letter (`ADMISSION_LETTER`),
confirmation of enrolment (`CONFIRMATION_OF_ENROLMENT`), transcripts (`TRANSCRIPT`), degree
certificates (`DEGREE_CERTIFICATE`), language test results (`IELTS_CERTIFICATE`,
`LANGUAGE_PROFICIENCY`), employment contract (`EMPLOYMENT_CONTRACT`), job offer
(`JOB_OFFER_LETTER`), sponsorship letter (`SPONSORSHIP_LETTER`). The necessity rule stays: Required
only for every applicant with a real document, or the traveller's own passport.

## What would change in the tests

- `starter-checklists.test.ts`: the key pattern and purpose list widen to catalogue keys; new
  counts for the staged lines; a test that every purpose key in a seed exists in the catalogue; a
  test that an adviser-only purpose is skipped; a test that a study or work list does not include
  the Tourist base; the sheet round trip covers a new purpose.
- `doc-type-rules`: one example per new rule, plus a check that no study or work line is Required
  unless it is for all applicants.
- `starter-packs.ts` tests: export and re-load of a list with a catalogue key ending.

## Decisions for the owner (the CONFIRM rows)

`CONFIRM_KEY_DEGREE_STUDY` (77 lines): Germany national visa, study including PhD (14); South
Korea D-2 or D-4 (14); Hungary residence permit for study (12); Japan college or university (11);
United Kingdom Student visa (10); Italy study with university pre-enrolment (9); Thailand study
e-visa for school, university or short course (5); United States F-1 (2). Options:
- A. All under `bachelors_or_masters_degree` (simplest; PhD and language lines sit there too).
- B. Split by route: degree routes under `bachelors_or_masters_degree`, the Germany PhD lines under
  `doctorate_or_research_degree`, Korea D-4 (language training) under
  `foundation_pathway_or_language_course`, Thailand short course under `short_course_or_exchange`.
- C. All under `other_study` until each route is reviewed.

`CONFIRM_KEY` (26 lines):
- Germany national visa, family reunion (11): `spouse_or_partner`, `child_or_dependent_child`,
  `dependants_joining_main_applicant`, or split by who is joining.
- Japan official visa (8): `official_or_diplomatic_travel`, which is adviser-only in the catalogue,
  so under point 4 it would not be built; or leave these lines out.
- Netherlands Schengen entry visa when a Dutch residence permit is lost or expired (4):
  `returning_resident_permit` or `other_visit`.
- Ireland short stay "C" visit for family or friends (3): `family_or_friends_visit`.

Also for the owner: `medical_treatment` (11 lines) is the one staged purpose the build already
supports, as "Medical (extra)". It was kept staged as the task said; it can be loaded on your word
without any design change.
