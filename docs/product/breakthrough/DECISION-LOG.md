# Breakthrough run: decision log

Append-only. Each entry is a judgment call made without the owner present, with its reason. Run of
12 Nov 2026, starting on main `0d1137e`. Everything measured on this machine is labelled LOCAL.

## Phase 1: reality and choice

### What was verified (code read on `0d1137e`, tests run on the same commit)

- The exact-copy loop works at service level: an agency asks (`requestEvidence`,
  `requestEvidenceBatch`), the traveller answers with a saved document (`submitEvidenceResponse`), the
  exact version is pinned, the agency decides, and the accepted copy stays downloadable while access
  lives. 110 tests in 9 files pass against the real services on a migrated in-memory database; none
  of the three main files uses a mocked service.
- A second agency's request can already be answered from a saved document. The service checks the
  kind, the version's safety, the owner and the agency's standing.
- Three things are missing on the traveller's side, each confirmed by reading the code:
  1. The asking agency is never named on Requests from Agencies. The button says "Send to the
     Agency". With two agencies the person confirms a send without being told the recipient.
  2. Freshness is not used. The copy list reads neither expiry nor the document's own date. A single
     expired copy is chosen in advance with "This is the only one that fits".
  3. One request, one loop. No service or screen answers several requests in one confirmed step, and
     no screen shows that a copy was accepted before.

### The three candidates

| | A. One-proof journey | B. Living evidence | C. Zero-chase exchange |
|---|---|---|---|
| Works today | Answering one request from the wallet, exact copy pinned | Needs Attention feed, Expiry Centre, "case changed" after a new version or fact edit, memory compare | Ask, send, send back with reason, clearer copy, accept, agency sees and downloads the exact copy |
| Disconnected or missing | No whole-task view: which asks are available, missing, outdated or unknown; recipient unnamed; freshness unused; no multi-answer step | Nothing flags an answered or accepted request, a share or an output when its document changes | No durable acceptance receipt for the traveller (only a chip and a thread); the answer receipt lasts 15 minutes |
| Smallest complete fix | A plan read, a confirm write that reuses the existing sender, one screen, one entry card. No migration | An "affected by this change" read across requests, shares and outputs plus notices. Outputs are rebuilt on demand, so there is nothing saved to mark | A receipt read plus a screen. Small, but it removes no step |
| Regression risk | Low: additive, the existing sender stays the only writer | Medium: new notices touch the notification pipeline other lanes are editing | Low |
| Strongest evidence against | A single request is already short (open, send) | Real value needs volume of changed documents; pilot data is synthetic and small | Receipts reassure but do not shorten the loop |
| Value per effort | Highest: removes loops for every multi-item ask and closes two trust gaps (recipient, freshness) | Lower now | Lowest |

### D1. Flagship: candidate A, shaped by the primary hypothesis

"Answer From Your Records": one review and one confirmation per agency. Reason: the loop's weakest
verified link is the traveller's step for the second agency. It costs the most actions, it is the only
step where a send is confirmed without naming the recipient, and it is where a stale copy is offered
as the obvious choice. An agency send holds up to 25 items (`MAX_EVIDENCE_REQUESTS_PER_SEND`), so the
loop count scales with exactly the behaviour the product encourages.

### D2. Rejected for now

B (living evidence) is the better second target and is named as such in the report. C's durable
receipt is partly delivered here: the receipt of a confirmation is read from saved, unchangeable rows
and does not expire.

### D3. Services take the access proof and reuse the existing sender

`confirmEvidenceAnswers` calls `submitEvidenceResponse` once per answer instead of writing rows
itself. Reason: one writer keeps pinning, standing checks, notices and audit in one place. Cost
accepted: N small transactions instead of one, and N agency notices, exactly as when the person
answers one by one.

### D4. No all-or-nothing send

A confirmation is not one transaction. Reason: each request is independent; refusing three good
answers because a fourth changed would cost the person a second round for no protection. The result
says what happened to each one and a retry replays.

### D5. The plan is recomputed at confirmation

The browser posts ids only. An answer is sent only if the plan computed at that moment still offers
that exact version for that request to that agency. Reason: exact-copy semantics and freshness must
hold at the moment of sending, not at the moment of reading.

### D6. Details (profile facts) are not in the one-step send

A request for a detail is answered with a fact id, and the request row keeps only that id
(`responding_fact_id`), not the fact version. The one-step send therefore covers documents only and
links a detail request to its own page. Reason: the instruction forbids building on behaviour whose
receipt is not pinned; multiplying it would widen it. The trust-rule tests probe this and the report
states the result and the migration that would pin it.

### D7. An outdated copy is not offered in the one-step send, and the existing page is unchanged

The request's own page still lets the person send any safe copy, as today. Reason: additive only. The
new step is stricter than the old one, never looser, and the old one keeps working. The report lists
the old page's unlabelled expired copy as a remaining weakness with a proposed follow-up.

### D8. Earlier acceptance is shown to the traveller only

"Accepted before by TEST Agency North" appears on the traveller's review. It is never sent to, or
shown to, the new agency. Reason: one agency's relationship with the traveller is not another
agency's business unless the traveller says so.

### D9. New wording lives in a new English-only catalogue file

`apps/web/src/i18n/evidence-answer.ts`, keys `evidenceAnswer.<component>.<slot>`. Reason: the
localization lane owns the converted catalogues and an open pull request edits files next to them; a
new file cannot collide. No Bengali is written. The keys are listed for that lane in the report.

### D10. Staging stays untouched

Every signed-in journey is measured with the real services on a migrated in-memory database and with
the real screen components in a browser with made-up data (the project's existing tier 1a harness).
A full signed-in browser run is not possible locally (no test sign-in mode exists, by design) and is
reported as UNVERIFIED.

## Phase 2: baseline and predictions

Persona: traveller "TEST Rahim Synthetic". Agencies: "TEST Agency North" (first), "TEST Agency
Unrelated" (second, no relationship to the first). All data is made up.

Scenario SC1 (the measured journey). TEST Agency North asked for a passport and a bank statement
earlier and accepted both. The record now also holds two photos and a national identity card that
expired last year. TEST Agency Unrelated asks for six things in one send: passport, bank statement,
photo, national identity card, employment letter, and one detail (passport number).

Baseline, counted from the code path on `0d1137e` (LOCAL, to be confirmed in a browser with the real
components in Phase 4):

| Measure | Before |
|---|---|
| Actions to send the three answers that can be sent (passport, bank statement, photo), desktop | 7: open, send; open, send; open, choose, send |
| Same at 390px (a request opens as a full panel; Back between requests) | 9 |
| Separate confirmations | 3, each to "the Agency", never named |
| Recipient named before sending | No |
| Uploads or repeated typing for documents already held | 0 |
| Expired national identity card | Chosen in advance, "This is the only one that fits", no warning: 1 misleading state |
| Employment letter (none saved) | Found only by opening that request |
| Earlier acceptance shown | No |
| Whole-ask overview (held, missing, outdated, uncertain) | None |
| Agency actions to an acceptable answer | 1 review decision per item (not changed by this slice) |

Predictions, written before building:

| Measure | Predicted after |
|---|---|
| Actions for the same three answers, desktop and 390px | 3: open the review, choose the photo, confirm |
| Separate confirmations | 1, naming TEST Agency Unrelated |
| Expired card | Shown as Outdated, not sendable from the review: 0 misleading states on the new screen |
| Missing letter and the detail | Visible in the same view without opening each request |
| Earlier acceptance | Shown on the passport and bank statement |
| Agency actions | Unchanged. No agency-side gain is claimed |
| Risk the prediction misses | The photo choice may need an extra action at 390px if the list is long; a person with one request gains nothing in actions, only the named recipient and the date check |

## Phase 2: the independent critic

An independent reviewer was given the design and the code paths only (not this log) and told to
prove the choice wrong or unsafe. Verdict: build with changes. Each objection, and what was done:

| # | Objection (severity as given) | Answer |
|---|---|---|
| 1 | BLOCKER. A MANAGE proof is not proof of ownership: an agency member can hold one, and would learn that another agency exists and what it asked | Right, and already built so: all four functions refuse any actor that is not the owner with the same "not found". A test now holds it: an agency with a live grant and a genuine proof is refused on plan, card, confirm and receipt, and nothing is sent |
| 2 | BLOCKER. The plan was rechecked outside the send's lock, so an archive, replacement or expiry landing in between could send a copy the plan no longer offers | Right. Changed: each answer is one transaction that locks the request row and the document row first, works the plan for that one request out again under those locks, and only then calls the existing sender inside the same transaction. No existing function changed: the sender is wrapped, not edited. What remains: a lifecycle change committing in the same instant on another connection, which is the same window every send has today |
| 3 | SERIOUS. A retry after the agency decided would be reported as "not sent" | Right. Changed: a repeat is recognised from the saved send itself (same request, same key, same copy) and reported as already sent whatever the agency did since. Held by a test that accepts a copy and retries |
| 4 | SERIOUS. A copy with no expiry date saved counts as in date and is ticked in advance | Partly accepted. Two saved dates that disagree are treated as uncertain and never ticked in advance. A missing expiry date is shown beside the copy in words ("No expiry date saved") but does not block: most kinds of document have no expiry at all, and the product has no reviewed list of kinds that carry one. Inventing that list here would be an unreviewed rule. Follow-up named in the report |
| 5 | SERIOUS. One press for many ticked copies is weaker consent than one press per request | Partly accepted. The press now sits beside the agency's name, the number of copies, and for every copy its name, version, added date, expiry and the scope sentence; uncertain copies and multiple-choice requests are never ticked for the person. Ticking a single clear copy in advance is kept: it is what the existing page already does for one request, and the button must still be pressed |
| 6 | SERIOUS. One notice per request per agency admin: a burst when many answers go at once | Accepted as a cost, not fixed. The total is the same as answering one by one; only the timing changes. Combining them needs a change inside the existing sender, which another open pull request is editing. Named as a follow-up |
| 7 | SERIOUS. Finding a receipt by key prefix is unsound | Right. Changed: the key has a fixed shape (24 characters) and the lookup is an exact match on the key each request gets, within this traveller and this agency only. No pattern match |
| 8 | SERIOUS. "Cannot be sent" is untrue for an outdated copy, and "accepted before" hints at approval odds | Accepted. The group is "Not in This Step" and says the copy can still be chosen on the request's own page. The history line states a past fact and adds "Each agency decides for itself" |
| 9 | SERIOUS. Query count, and a full plan read on every view of the Requests page | Accepted. The Requests page card uses one cheap query (who waits, how many). The full plan runs only on the review page: a fixed set of batched reads plus one standing check per agency and case. A confirmation costs one small plan and one send per answer, at most 25 |
| 10 | MINOR. Expiry is judged by the UTC day | Kept on purpose: it is the one rule readiness, the wallet and packages already use. Stated in the report |
| 11 | MINOR. The name promises more than documents | Accepted in the screen: details are listed with their own link and counted separately |
| 12 | MINOR. One "changed" answer hides the reason from the owner | Answered by the screen: after a confirmation the page shows the fresh plan, where each request says exactly where it stands now |
| 13 | MINOR. A summary audit entry after several commits can be lost and repeats ids | Accepted: removed. Each send already writes its own audit entry with the actor, request, copy and version |
| 14 | MINOR. Which connection do the sends use | Each answer opens its own transaction on the session's pooled handle; locks last for one answer only |

The critic's value point: "naming the agency and showing dates on the existing page would deliver
much of the value at low risk; sending several at once is rare". Answer: the first half is right and
is now part of the slice, as additions only (the asking agency's name on each request, the expiry
date beside each copy). The second half is a hypothesis with no usage data either way: agencies
already ask in sends of up to 25 items and whole checklists become requests, so a new agency's first
ask is normally several documents. It is reported as a hypothesis, not a measurement.

### D11. Not changed: the expired copy is still chosen in advance on the old page

The existing reply form chooses a single fitting copy in advance even when it is expired. Changing
which copy is chosen by default is a change to existing sending behaviour, so by this run's rules it
may only be proposed, not merged. The date is now shown beside it; the default itself is listed in
the report with the one-line change for the owner's decision.

### D12. Local heap setting for the web type check

The web type check stops at Node's default memory ceiling on this machine. Local runs set a larger
ceiling in the shell (not in the repository). CI is unchanged.
