# UX6 package 2: travelling with someone else (organiser screens)

Scope: the organiser's web layer only. Add Someone Else in the two trip forms, and Travelling with You with Remove and Send Again on the trip page. No email is sent (package 3), there is no accept page (package 3) and no companion pages (package 4). Nothing was pushed, no pull request was opened, no migration was run. The switch `UMPE_TRIP_COMPANIONS_ENABLED` stays off in production, and with it off (or the table missing) every page looks exactly as it does today.

## What was built

| Area | What | Where |
|---|---|---|
| Visibility | The page asks `tripCompanionsAvailable(db)` (switch on and table present: the service's own readiness rule, exported for this) and hands the answer to the forms and the overview as `companionsOn`. Client code never reads the environment. Missing or false hides everything new. | `trips/new/page.tsx`, `trips/trip-data.ts`, `trips/[id]/page.tsx` |
| Add Someone Else | A quiet secondary button beside Add a Family Member in Start a Group Trip and in Add Travellers. It opens in place: Name (required, 120) and Email (optional, `type="email"`, autocomplete off), one hint line. Focus moves to the name; Cancel returns focus to the button. The open state is lifted so the submit button logic stays right. A shared hook `useOpenSection` now serves both sections. | `trips/trip-forms.tsx` (`SomeoneElseFields`) |
| Add action | `readNewPerson` reads `newPersonName` and `newPersonEmail` (the fields exist only while the section is open). The name uses the service's own rule and wording. The feature check and the trip and ticket checks come before anything is made. On an existing trip the person is added last (after family members) with the organiser's MANAGE proof of one of the trip's own travellers. On the start flow the person is added after the trip and the family members; if that step fails the trip is kept and the organiser lands on `?done=partial-someone`. | `trips/actions.ts` |
| Trip list | "Travelling with You", shown only when the feature is on and there is at least one person. Each row: name, one state word (Not on VisaStack Yet, Invited, Invitation Expired, Joined), for Joined a quiet "Shares Name Only / Plan Status / Travel Bookings" and, for Plan Status, the service's phrase after a colon. Then Send Again (Invited or expired only) and Remove, both quiet secondary buttons with spoken names that include the person. | `trips/trip-overview.tsx` (`TripCompanions`), `RemoveCompanionForm`, `ResendCompanionForm` in `trip-forms.tsx` |
| Remove, Send Again actions | `removeCompanionAction` (redirect to `?done=removed-someone`) and `resendCompanionAction` (answers in place). Both prove the trip as the organiser's own, then call the service and show its words. | `trips/actions.ts` |
| Services index | Exports added: `tripCompanionsAvailable`, `isEmailAddress`, `COMPANION_NOT_SWITCHED_ON`, `COMPANION_NAME_PROBLEM`, `cleanCompanionName`. Two constants in the service file were exported (no behaviour change). | `packages/services/src/index.ts`, `umpe-trip-companions.ts` |
| Styles | One new marker block `WP-UMPE-UX9` at the end: a wrapping row for the two buttons and a row for a person's actions. Flat, tokens only, no inline styles. | `apps/web/src/app/globals.css` |

## Decisions where the brief was silent

- No "Manage" disclosure: the existing traveller rows show their Remove inline, so the companion rows do the same. The trip rows reuse the traveller card classes.
- Remove has no confirmation step: the existing "Remove from Trip" has none either.
- The service also reports an expired invitation (and shows a declined one as waiting, then expired). That row reads "Invitation Expired" and offers Send Again.
- State words follow the app's Title Case rule: "Not on VisaStack Yet" (the brief wrote "yet").
- The trip page notices after a redirect are fixed words: `added-someone` ("Added to the trip."), `removed-someone`, `partial-someone`. A refusal on a redirect path cannot show the service's own sentence, so after a failed add on the start flow the notice is generic and the organiser retries from the trip, where the service's words do show in the form. When both a family member and a person are added the existing `added` notice is used.
- A bad name or address (and the feature being off) is refused before the trip or any family member is made, using the service's own wording. A refusal that only the service can know (own address, same address twice, the 20 cap, rate limit) can only come after the family members exist; the form then shows the service's words and the already made family member is ticked as before.
- Send Again says "A new invitation is ready. It lasts 7 days." It promises no email. Package 3 should change this to say it was sent once sending exists.
- The service words go to the browser unchanged. Only the consent refusal gets the existing pointer to Home. The field marked invalid for an "invalid" refusal is the email when the sentence mentions email, otherwise the name.
- The hint line and the legend are tied to both fields with `aria-describedby`.

## Tests

| File | What it proves |
|---|---|
| `trips/companion-actions-database.test.ts` (20, real database) | A name alone is added as Not on VisaStack Yet with no invitation. A person with an email is invited and nothing sent back (redirects and results, all collected) holds the address, the raw link (captured by wrapping the service) or the stored hash. A family member and a person together. Empty, long and malformed input refused and nobody made. Feature off: the service words, no trip and no family member made. Failure after the trip exists keeps the trip. A forged id, a garbage id and another account's trip add nobody and make no family member. A duplicate address in the service's words. Remove works and clears the address. Send Again works for an invited person only (not a name alone, not someone who joined). The rate limit answer is the service's words. Remove and Send Again refuse in the service words while off. |
| `trips/companion-page-database.test.tsx` (4, real database, `renderServer`) | The trip page read from the database and rendered with one person of each state: names, one word each, one Send Again, three Removes, no address, no link, no hash anywhere in the page. The start form renders the button. Feature off: nothing new. Table missing: nothing new. |
| `trips/trip-forms.test.tsx` (+10) | Both buttons closed by default and sending nothing. Not rendered when off or when no answer is given. Opens to a required name and an optional email with the hint. Spoken names. Focus moves on open and back on Cancel. Both sections open together. The email is marked invalid and focused when the action says so. The one submit button names what is being added. |
| `trips/trip-overview.test.tsx` (+8) | States, share words, Send Again only for invited or expired, spoken names, no address or link or token, no link in a row, state in words, nothing when off or empty, identical to before when told nothing. |

Existing tests were updated only where needed: the action mock lists the two new actions, and `lib/a11y-forms.test.tsx` has two new entries (Send Again and Remove) because it requires every exported form to be scanned. The first whole-suite run found two failures from this package (the scan list, and the heading "Travelling With You" which the Title Case rule wants as "Travelling with You"); both were fixed and those files re-run green. The whole suite was not run a second time.

## Proven red (break the real code, watch the named tests fail, restore)

| Guard broken | Tests that went red |
|---|---|
| Trip ownership: the service's `ownedTripId` alone | none (the action layer also refuses: defence in depth, so one layer alone stays green) |
| Trip ownership in the action (`tripExists` and the trip check in `organiserProof`) together with the service's | forged trip id; another account's trip |
| Switch gate in the service readiness rule | all three "feature is off" tests |
| Switch gate, action pre-check only | "feature off makes no trip and no family member" |
| Never return the link: the link appended to the Send Again message | Send Again test and the "never holds a link" test |
| Never return the address: the address appended to a refusal | duplicate address test and the "never holds" test |
| Name-only path: a placeholder address sent when none is typed | name-only test and the Send Again test |
| Form switch gate (`companionsOn` ignored) | off and no-answer render tests |
| Overview gate dropped, and Send Again shown to everyone | off test and Send Again test |
| Focus return on Cancel | the focus tests (family and someone else) |

## Not verified

- No browser run (no real keyboard or screen reader check); no design review or accessibility audit was run, only the markup assertions above.
- No real email: nothing is sent and the returned invitation is dropped in `makeCompanion` and `resendCompanionAction` (code comments point to package 3).
- Concurrency of two adds at once on the live database (the service locks the trip row; not exercised here).
- The migration is still not run on Neon; the migrate word for 0130 is still needed.

## Security notes for the second reader

- Look at the two places the raw invitation is dropped (`makeCompanion`, `resendCompanionAction` in `trips/actions.ts`). Package 3 must send it on the server only.
- Results to the browser are fixed words only. No code path puts an address into a message; the tests collect every result and redirect and search them.
- Rate limit and refusal words are the service's, identical for every address. The only wording that depends on input is the invalid-address and duplicate messages the service already returns for the organiser's own typed input.
- The proof for adding, removing and resending is the owner proof of one of the organiser's own travellers on that trip; the service re-checks the trip belongs to that account.
- `isEmailAddress` is now exported from the services index (it was internal); it is the same pattern the invitation paths use.
