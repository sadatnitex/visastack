# Answer from Your Records: design

Written 12 Nov 2026 on main `0d1137e`. This is the design the independent critic reviewed. Reasons and
rejected alternatives live in `DECISION-LOG.md`; results live in `REPORT.md`.

## The gap this closes

A second, unrelated agency asks a traveller for evidence. Today (verified in code):

- The traveller's Requests from Agencies page never names the agency that asks
  (`apps/web/src/app/app/applicant/[id]/evidence/request-model.ts` builds "Document: Passport"; no
  organization name is read anywhere in that folder). The button reads "Send to the Agency". With two
  agencies the person confirms a send without being told who receives it.
- Each request is answered alone: open the request, choose a copy, press Send. Six requests are six
  loops. No traveller-side service answers several requests (`submitEvidenceResponse` is the only
  writer).
- The copy list shows name, kind, added time and virus check. It reads neither the expiry date nor the
  document's own date, although both are on `DocumentSummary`. An expired passport that is the only
  copy is chosen in advance with the line "This is the only one that fits".
- Nothing tells the person that this exact copy was already accepted by an agency before.

## The capability

One review step per agency: **Answer From Your Records**. For every request of one named agency that
waits on the person, the page says what is already held, what the request needs, what is uncertain,
and what is missing. One confirmation sends the exact copies the person saw to that one agency. A
durable receipt lists each exact copy that went.

## Services (new file `packages/services/src/evidence-answer-plan.ts`, additive)

No existing exported function changes. Both new functions take the central access proof
(`AuthorizedApplicant<'MANAGE'>`) and serve the owner only; anyone else gets the same "not found".

### `planEvidenceAnswers(access, { now? })`

Read-only. Returns one group per asking organization that has a request waiting on the person
(status `OPEN` or `NEEDS_REPLACEMENT`), each with the agency's name, whether the agency can still
receive anything (active organization holding a current MANAGE grant that covers the request, the
same `orgGrantPermits` test the send itself uses), and one item per request:

| Readiness | Meaning | In the one-step send |
|---|---|---|
| `READY` | Exactly one everyday copy of the kind asked is safe to send, in date, and nothing about it is uncertain | Yes, ticked in advance |
| `CHOOSE` | More than one copy qualifies | Only after the person picks one |
| `CHECK_DATE` | A copy qualifies, but the checklist has an age rule and the document has no date of its own, so its age cannot be worked out | Only after the person ticks it |
| `OUTDATED` | Every copy of that kind is expired, or older than the checklist's own age rule | No (it can still be chosen on the request's own page) |
| `NEEDS_NEW_COPY` | Every copy is one this agency already turned down on this request, in any round | No |
| `NOT_CHECKED` | A copy exists but has not finished, or did not pass, its safety checks | No |
| `MISSING` | Nothing of that kind is saved | No |
| `OWN_STEP` | A detail (a profile fact) or a request with no document kind | No, link to the request's own page |
| `NO_ACCESS` | The agency no longer has access to the records | No |

A copy "qualifies" when all of these hold, each by the product's existing rule:

- the document is of the asked kind, present, not archived, not replaced by another document
  (`documents.superseded_by_document_id is null`, `everydayDocumentCondition`);
- its newest version is usable (`isDocumentVersionUsable`: clean, processed, not erased);
- it is not a copy this agency already turned down on this request, in any round;
- it is not expired (expired from the start of its expiry day, the comparison readiness and the
  wallet already make);
- when the request came from a checklist item with `maxAgeDays`, `classifyStaleness` does not say
  `stale`. `unknown` (rule present, no document date) qualifies but is never `READY`; neither is a
  copy whose typed and read expiry dates disagree.

Each copy carries only safe facts: document id, the exact version id and number, the name, when it was
added, the expiry day, the document's own date, and `acceptedBefore`: how many times this exact
version was accepted on an earlier request of this traveller, when last, and by which agency. That
history is the traveller's own; it is shown to the traveller only and is never sent to the new agency.

Rules are read from the checklist item the request names (`pack_requirements.max_age_days`,
`optional`). No rule is invented: a request with no checklist item has no age rule.

### `confirmEvidenceAnswers(access, { organizationId, confirmationKey, answers })`

`answers` is a list of `{ requestId, documentId, documentVersionId }`, at most 25 (the size of one
agency send), no request twice. `confirmationKey` is made by the server when the page renders: exactly
24 characters, so one key can never be the start of another.

Each answer is its own transaction, in order:

1. Lock the request row (it must be this traveller's and this agency's) and then the document row.
2. If this confirmation already recorded a send for that request (same key): report it as
   `ALREADY_SENT` when it is the same copy, whatever the agency did since; a different copy under a
   used key is `CHANGED`. Nothing is written.
3. Work the plan out again for that one request, under the locks. If it does not offer exactly that
   copy (same document, same version) to that agency, the answer is `CHANGED` and nothing is sent:
   the record moved between the review and the confirmation. A newer upload, an expiry, an ended
   share, a request answered elsewhere, another agency's request and an id that does not exist are
   all told the same way.
4. Otherwise call the existing `submitEvidenceResponse` in the same transaction with that exact
   version and the retry key `<confirmationKey>_<requestId>`. That function stays the only writer: it
   rechecks the owner, the request state, the agency's standing and the version, pins the exact copy,
   queues the agency's notice and writes the audit entry.

The result lists every answer as `SENT`, `ALREADY_SENT` or `CHANGED`. There is no all-or-nothing:
each request stands alone, a partial result is honest and repeatable, and pressing again with the
same key sends nothing twice.

### `readEvidenceAnswerReceipt(access, { organizationId, confirmationKey })`

Read-only, owner only. Lists the sends recorded under that confirmation (rows of
`evidence_request_submissions`, which are never changed once written), found by an exact match on
the key each request was given, within this traveller and this agency: request reference, the name
the file had when sent, version number, checksum fingerprint, the moment, and where the request
stands now. An unknown key, another agency's id and another traveller's key all give the same empty
receipt.

### `listAskingAgencies(access)`

Read-only, owner only, one query: every agency that has asked this traveller for something, by name,
with how many of its requests wait. It feeds the card and the "Asked by" line on the Requests page,
which must stay cheap.

## Trust rules preserved

- **Nothing is shared without an explicit confirmation.** The plan writes nothing. A send needs the
  confirm call, which names one organization; an answer for any other organization's request is
  refused as `CHANGED`.
- **Exact copy.** The version id the person reviewed is the one posted and pinned. A newer upload
  between review and confirmation is not sent in its place: the answer is `CHANGED` and the person
  reviews again.
- **History.** Nothing existing is rewritten. Earlier sends, decisions and accepted copies are read
  only.
- **Revocation.** A revoked or expired share makes the group `NO_ACCESS` in the plan and, checked
  again inside the send, refuses the send.
- **Denied equals missing.** A non-owner, an unrelated agency, and an unknown id all get "not found".
- **Retry.** The per-request retry key makes a repeated confirmation a replay.
- **No AI.** Nothing in the plan comes from a model. Kinds, dates and rules are stored facts.

Details (profile facts) are left to the request's own page on purpose: a detail answer is not pinned
to a fixed version today, so a one-step send must not multiply it (see DECISION-LOG, D6).

## Screens

- `apps/web/src/app/app/applicant/[id]/evidence/answer/page.tsx` (new, reached only from the
  Requests from Agencies page). With several agencies waiting it first lists them by name. For one
  agency it shows the review list grouped as Ready to Send, Needs Your Choice, Not in This Step,
  then one button: "Send 3 Answers to TEST Agency Unrelated". After a confirmation the same address
  with `done=<key>` shows the receipt read from saved records.
- `page.tsx` of the Requests page gains one card above the list when at least one document request
  waits: the agency's name, how many requests wait, and a link to the review step. Each request also
  says who asked it, and each copy in the existing reply form shows its expiry date. These are
  additions only: no default, order or wording of the existing page changes.
- States: loading (server rendered, no spinner state), empty (nothing waits), unavailable (the plan
  could not be read: says so, never "nothing waits"), denied (not found), contradictory (typed and
  read expiry dates disagree: shown as uncertain, never ticked in advance), stale (`OUTDATED`),
  partial (some sent, some changed: the receipt and the remaining list both show), recovery (leave
  and return: the plan is recomputed; press twice: replay).

## Migration

None. A later, approved migration could pin a detail answer to its fact version (D6); it is specified
in the report and not built here.

## Changes after review

The screens use the name "Answer from Your Records" (the interface name guard asks for a lowercase
"from"). Review findings changed details of this design; each is recorded in `DECISION-LOG.md`
(D13 to D21). The typed-versus-read expiry check is taken from the existing document list reader,
because an existing guard reserves direct reads of typed expiry dates for a short list of files.
