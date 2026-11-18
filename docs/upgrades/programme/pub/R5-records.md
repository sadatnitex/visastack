# R5 records: For Agencies rebuilt to the approved reference

Owner, 18 Nov 2026: "i dont know if it's our desired upgrade, i feel like we locked the different version". An audit found the page did not match the approved reference. The page is the reference; only features and rules are kept.

Reference: the owner-approved artifact (For Agencies page). Chapter pictures at 1440x900 (d) and 390x844 (m) are in `r5-shots/` as `ref-<chapter>-<d|m>.png` (the reference) and `new-<chapter>-<d|m>.png` (this page), side by side by name. Pictures are reduced in size for the repository.

## Per-chapter fidelity

| Chapter | Reference | This page | Computer | Phone |
|---|---|---|---|---|
| 1 Hero | Dark, "Clients arrive prepared.", cases table with flag, ring, missing count, status, every row an Example | Same composition. Today's invite-only kicker and today's button labels. Rows tagged by one Example tag, "Completeness only. Not an approval." under the table | pass | pass |
| 2 Desk | "What changes at your desk.", three cards each with a drawing | Same three cards, drawings from the product's own document pictures (flight, insurance, passport) | pass | pass |
| 3 Plans | "Plans." with one sentence | "Pricing is shown here when selling opens." plus a mode-aware access line (see below) | pass | pass |
| 4 Closing band | "Bring your clients. Skip the chasing." with the passport and buttons | Same, with the real Bangladesh passport cover and today's buttons (the old page's Countries link stays as a third button) | pass | pass |

Checked by `apps/web/e2e/public-site/r5-reference-fidelity.spec.ts` (15 checks, all pass on one fresh build) and the existing PUB4 and overlap checks.

## Decisions and deviations

- Plans is truthful. The reference's second sentence, "Agency access is by request while we test with practice records", points at a request path the product does not have. It reads "Agency access is by invitation while we test with practice records." while the pilot is invite-only, and "Accounts are free during the public beta." when the beta is open (the Home page says the same). No price, no tier, no invented offer.
- Buttons keep today's labels (the reference's "Talk to Us" and "See How It Works" are not used).
- Chapter tones are dark, light, light, dark, as in the reference (its Plans band is a second light band). No dark chapter follows a dark one.
- Headings are Title Case ("Clients Arrive Prepared.") by the interface rule; the reference writes them in sentence case.
- The lede is shortened to "Clients keep their own record. You see only what they share." so the first phone screen stays under 30 words (the PUB4 guard) without hiding any copy. What each case is missing is shown by the table beside it.
- The closing line reads "Start with what works today." The reference's "Talk to us about the pilot." is not used: the product has no contact or request path, and none of today's buttons leads to one.
- Removed: Stop Chasing Documents by Message, What an Agency Gets, the pinned One Case One Clear Line, You See Only What Is Shared, One Traveller Profile Fewer Repeat Requests. The unreadable dark 33% ring on navy is gone: the ring sits on a light card and its centre is real text with contrast checked at 4.5:1.
- Shared kit: R1's contract is on its branch but the parts are not merged. Local stand-ins live in `apps/web/src/app/for-agencies/r5-kit/` with the contract's props; at the TURN the imports switch to the real kit and the folder is deleted.
