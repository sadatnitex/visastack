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

**Today:** both in US East. From Bangladesh or Singapore each trip to the server costs about 0.3 seconds before any work starts. The tap feedback and the 30 second page memory remove most of what a person feels.
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

---
Approved by: ______________________   Date: ______________________
