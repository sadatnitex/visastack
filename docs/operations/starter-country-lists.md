# Starter country lists

Prepared 6 November 2026 from the owner's workbook "VisaStack Country Checklists Editable" (485 lines, 33 countries). They are the agency's starting references from its shared files. They are not official and not a check against current rules, and everything the product says about them says so.

## What a traveller sees

- A case for one of the 33 countries offers the country's starter list in the checklist picker, marked "Starter List, Not Official". It is never attached for the traveller; the traveller picks it.
- Each item shows the agency's sentence as written, for example "Six months of personal bank statement and a bank solvency letter." An item that is only for some travellers says who ("For: Employee").
- Tourist is the base list. Business and Medical lists exist for the countries whose sheet has extra items; each is the base list plus those extras, because a case holds one list.
- The checklist note says: a starter list from agency files, not official, check it against the official guidance.

## What the lists hold

| Part | How it is set |
|---|---|
| List name and key | "Japan Tourist Starter List", key `starter.jp.tourist` (also `.business`, `.medical`) |
| Country and purpose | The two-letter country code and the purpose key a case matches on (`tourism`, `business_visit`, `medical_treatment`) |
| Item wording | The sheet's sentence, kept as written (only long dashes and spaces are tidied) |
| Document type | Read from the sentence by a fixed set of rules (`packages/core/src/starter-checklists/doc-type-rules.ts`): the document named first wins. A sentence that names no document, or is an instruction, becomes "Other" and never counts a document by itself |
| How necessary | Required only for an item for every applicant with a real document type. An item for one kind of traveller is Recommended. An item that may not apply, that its own sentence calls not mandatory, or that names no document is Optional |
| Source | "Starter list: <reference file>" and the file name from the sheet. No link and no date is invented |
| Who asked for it | "Agency added" |

The document type decides which uploaded document can satisfy an item, so it is a reading, not a fact. An admin can change any item's type, wording, necessity and who it is for.

## Loading and updating (platform admin)

1. Open Pack Studio, then Starter Country Lists.
2. Choose the supplied lists or a sheet saved as CSV, then Check What Would Change. Each list shows New, Changed (with items added and removed) or Up to Date.
3. Load the lists. They load one at a time, each through the same studio steps (create, open a draft, add items, approve, publish), so every step is audited. A list that did not change is left alone. A list whose key belongs to an official or agency checklist is refused untouched.
4. To change one list by hand: open its pack in Pack Studio, press Start an Update on the published version, change or remove items (or add one with its wording), then Approve and Publish. The published version stays as it was, so cases already on it are not changed; new cases use the new version.
5. To change many lists: Download the Lists as a sheet, edit it in a spreadsheet, and load the sheet. The sheet has the columns Country, Purpose, Applies when, Document / requirement, Keep?, Reference file. A line marked No in Keep? is left out.

A starter list is due for review 120 days after it is published and shows "review due" after that; it stays usable.

## Who can change what

- Platform staff with the Pack Studio permission load and update the shared starter lists. A change reaches every new case that picks the list.
- Agency owners and admins keep their own copy of any shared list ("Make It Our Own"), under Checklists in the agency workspace (an admin-only link). The copy belongs to that agency alone: only that agency's cases offer it (marked "your agency's list"), no other agency can see or change it, and the shared list is never touched. An agency changes its copy as a draft (change or remove items, add its own, with the wording a traveller reads), then publishes it as the next version. Cases already on an older version keep it. A change made by the platform to the shared list does not flow into an agency's copy, by design: the agency decided what its copy says.
- A case worker who is not an owner or admin cannot change checklists. Every step checks the person live against the agency, and each change is recorded in the audit trail under the person who made it.

## What is not in this release

- A traveller cannot yet reword, add, or turn off items on their own case. The case keeps the exact version it was attached to; the traveller can leave a non-blocking item out with a reason, leave an item missing, and add tasks, as before. Editing a case's own copy needs a new table (a database change that runs only on the owner's word); it is the next package.
- The Trip Package panel and the evidence request screens still name an item by its document type, not by the sentence.
- Document types were read by rules and have not been checked line by line by a person. Review them in the studio.
