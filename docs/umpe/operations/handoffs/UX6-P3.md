# UX6 package 3: travelling with someone else (the invitation email and the accept page)

Scope: the invitation email, the organiser's server-side send, and the accept page. No companion pages beyond accept (a list of invited trips, the read-only trip page, Plan My Own Case are package 4). Nothing was pushed, no pull request was opened, no migration was run, nothing was checked against production. The switch `UMPE_TRIP_COMPANIONS_ENABLED` stays off in production and this package does not turn it on.

## What was built

| Area | What | Where |
|---|---|---|
| Email kind | A new `companion` kind through the existing invitation email path: event `TRIP_COMPANION_INVITATION_CREATED`, subject, summary, link path `/app/trip-invitations/accept?token=...`, deep link, and the reveal pattern (43 URL-safe characters). The link is sealed with AES-GCM through the key service, so the outbox never holds a usable link. A new optional `issue` becomes the notification's threshold, so Send Again is a new email and not a duplicate of the first. | `packages/services/src/invitation-email.ts` |
| Email words | Plain, short, Title Case button. Says a person added them to a trip, that opening the link joins nothing, that they choose whether to join and what to share, that nobody gets access to their documents, and that the link lasts 7 days. Never the organiser, the trip, the route or anyone else. | `email-design.ts` (`NOTIFICATION_EMAIL_COPY`), `email-design.test.ts`, `apps/web/src/app/app/admin/email/labels.ts` (staff label "Trip Companion Invitation") |
| Queue | `queueCompanionInvitation(proof, { tripId, companionId, invitation, encryption })`. Owner proof of the organiser, then one transaction: the row must still be INVITED on a trip this account owns, unexpired, and hold both the address and the token hash of the delivery (so a stale link is refused). Older waiting emails for that person are cancelled, then the sealed email is queued. Returns only "queued". | `umpe-trip-companion-email.ts`, exported from the services index |
| Send-time check | The worker re-reads the row before sending: switch on, still INVITED, unexpired, address unchanged; otherwise the email is marked failed ("recipient no longer authorized") and nothing is sent. Reads the row's own columns only, never an account by address. | `access/trip-companion-access.ts` (`companionInvitationStillDeliverable`), `notifications.ts` (`checkRecipient`, link kind) |
| Organiser send | The two places that dropped the raw invitation now send it on the server: `makeCompanion` (Add Someone Else, both forms) and `resendCompanionAction`. The link goes service, then sealed outbox, and is never returned. The email itself goes out right after the response (`after`, then `sendEmailNow`), so the wait never depends on the address or the mail provider, and the organiser is never told about delivery, a bounce or an account. A step that fails keeps the person on the trip: the form redirects with a fixed notice ("Added to the trip, but the invitation could not be sent just now. Try Send Again beside their name.") and Send Again says "The invitation could not be sent just now. Try Send Again in a moment." | `apps/web/src/app/app/trips/actions.ts`, `trips/[id]/page.tsx` |
| Organiser words | Send Again now says "A new invitation is on its way. It lasts 7 days." The form hint now reads "With an email, they are invited to join and choose what to share with you." (it was untrue for a name alone). | `trips/actions.ts`, `trips/trip-forms.tsx` |
| Accept page | `/app/trip-invitations/accept`. 404 while the switch is off. Opening it only shows the trip basics (trip, where, why, when the invitation ends), the one plain promise ("Joining shows your name to others on this trip. Nobody gets access to anyone's documents."), the name box (as the organiser typed it, editable, 1 to 120), Name Only already chosen, Plan Status and Travel Bookings behind one quiet Share More, Join the Trip, and a separate Decline. Without the account's core consent it shows the one consent step and still offers Decline. | `apps/web/src/app/app/trip-invitations/accept/` (`page.tsx`, `accept-form.tsx`, `core-consent.tsx`, `actions.ts`, `network-limit.ts`, `words.ts`) |
| After answering | Joined goes to `/app/trip-invitations/accept?done=joined` ("You Joined the Trip", the trip title, a My Trips link; it shows only if the account really has a joined trip). Declined goes to `?done=declined` ("Invitation Declined", nothing shared). No link is in either address. | same |
| Refusals | A missing, malformed, expired, used, declined, removed or wrong-email invitation, and a signed-in person with another address, all render one "Invitation Unavailable" page with one sentence and a "Sign In with the Invited Email" link. Every kind of "too many tries" (the network address limit and the account limit) is one fixed sentence, for a real link and a made-up one alike. | `page.tsx`, `words.ts` |
| Rate limit | The existing `INVITATION_PREVIEW_IP` limiter under its own action name (`trip_companion.preview_ip`), keyed by the hashed network address, counted on the page and on both answers, plus the service's per-account attempt limit. | `network-limit.ts` |
| Styles, maps | One new block `WP-UMPE-UX6-P3` at the end of `globals.css` (flat, tokens only, 44 px choices and summary). Parity map: `/app/trip-invitations/accept` is reached by email, pinned to the link path in `invitation-email.ts`. The three new client forms are in the accessibility scan list. | `globals.css`, `lib/experience-parity.ts`, `lib/a11y-forms.test.tsx` |

## The email, as rendered

Subject: You were added to a trip on VisaStack

Heading: Someone added you to a trip. Body: "Someone added you to a trip on VisaStack. Open the link, then sign in or create an account with this email address. Opening the link joins nothing. The link lasts 7 days." Then: "You choose whether to join and what to share. Nobody gets access to your documents." Button: Open Your Invitation. Footer line: "Not expecting this? Ignore this email and nothing happens."

## Decisions where the brief was silent

- The send is queued after the person is saved (the service's own transaction has committed), not in the same transaction. The cost is a window where the row exists with no email; that is exactly the "send failure" case and the organiser sees Send Again. The benefit is that the services stay unchanged and the key service is never called inside the person's own transaction.
- The email is sent with `after(...)` and not awaited, and its result is ignored. The brief said "queueInvitationEmail then sendEmailNow as the sharing flow does"; the sharing flow awaits the outcome and tells the owner whether it went. For companions that would show the organiser provider answers for an address they typed, so the outcome is deliberately not shown. The waiting-email backstop and the worker retry anything that did not go out.
- Resend for a person who declined (which the service answers exactly like one still waiting, sending nothing) still asks the key service for one key and drops it, so the time taken does not tell the organiser that person declined. This equalises the key service call only; see Not verified.
- The accept page and both actions use the signed-in account only (`withSession`); a form field never names the account.
- Join and Decline are separate forms with their own actions, so the name box is never needed to say no. "Confirmed POST" is a server action (POST only) that also needs the pressed button's own value (`intent=join` or `intent=decline`).
- The name is sent to the service as a change only when it differs from what the organiser typed, so the audit row's `renamed` flag is true only when it really was.
- Travel Bookings is offered as the brief asks, but until package 4 it stores the choice and shows the organiser nothing more. The sentence "You can change this, or leave the trip, at any time" is true of the service; the screens to do it are package 4. The switch should stay off until package 4 has them.
- A queued invitation whose switch is off at send time is marked failed for good (not retried); once the switch is on again the organiser uses Send Again.
- The page keeps the link in the address while it is open (as the sharing page does), with `referrer: no-referrer` and no indexing. The "Sign In with the Invited Email" link carries it only when it has the exact shape of a link.

## Tests

| File | What it proves |
|---|---|
| `packages/services/src/umpe-trip-companion-email.test.ts` (14, real database) | One sealed email queued; the outbox holds no usable link; the sealed value opens only as this kind for this invitation. The sent email holds the link and the plain words and none of the organiser, trip, route, names or ids, no long dash, no "mission". The emailed link accepts end to end. Send Again is a new email with only the newest link; the old link stops. Stale link, other address, another organiser, wrong trip, used, removed, switch off and malformed id are refused. At send time: joined, declined, removed, lapsed, re-addressed, switch off and row gone each send nothing and mark the email failed. The same email for an address with an account and one without, and no query reads an account by address. |
| `packages/services/src/email-design.test.ts` | The new event type is in the list of every email kind and passes the wording rules. |
| `apps/web/src/app/app/trip-invitations/accept/accept-actions-database.test.ts` (20, real database) | Join needs the join button; the invited verified account only; name kept or changed and the audit says which; name bounds; share level from the three listed values (Name Only when none), anything else refused; consent first; no account and no applicant made. One refusal for unknown, malformed, used, declined, removed, lapsed, wrong-address, unverified, the organiser's own account, a second use, and the switch off, for both answers. Decline works without a name or consent. The network address limit and the account limit give the same fixed words; only a short hash of the address is stored. Nothing said back holds a link, an address or a stored hash. |
| `apps/web/src/app/app/trip-invitations/accept/accept-page-database.test.tsx` (13, real database) | The page shows the basics and the promise once, Name Only chosen, the rest inside Share More, one join and one decline button; nothing about the organiser, other people or any address; opening never joins; the consent step; no inline style, long dash or "mission". Every bad invitation renders the same page (compared as markup), including the right link on the wrong account; one fixed too-many-tries page; 404 for every link and the answered pages with the switch off; a missing table reads as unavailable; the joined and declined pages. |
| `apps/web/src/app/app/trips/companion-actions-database.test.ts` (+6, now 30) | The invitation is emailed from the server (one sealed message, one send, the raw link nowhere in the outbox or in any answer); no email for a name alone; a missing key service or a failing provider keeps the person and says so; Send Again queues the newest only; a person who declined gets the same answer as one waiting and nothing sent. The existing "nothing sent back holds the address or link" checks run over every answer. |
| `lib/a11y-forms.test.tsx`, `trips/trip-forms.test.tsx` | The three new forms are scanned in four states; the hint words changed. |

## Proven red (break the real code, watch the named test fail, restore)

| Guard broken | Tests that went red |
|---|---|
| Worker always authorizes a companion email | joined, declined, removed and lapsed send-time tests (7 failures in the file) |
| Send-time check ignores the invited state | declined send-time test (joined and removed also clear the link and lapse time, which the check reads, so that layer is covered twice) |
| Send-time check ignores expiry, the address, or the switch | the lapsed, the re-addressed, and the switch-off send-time tests, one each |
| Queue accepts a stale link (token hash condition removed) | the stale and refused-cases test |
| Queue ignores the trip owner | the same test |
| Send Again does not cancel the older email | the Send Again test |
| Send Again drops its issue key (swallowed as a duplicate) | the Send Again test |
| Email carries the organiser name and route | the plain-words test |
| Email match removed in the proof | one-refusal test, wrong signed-in account test |
| Join button check removed; decline button check removed | "is not a join unless...", "is not a decline unless..." |
| Page switch gate removed | the 404 test |
| Generic refusal broken (own words for a missing invitation; different page words for a well-formed link) | six action tests; the page's same-page test |
| Link put in the join redirect | nine action tests |
| Network address limit removed | the fixed too-many-tries test |
| Share level taken as sent; name bounds removed | the share level test; the name test |
| Link or address appended to the Send Again answer | Send Again, declined-equals-waiting, and the never-holds tests (3 and 4 failures) |
| Person removed when the invitation cannot be queued | both "keeps the person" tests |

Layered, so one layer alone stays green by design: the switch check at the top of the accept and decline actions (the service and the access proof refuse again, which is why the same test stays green when only the action's check is removed).

## Not verified

- No browser run, no real keyboard or screen reader check, no design review, no real email: the mail provider and key service are test doubles. Nothing was checked on the live site.
- The invitation was never sent through the real worker on a schedule; only the in-process worker with a fake provider. The waiting-email backstop (`sendWaitingEmailsSoon`) is relied on to retry an email that did not go out right after the response; that was not exercised here.
- Timing: the declined resend path now makes one key service call like a live resend does, but a live resend also writes the new link and an audit row and a declined one does not, so the times are close, not equal. Nobody measured them. The service's own choice (a declined person reads as still waiting) is why this matters.
- A person with no account who is sent a link and is not on the pilot invitation list may be stopped at the pilot gate after signing up (the pilot check reads its own invitation table, not companion invitations; it is bypassed in development and in the open public beta). Not checked against the live setting; the owner should confirm before the switch goes on.
- The Plan Status phrase and Travel Bookings are described on the screen as the design says; the organiser's view of Travel Bookings is package 4.
- Concurrency (two Send Agains at once) is protected by the single-row update and the unique key but has no parallel test.

## Security notes for the second reader

- Look at `deliverInvitation` and `makeCompanion`/`resendCompanionAction` in `trips/actions.ts`: the only place the raw invitation is used. It goes to `queueCompanionInvitation` and nowhere else; the action results are fixed words. The tests collect every answer and redirect and search them.
- `queueCompanionInvitation` is the only writer to the outbox for this kind, and it checks the live row (state, expiry, address, token hash, trip owner) in the same transaction as the write.
- `companionInvitationStillDeliverable` is the send-time gate. It must stay a pure read of the row.
- The accept actions never decide who the person is from a form field: the account comes from the session, and the invitation is opened as that account (verified email must match). Rate limits count before the invitation is looked at.
- The `Unavailable` page puts the link in the sign-in return address only for a link of the exact shape; anything else is dropped, so nothing typed into the address is echoed into the page.
- The notification worker's failure text for a refused send is the shared "recipient no longer authorized"; staff see the kind label "Trip Companion Invitation" and the address on the Email Delivery page like every other invitation.
- Staff can see an address on that page (existing behaviour for all invitation emails).
