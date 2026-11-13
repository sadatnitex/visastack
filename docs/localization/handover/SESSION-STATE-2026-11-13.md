# Bengali localization: state at hand-over (13 Nov 2026, about 14:45 UTC)

Written by the coordinating session when the work moved to fresh sessions. It says where things stand; the pull requests themselves and `docs/commercial-v1/known-issues.md` are the evidence. The files beside this one are the working notes: `REVIEW-HANDOVER.md` (the independent reviewer's findings and follow-ups, numbered, oldest first), `WAVE-BRIEF.md` (the rules for screen work) and `SERVICES-BRIEF.md` (the rules for service refusals). Paths in those notes that start with a scratchpad folder pointed at a machine that no longer exists.

## Where the Bengali stands

- Measured on main 5abf305: 2,144 of 2,871 screen messages have Bengali (75 percent). Service refusals: 370 keys shown in Bengali by tests.
- About 350 of the remaining screen messages stay English on purpose: official visa rules, fees, requirements and processing times; invoice and receipt record content; staff and admin screens; wording held for a content reason (`HOLDBACK` in `scripts/i18n/register.mjs`); and keys held for a technical reason (`scripts/i18n/refill-holds.mjs`, listed with reasons in `docs/localization/data/REFILL_LEFTOVERS.md`).
- Emails stay English.

## Merged on 12 and 13 Nov (newest last)

#511 to #546 (runtime, language switch on, screen waves, marking passes, services plumbing, first drafts), #559, #560 (release of signed-off legal, consent, privacy and payment wording), #561 (landing page), #562 and #563 (drafts G and H), #564 (service refusals refilled), #565, #568, #569, #573 (refills 1 to 4), #567 (removal screens), #570 (trips, guest desk, Home and answer review refusals), #574 (key holds), #575 (Answer from Your Records, plural messages from key drafts), #578 (a clock-dependent test). Not localization but merged by this lane: #566 (agency reads check the person acting), #571 (one refusal for every reason at the access gate).

## Open when this was written

| Pull request | What | State |
|---|---|---|
| #572 | Refusals on the traveller record, invitations, privacy, account, guest upload | Passed review; waits for green checks on its head |
| #576 | Starter country lists and intake corrections (owner's research) | Passed review; waits for a merge of main and green checks |
| #577 | Refill 5: the case screens | In review |
| #579 | Refill 6: shared component states | In review |
| refill 7 (branch `claude/magical-curie-3p4qcx-refill-7`) | 71 deferred traveller-record keys, about 36 document-management keys, 54 staged drafts | Being built |

## Owner decisions in force

- The language switch is on. Bengali is in progress, not complete.
- Blanket sign-off on held legal, consent, privacy and payment wording (12 Nov). It is recorded as blanket, never as reviewed by a person.
- Stay English: official visa rules, fees, requirements and processing times; invoices and receipts; staff and admin screens; emails.
- Words: case is ভিসা ফাইল; box is বক্স; page is পাতা; a document's version is কপি (সংস্করণ only for a product, release, snapshot, pack or name version). Bengali digits in prose; the ISO currency code beside amounts.
- No pull request merges without an independent review pass, plus the three required checks and CodeQL green on the exact head.
- Never write Bengali into a catalogue by hand: it comes from register rows or key drafts that pass the automated checks, through `node scripts/i18n/codemod.mjs --refill-bn`.

## Waiting for the owner

1. "Public Trust" in the landing footer: held so the page never carries two names; a draft (পাবলিক ট্রাস্ট) matches the page's own link.
2. The removal sentence about a copy kept for a legal requirement (`copyKeptLegalHold`): new legal wording, held in English.
3. Four wordings that guard tests keep in English: the sign-in-with-another-app screen, the calendar link privacy line, the evidence "who can read this" warning, the payment purchase line.
4. "View Plan" and "View Privacy Details": drafted, but payment and privacy wording needs a register row under the sign-off, not a key draft.
5. Whether an agency should see the text of a detail answer or only the saved version it reviewed (built: the second).
6. Country research: correction C13 (Australia), the 38 missing and 41 similar official items for eight unchanged countries, and the choices in the extended-purposes design note.

## Still to do

1. Merge the open pull requests above, each after review.
2. A drafting batch for what has no passing draft: the six service keys whose placeholder names differ from the register, four `suggestions.*` service keys, two time zone hints, "Payment Reports" and "Suggest Boxes" (loose wording), the key names Shift and Delete (should stay in Latin letters), `components.capturePreview.isTheWholeCardOrPage` (uses পৃষ্ঠা, should be পাতা), and the sentences that interpolate English-only words (they need the code to pass whole sentences first).
3. Call-site fixes that unlock held keys: dates formatted without the reader's language, English values inside Bengali sentences, buttons whose spoken name differs from the visible text, the guest checklist page (13 keys), the profile photo screen's own early checks.
4. The marking pass: Bengali passed as a plain string (titles, labels, placeholders, server messages) carries no language mark while the page itself is marked English. Tests pin the known lists so they can only shrink.
5. The one-answer refusal line for a record that is not yours stays English everywhere; translate it deliberately, keeping one answer.
6. A census refresh, so register rows fit the current code (placeholder names, plural messages) and the key-draft fallback is needed less.
7. Records: requirements ledger rows, and the final deliverables (completion ledger, translation quality report, engineering report, parity report, owner approval queue, activation gate, experience summary).
8. A signed-in browser pass under Bengali: nothing here was checked in a signed-in browser. The owner runs it with `docs/operations/signed-in-check-prompt-2026-11-13.md`.

## Pitfalls learned

- Never re-run CI on an old head of an open pull request: the run on the newer head is cancelled.
- A test that counts against an hourly limit must hold the clock (`vi.useFakeTimers({ toFake: ['Date'] })`); a run across the top of an hour failed once.
- The machine is shared: one heavy job at a time; a full disk or a killed worker is not a test failure, and the run must be repeated alone before saying anything about it.
- Unpushed commits are lost when a container restarts. Push verified work early.
- The review and security-review helpers read the main checkout unless given a branch or pull request number as the target.
- `verify-english` must take its snapshot and its comparison in the same worktree.
