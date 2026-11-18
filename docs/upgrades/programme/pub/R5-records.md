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
- The lede is shortened to "Clients own their record. You see what they share." so the first phone screen stays under 30 words (the PUB4 guard) without hiding any copy. What each case is missing is shown by the table beside it.
- The closing line reads "Start with what works today." The reference's "Talk to us about the pilot." is not used: the product has no contact or request path, and none of today's buttons leads to one.
- Removed: Stop Chasing Documents by Message, What an Agency Gets, the pinned One Case One Clear Line, You See Only What Is Shared, One Traveller Profile Fewer Repeat Requests. The unreadable dark 33% ring on navy is gone: the ring sits on a light card and its centre is real text with contrast checked at 4.5:1.
- Shared kit: the page uses R1's real kit (`CasesTable`, `ClosingBand`, `RiseIn` from `components/public-site/kit`). The local stand-ins are deleted. `ClosingBand` takes `titleId="closing-band-title"`; the closing picture is still `passport-bd`.
- No scroll scenes: the page has none, so the scroll engine (`ScenesRuntime`) is no longer loaded. `RiseIn` runs its own observer and the early head mark sets `data-scenes` by itself, so nothing else is needed.
- Hero flags: the real `CasesTable` loads its three 28 x 19 px flags lazily. They sit in the first screen, but they are tiny and the largest paint on this page is the headline text, so there is no LCP effect worth a kit change. No BLOCKED.
- Desk drawings: the types `flight_ticket`, `travel_insurance` and `passport` resolve to real drawings (a unit test fails if one falls back to the generic paper).
- Button words: "See What Works Today" reads the catalogue key `home.page.seeWhatWorksToday` (it has Bengali); the start button reads the same Home keys as before.
- English-only words on this page (through `publicText`, no new Bengali entries): Clients Arrive, Prepared., Clients own their record. You see what they share., What Changes, at Your Desk., One List of Cases, Each row shows its ring and what is missing., Only What Is Shared, Clients choose what you see, and can end it., Completeness, Not Approval, The ring counts what is complete. It never promises a visa., Plans., Pricing is shown here when selling opens., Agency access is by invitation while we test with practice records., Accounts are free during the public beta., Bring Your Clients., Skip the Chasing., Start with what works today., Countries.

## Final state (TURN, 18 Nov 2026)

Main `0054091` merged by merge commit with no conflict. The page uses the real kit; the checks listed in the known-issues entry of the same date ran on the final tree. Open follow-ups: Bengali for the English-only words above; the 5rem hero gap on phones exists only to keep the first phone screen under 30 words with the real table (a kit table with fewer words per row would let it return to the normal gap).

## Known-issues chunk (to append)

To be appended to `docs/commercial-v1/known-issues.md` by U6 at its TURN (owner: avoid two appends to one file in the same bundle).

## 18 Nov 2026: R5 For Agencies rebuilt on the approved reference

- What: the owner saw the live For Agencies page as the old Harbor page ("Stop Chasing Documents by Message", "What an Agency Gets", a pinned "One Case, One Clear Line", "You See Only What Is Shared") with an unreadable dark 33% ring on navy. It is now the four chapters of the approved reference: a dark hero "Clients Arrive Prepared." beside a case list of three Example rows, "What Changes at Your Desk." with three cards that each carry a drawing, "Plans." and the closing band "Bring Your Clients. Skip the Chasing." with the Bangladesh passport cover.
- Behaviour: invite-only wording, button labels and sign-in flow are today's (the Home catalogue keys, including See What Works Today with Bengali). Plans states only what is true: no price and no tier, "Pricing is shown here when selling opens.", then "Agency access is by invitation while we test with practice records." while the pilot is invite-only or "Accounts are free during the public beta." when the beta is open, from the same switch the site already uses. The reference's "Talk to us" is not used because no contact path exists. The page has no scroll scenes and loads no scroll engine. The hero grid gap is 5rem on phones so the real case table starts below the first phone screen (guard: at most 30 words there).
- Gate: apps/web/e2e/public-site/r5-reference-fidelity.spec.ts (15 checks) with chapter pictures at 1440x900 and 390x844 beside the reference in docs/upgrades/programme/pub/r5-shots/, per-chapter table in R5-records.md; unit tests read parsed markup and were shown red when the feature is removed.
- Proof: typecheck, lint with UI ratchet, full web unit tests, scripts tests, full-check.sh (all steps exit 0), Playwright public-site, ux-public, WP-SB8 and browser-security on one fresh build, check-public-budget, em dash 0.
- Follow-ups: Bengali for the new English words (list in R5-records.md); the phone gap above can return to normal if the kit table gets fewer words per row.
- NOT verified: real devices and visitors, a person using a keyboard or screen reader, Bangla layout beyond the page-length budget, CI and CodeQL on the pushed head.
