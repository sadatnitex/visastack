# WAL9 records: the bottom tab "My Documents" is now "My Record"

Owner decision, 17 Nov 2026 (relayed by the Guardian chain): "I agree with the rest, your recommended options", with the rename listed among the recommendations. It overrides decision D6 for this tab only.

## Changed English words (for the localization lane)

| Where | Old | New |
|---|---|---|
| apps/web/src/lib/workspace-navigation.ts (constant MY_RECORD, was MY_DOCUMENTS) | My Documents | My Record |
| apps/web/src/app/app/app-nav.tsx phone label | Documents | (removed, see below) |
| apps/web/src/app/app/(home)/page.tsx Add Documents hint | My Documents: upload a passport page or any file, and sort it out later. | My Record: upload a passport page or any file, and sort it out later. |

Bengali register rows to update: SG-fe32af9d (My Documents), SG-f1e29103 (hint). Not edited here, Bengali drafts untouched.

## Not changed on purpose

- Consent scope wording (Let AI Read Details from My Documents, List of My Documents, Text Read From My Documents, Review My Documents, Include the List of My Documents): these name data a person agreed to share, not the tab.
- Page headings inside the documents area: none literally named the tab.

## Also changed (Guardian approved 18 Nov 2026)

| Where | Old | New |
|---|---|---|
| apps/web/src/i18n/app-applicant.ts, key appApplicant.appApplicantIdDocumentsAddPage.openMyDocuments (English source only) | Open My Documents | Open My Record |

Bengali register row to update: SG-afd7a3f5.

## Still to do at the TURN (after PUB3 merges)

- apps/web/e2e/ux-public.spec.ts: tab-name assertions at lines 1475, 1531 to 1566, 2277, 2300 to 2315. Until changed these go red against the new tab name.

## Also changed (Guardian approved 18 Nov 2026, one name per thing)

| Where | Old | New |
|---|---|---|
| apps/web/src/lib/workspace-navigation.ts: More Tools entry that opens the /record hub | Record | All Records |
| apps/web/src/app/app/app-nav.tsx: phone label for My Record | Record | none (the bar reads "My Record") |
| apps/web/src/i18n/app-applicant.ts key appApplicant.appApplicantIdExpiryPage.record (English only) | Record | All Records |
| apps/web/src/i18n/app-applicant.ts key appApplicant.appApplicantIdProfilePage.record (English only) | Record | All Records |

Bengali lane: the two keys above still carry the Bengali draft for "Record"; update them with the English.

## Docs for a later docs sweep (not touched here)

- docs/uiux/ccd/FAMILIAR-PATTERNS.md (row naming My Documents)
- docs/uiux/ccd/JOURNEY-FRICTION-REGISTER-2026-11-10.md (navigation note)
- the globals.css comment at the WP-UMPE-P13 block (outside this unit's blocks)
