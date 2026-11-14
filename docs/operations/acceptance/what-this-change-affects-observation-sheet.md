# What This Change Affects: observation sheet for the signed-in check

Status: BLOCKED until the owner has run the click script and pasted results here. Nothing in this sheet has been observed yet.

How to use it: run `docs/operations/acceptance/what-this-change-affects-click-script.md` on the live site with Claude in Chrome, signed in, made-up records only. For each row write PASS, FAIL or SKIPPED, and paste the exact words you saw (or attach a screenshot) in the last column. Check the phone width too: row 1.2, 2.1 and 3.1 on a phone or a narrow window.

Do not mark any row PASS from memory. A row with no words or screenshot stays NOT OBSERVED.

| # | Where | What you do | What you should see | Result | Words seen or screenshot |
|---|-------|-------------|---------------------|--------|--------------------------|
| 1.1 | Documents, older passport | Manage, then Replace With a Newer Document | A list of documents to choose as the newer one | NOT OBSERVED | |
| 1.2 | Same | Choose the newer one, press Continue | Heading "Replace (name)?" and under it "What This Change Affects"; a short "working out" line may flash | NOT OBSERVED | |
| 1.3 | Same | Read the list | "Needs Your Action" shows your case; a sentence says the case uses this document; last line says nothing is sent, shared or changed | NOT OBSERVED | |
| 1.4 | Same | Look before pressing Replace | Replace button still there; older document not marked Replaced | NOT OBSERVED | |
| 1.5 | Same | Press Replace | "Document Replaced"; old one stays, marked Replaced; same list worded as done | NOT OBSERVED | |
| 1.6 | Same | Press "Open the Case" | You land on the case, asked to choose the document and confirm again | NOT OBSERVED | |
| 2.1 | Documents, the Replaced document | Press the "What This Change Affects" link | Same list, and a way back to Documents | NOT OBSERVED | |
| 2.2 | Documents, a current document | Look beside it | No such link | NOT OBSERVED | |
| 3.1 | Profile | Change Employer Name (or the detail the case uses), Save | Usual saved line plus a small "What This Change Affects" box with a count in words and "See the Full List" | NOT OBSERVED | |
| 3.2 | Same | Press "See the Full List" | Page with your case under "Needs Your Action" | NOT OBSERVED | |
| 4.1 | Profile | Change a detail nothing uses, Save | Only the usual saved line; no box | NOT OBSERVED | |
| 4.2 | Documents | Replace a document nothing uses | One calm line: "Nothing else uses this. No action is needed."; no alert | NOT OBSERVED | |
| 5.1 | Whole check | Watch for forbidden wording | No sentence says an agency or person has seen, viewed or relied on something | NOT OBSERVED | |
| 5.2 | Whole check | Look for buttons inside the list | Links only; nothing that sends, shares or changes | NOT OBSERVED | |
| 5.3 | Documents | After Replace | Older document is still there, marked Replaced | NOT OBSERVED | |
| 5.4 | Whole check | If a review cannot be shown | One plain line says so; the replace or save still worked | NOT OBSERVED | |
| 6.1 | Replace panel (separate fix) | Add a file under 4 MB | You see it checked, can press Continue | NOT OBSERVED | |
| 6.2 | Replace panel | Add a file over about 4 MB | A plain line says it is too large; nothing breaks | NOT OBSERVED | |

Findings (step number and what you saw):

Verdict after the check (owner fills in): ACCEPTED, ACCEPTED WITH FINDINGS or NOT ACCEPTED.
