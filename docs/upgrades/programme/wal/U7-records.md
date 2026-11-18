# U7 records: traveller screens on the Wallet foundation

Unit U7 (Wallet upgrade, signed-in traveller screens), Class B, presentation only. Branch claude/u7-traveller-screens. Guardian brief 18 Nov 2026. No service, policy, server action, permission or notification-delivery change. Made-up data only.

## What changed

| Screen | Change |
|---|---|
| `notifications/` | Each notification is one compact row: a bell picture (amber while unread), the subject, a New chip while unread, the date. The sentence, Open and Mark Read sit in the row body. Mark All Read, the three depth levels, the fixed-height scroll panel and Show More are unchanged. |
| `account/` | Signed In (with Sign Out), Language, Plan and Usage, Privacy (with the passkeys link), WhatsApp and Other Areas You Can Access are rows with a picture, one kind chip (Session, Preferences, Plan, Data Rights, Optional) and one line. The push card and the photo card are untouched (FIX9 owns them). |
| `privacy/` | Export Your Data, Delete Your Account, Consent History and AI Use Today are rows. Every confirm step, consequence wording and server action stays. A scheduled deletion opens its row by itself and stays at every depth. The empty consent history now has a working control (Open Permissions). |
| `help/` | The three guides, the five common questions and the four ways to reach a person are rows (answers and links in the body). |
| `applicants/` | One row per person (initials, name as the link, relationship chip; the whole row presses). Add a Traveller is one fold; it opens by itself when nobody is added yet, and the empty state links to it (or to where processing is turned on). Archived and Recently Deleted are rows with Open Record and Restore in the body. |
| `invitations/accept`, `client-invitations/accept`, `sharing-invitations/accept`, `trip-invitations/accept`, `contributor-requests/accept`, `trip-invitations/[id]` | A row says who is asking (picture, name, one chip). What is agreed sits in an open fold ("What You Agree To", "What Is Shared", "About This Request", "About This Trip") that the person may close. Accept and the consent steps are unchanged and always in view. |
| `trips/` | Group trips and joined trips are rows (flag or plane, title, travellers chip, destination). The empty state has Start a Group Trip (or Go to Home). On a trip: travellers, companions and shared documents are rows; Add Travellers and Add a Trip Document are folds that move focus to the first field. |
| `incoming/` | Shared files are rows with the real thumbnail (or a file mark) and a PDF or Photo chip; the progress lines are rows with a done, needs-a-look or waiting mark. |

Shared pieces: `app/app/u7-rows.tsx` (TravellerRow, TravellerRows, PersonPicture, AreaPicture, AcceptFold) and `app/app/u7.css`, built on the Expandable Section. Flat, brand tokens, no motion, forced-colours rule. The agency rows (U8) are separate; folding the two row kits into one is a follow-up.

## Review (Opus-class code review, high) and what was done

| Finding | Done |
|---|---|
| Links and redirects to `#delete-account`, `#large-export`, `#consent-history` landed on a closed row | New `OpenRowOnLink` (`u7-open-on-link.tsx`, on privacy and help): the fold that an address names opens on arrival and on a later address change. Tested; fails if the open line is removed. |
| The shared-files progress list lost its polite announcements | `TravellerRows live` puts `aria-live="polite"` back. |
| Help: the four contact routes (support email, WhatsApp, status) were closed | They are drawn open; the questions stay closed. |
| Help: old card rules hit the new rows (doubled padding, 3-column grid, 44 px links) | The old `help-questions` and `help-guide-grid` classes are no longer used; links in a row body keep the 44 px target in `u7.css`. |
| Sharing invitation: a bare date beside the sender | The chip reads "Access Ends" and the date. |
| Account: Other Areas You Can Access lost its card | The card is back. |
| Seed: asserted exactly two notices and ran the worker over everything | Each notice is sent by its own record id; the seed looks them up by subject. |
| Unread notifications need two taps (the row is closed) | Kept, as the Guardian's brief asks for compact rows. Open and Mark Read are one press into the row. A follow-up if the owner wants unread rows open. |
| Parity mark added to the shared row | By design (Guardian decision). |

Independent Opus review of 9725ae49 (Guardian 12): three findings and one ruling, all done.

| Finding | Done |
|---|---|
| Export Your Data stayed closed while a large export was waiting, running or ready (a time-limited download hidden) | The row opens by itself in those three states, like the delete row. Test: red on the old code, closed when nothing is waiting. |
| Two different empty titles on the trips page ("No group trips yet." and "No Group Trips Yet") | One Title Case key, `appTrips.appTripsU7.noGroupTripsYetTitle`, in both empty states (English and a Bengali draft). The sentence key stays where it is still used. |
| "Open Permissions" was English on a translated page | `appPrivacy.appPrivacyU7.openPermissions` (English and a Bengali draft). `privacy-locale.test.tsx` lists it among the known component-prop marking gaps. |
| Ruling: equal weight for Join and Decline on the trip invitation | Join and Decline are the same size and shape, side by side (a two-column answer row, `u7-answer`), Decline never smaller, hidden or a link. `trip-invitations/accept/accept-form.tsx` is touched by one CSS-only wrapper in `page.tsx`; no action, field or wording changed. Playwright checks the two buttons at 390 and 1280 on the real forms. |
| Sharing, client, contributor and agency accept screens have no Decline at all | Already on main, a behaviour gap (it needs a working decline action). Not changed here; on the Guardian's follow-up list. |

## Guards touched (approved in the Guardian's messages)

- `src/lib/ccd/inventory.ts`: one added selector, `[data-parity-text]`. Elements that carry real visible sentence text in a row's one-line summary wear the mark and count as text entries, so the parity guard still sees every sentence. Additive only. Tests in `src/lib/ccd/inventory.test.tsx`: a marked line counts; removing it makes the guard fail; no double count.
- `src/lib/ccd/parity-notifications.test.tsx`: two selectors only (rows are now `.u7-rows > [id^="notification-"]`).
- `apps/web/ci-signed-in/seed.ts`: one unread and one read in-app notice and one group trip, made-up, through the real service functions (the notice worker, then Mark Read). `routes.ts`: only the two `mustShow` lines of `/app/notifications` (now "Your Test Passport Was Read") and `/app/trips` (now "Japan Test Group Trip"). `/app/trips/[id]` is still listed as skipped there (its note says the seed made no trip); it can be switched on now by the unit that owns that file.
- `scripts/ui-ratchet.baseline.json` and `ui-ratchet.test.mjs`: inline styles 286 to 285, folds 189 to 184 (lowered only).

## New visible words

English only until the localization lane writes Bengali. Catalogue keys (one marked `WP-U7` block at the end of the English side of each file): `appClientInvitations.appClientInvitationsU7.whatYouAgreeTo`, `appContributorRequests.appContributorRequestsU7.aboutThisRequest`, `appSharingInvitations.appSharingInvitationsU7.whatIsShared`, `appTripInvitations.appTripInvitationsU7.aboutThisTrip`. The pages that are written in plain English in the page (applicants, privacy, help, trips, incoming) keep their new words there.

| English | Where | Bengali (draft) |
|---|---|---|
| What You Agree To | client invitation | আপনি যা মেনে নিচ্ছেন |
| About This Request | contributor request | এই অনুরোধ সম্পর্কে |
| What Is Shared | sharing invitation | কী শেয়ার করা হচ্ছে |
| About This Trip | trip invitation, joined trip | এই ট্রিপ সম্পর্কে |
| Add a Traveller | applicants | ভ্রমণকারী যোগ করুন |
| Turn On Processing | applicants empty state | প্রক্রিয়াকরণ চালু করুন |
| Open Record | applicants (archived) | রেকর্ড খুলুন |
| Open Permissions | privacy empty history | অনুমতি খুলুন |
| Add a Trip Document | trip | ট্রিপের নথি যোগ করুন |
| Add Travellers (fold summary) "Choose who else is going on this trip." | trip | এই ট্রিপে আর কে যাচ্ছে তা বেছে নিন। |
| No Group Trips Yet | trips empty state (no travellers) | এখনও কোনো গ্রুপ ট্রিপ নেই |
| Yourself, a family member or a child you look after. | applicants fold summary | আপনি নিজে, পরিবারের সদস্য বা আপনার তত্ত্বাবধানে থাকা শিশু। |
| Files Shared to VisaStack, Progress of Each File, Files Not Read | shared files (labels, title) | VisaStack-এ শেয়ার করা ফাইল, প্রতিটি ফাইলের অগ্রগতি, পড়া যায়নি এমন ফাইল |

## Keyboard and focus

- Add a Traveller, Add Travellers, Add a Trip Document and Delete Your Account move focus to the first field when a person opens the row (the shared `FocusFirstFieldOnOpen`); a row drawn open keeps the focus where it is.
- After a refused add the form's own `useFocusInvalidField` moves focus to the problem (unchanged).

## Screenshots

`u7-shots/after-{rows,forms,accept}-{1280,390}.png`: the shared pieces on the real stylesheet (the Playwright fixture). Before and after shots of the real signed-in pages could not be taken here (no Postgres for the made-up sign-in); the signed-in guard on the CI machine draws them.

## Tests

- Unit (parsed DOM, no regex on HTML): applicants rows, fold and both empty states; help rows; account and privacy through the parity guard; trips rows and chip; accept screens; inventory mark.
- Playwright `e2e/wallet/u7-traveller.spec.ts` on `e2e/fixtures/u7-traveller.fixture.tsx` (real stylesheet and the real Add a Traveller form): layout guards at the standard sizes, closed and open; notification row closed until pressed; a whole person row presses; fold starts closed and moves focus on open; axe on the open form; the accept fold is open and can be closed.

## Not verified

- Playwright wallet, scroll-budget and ux-public on one fresh build: 576 passed, 2 failed (`WP-SB2` real case page, phone Browse 3480 against a 3470 ceiling). The same two failed on U8's run and no file of this unit draws that page; not checked against main here.
- The signed-in guard itself (`apps/web/ci-signed-in/run.sh`) was not run here: this container has no Postgres. The seed sequence was proved on PGlite (notices through the worker, Mark Read, a trip through its real proof) in a throwaway test that is not kept; CI runs the real guard.
- The pages with real signed-in data in a real browser (only the shared pieces on the fixture, and the pages in unit render).
- Safari and Firefox (Chromium only).
- Bengali for the new words (draft list above).
