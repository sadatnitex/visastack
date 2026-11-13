# Breakthrough run: report

Run of 12 Nov 2026. Plain language. Everything measured on the build machine is labelled LOCAL;
anything not checked is labelled UNVERIFIED. Decisions and their reasons are in `DECISION-LOG.md`,
the design in `DESIGN.md`, the trust rules and their failure proofs in `TRUST-RULES.md`, the
commercial reasoning in `COMMERCIAL-NOTES.md`.

## 1. Current reality

- Source: main `0d1137e` when the run started and when the branch was verified. Main did not move.
- Tests on main before any change (LOCAL, same machine): 4,369 service tests, 7,291 screen tests,
  957 tests in the other packages, all passing; the public browser set 323 passed; smoke passed.
- The whole pull-request browser set on untouched main, LOCAL: 457 passed, 1 skipped, 1 failed.
  The one failure (`scroll-budget/WP-SB2.spec.ts`, first checklist row at phone width, 1,518 px
  against a 1,500 px limit) is on a screen this run did not touch and fails the same way with and
  without this change on this machine. Main's own CI is green, so it is recorded as a difference
  of this machine, not explained further here.
- The same set on the branch (LOCAL): 4,422 service tests (53 more), 7,377 screen tests (86 more),
  957 in the other packages, all passing; type check, lint, build, supply-chain scan and smoke
  passing; the public browser set 323 passed; the whole pull-request browser set 469 passed (12
  more), 1 skipped, and the same single failure as on untouched main. No test that passed before
  fails after. The web type check and build need a larger memory limit than Node's default on this
  machine; that was set in the shell for both runs, not in the repository.
- Staging: unchanged and untouched. It is an empty schema with no accounts and no deployment, so
  every signed-in staging journey is still blocked. Nothing in this run is staging proof.
- Unknowns: how often a real agency ask contains several documents the traveller already holds
  (production has made-up records only); screen reader behaviour on a real device.
- Conflicts with earlier audits: none found. Two gaps in existing code were found and are listed in
  section 6.

## 2. Opportunity decision

Three candidates were traced in code:

| Candidate | What already works | What was missing | Verdict |
|---|---|---|---|
| A. One-proof journey | One request can be answered from a saved document, exact copy pinned | The asking agency is never named; dates are not shown; one loop per request; no view of what is held, missing, outdated or uncertain | Chosen |
| B. Living evidence | Needs Attention, Expiry Centre, "case changed" after a new version | Nothing flags an answered request, a share or an output when its document changes | Better second target |
| C. Zero-chase exchange | Ask, send, send back, clearer copy, accept, agency downloads the exact copy | No lasting acceptance receipt for the traveller | Partly delivered: the new receipt does not expire |

The winner is A, shaped by the primary hypothesis: the weakest link was the traveller answering a
second, unrelated agency. It cost the most actions, it was the only step where a send was confirmed
without naming who receives it, and it offered an expired copy as the obvious choice.

The independent critic's verdict was "build with changes". Its fourteen objections and the answer to
each are in the decision log. The ones that changed the design: the owner check is enforced and
tested for an agency holding a genuine grant; the plan is worked out again inside the same locked
transaction as each send; a repeat after the agency decided is reported as already sent; the receipt
lookup is an exact key match; the Requests page card uses one cheap query; wording never says
"cannot be sent" for a copy the person may still choose on the request's own page. Its value point
(name the agency and show dates on the existing page) was accepted and built as additions.

## 3. User experience

Persona: traveller "TEST Rahim Synthetic". "TEST Agency North" asked first and accepted a passport
and a bank statement. "TEST Agency Unrelated" then asks for six things: passport, bank statement,
photo, national identity card, employment letter, and one detail.

Before:

1. Open Requests from Agencies. Six rows, none says which agency asks.
2. Open the passport request. The only copy is chosen. Press "Send to the Agency". Back.
3. Open the bank statement request. Press Send. Back.
4. Open the photo request. Choose one of two. Press Send.
5. The identity card request shows its expired copy already chosen, "This is the only one that
   fits", with no date.
6. The missing employment letter is found only by opening that request.

After:

1. Requests from Agencies shows one card: "TEST Agency Unrelated is waiting for 6 answers", with
   the button Answer from Your Records. Every request also says "Asked by ...", and every copy in
   the old reply form now shows its expiry date.
2. The review lists everything that agency waits for in three groups:
   - Ready to Send: passport and bank statement, each with file name, version, when it was added,
     its expiry, and "Accepted before by TEST Agency North. Each agency decides for itself."
   - Needs Your Choice: the photo (two copies; "Do Not Send Now" is the starting choice).
   - Not in This Step: the identity card (saved copy is out of date), the employment letter
     (nothing saved, with Add Documents), the detail (answered on its own page).
3. One button: "Send 3 Answers to TEST Agency Unrelated", beside "TEST Agency Unrelated can
   download these exact copies while it has access."
4. A receipt, read from saved records and shown again on any later visit to the same address:
   each exact copy by name, version, fingerprint, time and where it stands ("Received, Not Yet
   Reviewed" until the agency decides).

Screen states covered: nothing waiting; several agencies (the person chooses, none is chosen for
them); the plan could not be read (says so, never "nothing is waiting"); not available yet; an
agency that lost access; records changed between review and send (says what was not sent, shows the
fresh list); more than 25 answers ticked (says so, never drops some silently); leaving and returning
(the list is worked out again); pressing twice (nothing is sent twice).

## 4. Implementation

- Services, new file `packages/services/src/evidence-answer-plan.ts`: `planEvidenceAnswers`,
  `confirmEvidenceAnswers`, `readEvidenceAnswerReceipt`, `listAskingAgencies`. All take the central
  access proof and serve the owner only. Sending goes through the existing `submitEvidenceResponse`,
  which stays the only writer. Additive export of two existing pure date rules.
- Screens, new route `apps/web/src/app/app/applicant/[id]/evidence/answer/` (page, form, server
  action, receipt), a card and an "Asked by" line on the Requests page, and a date note on each
  copy in the existing reply form. New English-only wording file `apps/web/src/i18n/evidence-answer.ts`.
- Tests: 19 service tests and 34 trust-rule tests against the real services on a migrated
  in-memory database; 79 screen tests in the new folder; the new form in the forms
  accessibility test (the existing one, which requires every form to be rendered in it); a browser spec that performs the journey before and after at 1280 px and
  390 px with real clicks.
- Existing behaviour changed: none. No existing exported function, route, access check or shared
  component changed its signature, return shape or behaviour. Additions to existing files: one card
  and one line on the Requests page, one optional date note in the reply form, `requestName` moved
  to its own file and re-exported from where it was.
- Migration: none. One later migration is specified in section 6 (pin a detail answer to the value
  that was accepted).
- Pull request: the one opened from branch `claude/fable-5-2-flagship-zypvhr` (its number and the merge are in the session's final message).

New English wording keys for the localization lane (all in `evidenceAnswer.*`, no Bengali written):
page.{title, back, allAgencies, unreadable, unavailable, emptyTitle, emptyBody, pickTitle,
pickSummary, reviewAnswers, agencyHeading, more, requestsLink}; receipt.{title, summary, facts,
factsWithFingerprint, reference, stateWaiting, stateAccepted, stateSentBack, stateClosed};
form.{groupReady, groupChoose, groupOther, doNotSend, version, added, expires, noExpiry,
documentDate, optional, reference, uncertainAge, uncertainDisagree, acceptedBefore,
acceptedBeforeUnknown, sendNone, sendNoneHint, send, sending, overLimit, consentShort, aboutSending,
aboutSendingBody, openRequest, addDocuments, aboutOther, and Short/Long pairs for otherOutdated,
otherNeedsNewCopy, otherNotChecked, otherMissing, otherOwnStep, otherNoAccess};
actions.{allSent, someChanged, noneSent, outOfDate, chooseOne, overLimit, failed, theAgency};
waitingCard.{title, one, agencyLine, action}; panes.askedBy; choices.{expires, expired}.

## 5. Proof of value

Measured by real clicks in a browser on the real components with made-up data and stand-in server
actions (the project's existing tier 1a harness). LOCAL. Not a signed-in run.

| Measure | Predicted before | Measured before | Predicted after | Measured after |
|---|---|---|---|---|
| Actions to send the three answers, 1280 px | 7 | 7 | 3 | 3 (1 to open the review from the card, then 2 measured on the review) |
| Same at 390 px | 9 | 9 (two of them Back) | 3 | 3 (same count as at 1280 px) |
| Presses of a Send button | 3 | 3 | 1 | 1 |
| Receiving agency named before the press | No | No | Yes | Yes |
| Expired card chosen in advance | Yes | Yes | No | No (on the new screen) |
| Missing letter visible without opening a request | No | No | Yes | Yes |
| Earlier acceptance shown | No | No | Yes | Yes |
| Agency actions per item | 1 review | not changed | 1 review | not changed |

Misses and limits, said plainly:

- The gain is in the traveller's effort only. The agency still reviews every copy one by one. No
  agency-side gain is claimed.
- A traveller with one waiting request gains no actions: they gain the agency's name and the date.
- The old reply form still chooses an expired only-copy in advance. It now shows the date beside
  it, but the default is unchanged (see section 6, item 3).
- Whether real asks often contain several held documents is a hypothesis. The better next target,
  if they do not, is candidate B (tell the traveller which answered requests and shares are
  affected when a document changes).
- Service behaviour (sending, pinning, refusal, receipt) is proven on the real services with a
  real database engine in memory, not through a signed-in browser. A signed-in browser run of this
  journey is UNVERIFIED until staging has accounts.

## 6. Safety

Checks built into the new step, each proven able to fail by breaking the real code once
(`TRUST-RULES.md`): owner only (an agency with a genuine grant is refused like a stranger); nothing
is sent to any agency but the one named; nothing is sent that the plan would not offer at that
moment (expired, replaced, archived, unsafe, of another kind, or already turned down by that agency
in any round); the exact reviewed version is the one pinned, and a newer upload between review and
press is not sent in its place; an ended share receives nothing; a repeat sends nothing twice, even
after the agency decided; the receipt is tied to the traveller and the agency.

The seven trust rules (34 tests, 12 random sequences of 40 steps across two agencies, including the
new step): all pass. Reviews: an independent critic before building; a code review (15 findings,
13 fixed, 2 answered in the decision log); a security review (no finding met its bar); a cleanup
review (applied); an accessibility pass (focus now moves to the result after sending; a hint when
nothing is ticked; names and descriptions said once); a wording pass.

Found in existing code, not changed here, for the owner's decision (each is a change to existing
access or sending behaviour, which this run may only propose):

1. The central access check answers "denied" for a real traveller record and "not found" for a
   made-up id. Three existing actions pass that difference to the screen
   (`section-actions.ts` twice, and the automatic document-kind suggestion). A signed-in stranger
   would need the traveller's internal id, which is long, random and never shown to others.
2. An accepted answer to a detail request is not pinned to the value that was accepted: the request
   keeps the detail's id, so a later change shows the new value. Fix: a small migration adding the
   accepted fact version to the request and the decision, written at send and at decision. The
   one-step send leaves details out for this reason.
3. On the existing request page, the copy an agency sent back is never marked and never offered a
   clearer-copy panel: the page reads the sent-back document from a field the decision clears.
   The same page chooses an expired only-copy in advance. Fix: read the turned-down copies from the
   decision history (the new service already does) and do not choose in advance a copy that is
   expired or was turned down.
4. One notice per answer per agency admin: a burst when many answers arrive together. Fix: one
   combined notice per confirmation, inside the existing sender.

Data use: nothing in the plan or the send uses a model. No new personal data is stored. The receipt
and the "accepted before" line are shown to the traveller only.

## 7. Commercial value

See `COMMERCIAL-NOTES.md`. In short: agencies would pay, per case or per seat, for clients who
arrive with a checked record and answer a whole ask at once; the traveller's side stays free because
it is what carries the record to the next agency. No payment claim is made: there is no payment
evidence. The cheapest test is a timed comparison with two or three pilot agencies and one question
afterwards. Caution: sending several answers at once is attractive in a demonstration; its recurring
value depends on real asks. The parts with certain recurring value are the agency's name before a
send and the date beside each copy.

## 8. Release state

Recorded in the pull request and in the session's final message (merge and deployment evidence
cannot be written into a file that is part of the same merge).

## 9. Next three actions

1. Owner: decide the four items in section 6 (each needs your word because it changes existing
   access or sending behaviour).
2. Owner: set up staging so LOCAL journeys become real signed-in proof: a staging deployment bound
   to the staging database, the pending migrations run there, three synthetic accounts (traveller,
   agency, unrelated agency) and their ids saved as the staging secrets that
   `docs/operations/staging-journeys.md` lists.
3. Build candidate B next: when a document changes, tell the traveller which answered requests and
   live shares now hold an older copy, without rewriting anything.
