# P7 plan (Lane C2, account response), branch umpe/p7-account-response

Base: origin/main 5aea5d63 (P6 merged as #414).

1. Investigate first (brief, binding): can an existing grant or sharing exception give an agency ONLY the exact document versions and fact versions a traveller approves, with a later new version staying unshared?
2. If yes: build /collect/account (sign-in return, recipient email check with isIntendedRecipient semantics, person picker through requireAccess, proposed evidence per issued item, item-by-item approval, Still Missing, Submit), an append-only response table, and the narrowest grant.
3. If no: stop before any sharing code and hand back the options with trade-offs. Building the screen and the response record without a decided sharing path would either show "Submitted to Agency" for something the agency cannot open, or force rework once the path is chosen.

## Result of step 1: no
- Grants scope to whole documents only (grants.document_ids, category snapshot of document ids). No column, policy field or resource field names a document version (packages/policy/src/authorize.ts:96-124, types.ts:41).
- The agency's own read path, accessDocument in packages/services/src/documents.ts:1328-1336, always serves the LATEST version of an authorized document. A document-level grant would therefore show the agency any version uploaded after submission.
- Facts are reachable only through category grants, which cover the category live; there is no fact or fact-version allow-list.
- ADR 0017 exceptions remove a case from an all-cases grant; documents keep their own scope, so they cannot narrow to versions either.

So step 3 applies. See handoffs/P7.md for the options.
