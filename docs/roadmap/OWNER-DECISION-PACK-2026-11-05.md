# Owner decision pack (prepared 5 Nov 2026)

You asked for the documents to be prepared so you only review and approve. Each item below has my recommendation, the exact wording or text to approve, and what happens next. Tick one box per item and reply "approved" in chat; I do the rest. Bangla and staff sign-in protection (MFA) are left out on your instruction.

How to read the boxes: **Approve** means build it as written. **Change** means write your change under the item. **Decline** means I take the alternative named under it.

| # | Decision | My recommendation | Needs |
|---|---|---|---|
| 1 | Exact copies of evidence sent to an agency (D1) | Approve as written | Your reading of one sentence |
| 2 | Checklist past its review date | Keep it usable, show "due for review" | One tick |
| 3 | Official pages as stand-in checklists | Do not offer; show a link with plain wording | One tick |
| 4 | The old test checklist "Visitor1" | Withdraw it | One tick |
| 5 | Landing page proof line | Option B | Pick one |
| 6 | Where the site and database run | Measure first, then decide | Nothing yet |
| 7 | First launch routes and a qualified reviewer | Two routes, one named reviewer | Names |
| 8 | Privacy notice and terms | Send the counsel pack | A lawyer |
| 9 | Recovery drill | Run once before real data | A sign-off |
| 10 | Master key copy and rotation | Offline copy now, key service next | Your copy and an AWS account |
| 11 | Words on desktop screens | Start every desktop screen at Glance | One tick |
| 12 | Instant "back" navigation | Do it after an audit of 46 actions | One tick |
| 13 | Installing the phone app | Use the Install app menu item | You test it |

## 1. Exact copies of evidence sent to an agency (D1)

**What it is.** When a traveller sends a file to answer an agency's request, the agency can download that exact copy for as long as the agency still has access to the traveller's records. This is true even if the agency's grant does not list "Download Originals". Later changes to the file are not sent.

**Why it needs you.** It is a statement about what a traveller agrees to by pressing Send, and it departs from the rule that every action is granted exactly.

**The line a traveller sees now (28 words):**

> Sending lets the agency download this exact copy while it has access to your records. Later changes to the file are not sent.

**Short form beside the button (11 words):**

> The agency can download this exact copy while it has access.

**Recommendation: approve.** The traveller chose to send that file to that agency, and the agency needs the file to do the work. The wording says what happens and for how long.

**If you decline:** I stop serving accepted copies, so an agency can only open a copy while it waits for a decision, or I require "Download Originals" on the grant. It is a small change and I would do it the same day.

- [ ] Approve as written
- [ ] Change the wording to: ______________________
- [ ] Decline, and require "Download Originals"

## 2. A checklist past its review date

**Now:** it stays usable and says it is due for review.
**Alternative:** hide it until it is reviewed again.
**Recommendation: keep it usable.** Hiding it stops an agency's work over a date, and the note already warns them.

- [ ] Keep usable with the note
- [ ] Hide until reviewed

## 3. Official pages as stand-in checklists

**Now:** registered official pages are not offered as a stand-in checklist, because they are registered, not verified.
**Alternative:** show the link beside the case with the words "Official page. VisaStack has not checked it."
**Recommendation: show the link with those words.** It helps the traveller and claims nothing.

- [ ] Show the link with those words
- [ ] Offer nothing

## 4. The old test checklist "Visitor1"

Two items, review overdue, unused. It can no longer be attached or picked once withdrawn.
**Recommendation: withdraw it.** It is a test and can mislead.

- [ ] Withdraw
- [ ] Keep

## 5. Landing page proof line about agency usefulness (VS-016)

Nothing on the landing page changes until you pick. Each line is a plain statement of what the product does, with no number we cannot prove.

- A. "Agencies see what is missing before a case reaches them."
- B. "One traveller profile, so agencies stop asking for the same documents twice."
- C. "Agencies work from a ready file, not a pile of attachments."

**Recommendation: B.** It is true today and it is the reason an agency would care. I check the landing scroll budget before it ships.

- [ ] A   - [ ] B   - [ ] C   - [ ] Mine: ______________________

## 6. Where the site and database run

**Today:** both in US East. From Bangladesh or Singapore each trip to the server costs about 0.3 seconds before any work starts. The tap feedback (the tapped link lights up at once and a thin bar runs along the top) removes some of what a person feels, not the wait itself. Keeping a shown page for a short time so going back is instant is possible, but needs an audit of every action that refreshes late first.
**Option:** move both to Singapore. It is a real migration (database copy, a short freeze, sign-in settings) and I would plan it with a rollback.
**Recommendation: decide after we measure the real server time.** Needs Vercel runtime logs, so I need Vercel access reconnected.

- [ ] Measure first (recommended)
- [ ] Plan the move now

## 7. First launch routes and a qualified reviewer

No UK or other route checklist has been written, on purpose. A qualified adviser must write or check it against current official sources.
**Prepared for them:** the reviewer brief in `docs/roadmap/ROUTE-REVIEWER-BRIEF.md`: what each checklist holds, the questions to answer per item, where each answer must come from, and a sign-off line.
**You:** name the one or two routes your first agencies file most (for example Bangladesh to UK Standard Visitor) and one reviewer who is not the author.

- Routes: ______________________
- Reviewer: ______________________

## 8. Privacy notice and terms

The pack for your lawyer is ready: `docs/legal/2026-10-26-small-commercial-v1-changes-for-counsel.md`, with the AI section draft in `docs/legal/privacy-notice-ai-section-draft.md`. Send both and return the approved wording. Real data stays off until then.

- [ ] Sent to counsel on: ______________________

## 9. Recovery drill

The procedure is in `docs/operations/recovery.md` (restore drill). The database-only restore passed; documents and the full lifecycle are not yet proven. The sign-off sheet is `docs/operations/restore-drill-signoff.md`.
**You:** say "run the drill" and I run it in a throwaway environment, then fill the sheet for your signature.

- [ ] Run the drill

## 10. Master key copy and rotation

Protected fields (passport numbers, incomes) are wrapped by one key held in Vercel. There is no second copy and no rotation tool yet.
**You, now:** copy the value into your password manager and keep a sealed paper copy elsewhere. Never paste it into chat or the repository.
**Next:** an AWS account for the key service (O16), then I build rotation with a rehearsal.

- [ ] Offline copy done on: ______________________
- [ ] AWS account ready

## 11. Words on desktop screens

**Today:** every phone screen is held to 30 words of explanation, and so is Documents on a desktop. On the other desktop screens the default level is Browse, which shows more. Measured on made-up data, 37 desktop states are over 30 words (the busiest: the agency member home at 182, expiry at 154, evidence requests at 136, the notifications list at 99).
**Why not just change it:** Browse is the level the approved mockups show, and your latest instruction says the mockup composition rules the screens.
**Options:**
- A. Start every desktop screen at Glance, as phones do. Browse is one tap away and each screen remembers the choice. Every screen is then within 30 words by default. It is a small change, and reversing it is as small.
- B. Keep Browse as the default and trim the words state by state (move sentences behind "About This"). It keeps the mockup look but is a larger job, about 12 screens.
**Recommendation: A.** It follows your 30-word instruction on every screen at once, and the people who want more tap once.

- [ ] A   - [ ] B   - [ ] Leave as it is

## 12. Instant "back" navigation

Keeping a page the browser has already shown for 30 seconds makes going back instant. I did not turn it on, because 46 actions (archive, replace, delete, trip changes, refunds and others) rely on the page refreshing later, so a kept page could show an old list right after you changed something.
**Plan if you approve:** make each of those 46 actions refresh the workspace when it succeeds, add a test that fails when an action that changes data forgets to, then turn the 30 seconds on. List of the 46: in the known-issues entry of 6 Nov 2026.
**Recommendation: approve, after item 6 is measured,** so we know how much of the wait this removes before spending the time.

- [ ] Approve
- [ ] Not now

## 13. Installing the phone app

Your report: after signing in, the installed app looks like a desktop browser. The code keeps sign-in inside the site (no jump to another address), the app is set to open full screen, and a service worker is present. The most likely cause is that the app was added as a shortcut, not installed. A shortcut opens in a browser tab and draws its icon on a white disc, which is what you saw.
**Test (two minutes):**
1. Remove the old icon from the home screen.
2. In Chrome, open https://vs.obsidianglobal.studio.
3. Open the Chrome menu and choose **Install app** (not "Add to Home screen"). If only "Add to Home screen" is offered, tell me and I will check the install conditions.
4. Open it from the new icon and sign in. It should open full screen with no address bar.

- [ ] Tested on: ______________________   Result: ______________________

---
Approved by: ______________________   Date: ______________________
