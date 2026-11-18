# WAL9 records: the bottom tab "My Documents" is now "My Record"

Owner decision, 17 Nov 2026 (relayed by the Guardian chain): "I agree with the rest, your recommended options", with the rename listed among the recommendations. It overrides decision D6 for this tab only.

## Changed English words (for the localization lane)

| Where | Old | New |
|---|---|---|
| apps/web/src/lib/workspace-navigation.ts (constant MY_RECORD, was MY_DOCUMENTS) | My Documents | My Record |
| apps/web/src/app/app/app-nav.tsx phone label | Documents | Record |
| apps/web/src/app/app/(home)/page.tsx Add Documents hint | My Documents: upload a passport page or any file, and sort it out later. | My Record: upload a passport page or any file, and sort it out later. |

Bengali register rows to update: SG-fe32af9d (My Documents), SG-f1e29103 (hint). Not edited here, Bengali drafts untouched.

## Not changed on purpose

- Consent scope wording (Let AI Read Details from My Documents, List of My Documents, Text Read From My Documents, Review My Documents, Include the List of My Documents): these name data a person agreed to share, not the tab.
- Page headings inside the documents area: none literally named the tab.

## Held by other live lanes (SERIALIZE), to be changed by their owners

- apps/web/src/i18n/app-applicant.ts line 128: "Open My Documents" (key appApplicant.appApplicantIdDocumentsAddPage.openMyDocuments). Source text only; it names the tab, so it should become "Open My Record". SG-afd7a3f5.
- apps/web/e2e/ux-public.spec.ts: tab-name assertions at lines 1475, 1531 to 1566, 2277, 2300 to 2315.
