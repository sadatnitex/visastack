# Critical screen states: what each screen shows

Directive Part 9 sections 2, 3 and 5. Written 2026-10-06 from the code, not from a live
signed-in session (the signed-in screens cannot be opened with real sign-in in this
environment). "Scanned" means a whole-page automated scan with simulated data
(`apps/web/src/lib/a11y-signed-in.test.tsx`, `a11y-pages.test.tsx`).

## The seven states

| State | How the product shows it |
| --- | --- |
| Loading | Route-level loading screens: a polite status region reading "Loading", grey shapes hidden from assistive technology, one hidden top heading on a full page (added today). |
| Empty | Every list says what is missing and what will appear or what to do ("No alerts yet. Updates about your cases ... will appear here"). |
| Error | One boundary for every signed-in and public page: says it is on our side, that nothing entered was lost, a "Try again" button that re-runs the render, a way home, and a reference number. A last-resort page covers a failure of the page frame itself. Public route information pages now say plainly that the information is unavailable (see decisions). |
| Forbidden | Deliberately the same as not found for another person's applicant, agency, mission or share: the screen never confirms that a record exists. Platform administration screens show a plain "restricted" panel. |
| Pending | Shares awaiting the person's acceptance say "Awaiting your acceptance" with the one action that moves it on; agency organisations say "Pending verification"; files being scanned or read say so and the documents page refreshes itself. |
| Retry | Error boundary button; upload says it could not confirm whether the file arrived and sends the person to the document list instead of asking for the file again; the status page has "Check now". |
| Success | Forms announce the result in an always-present polite region and keep keyboard focus; nothing is shown as done before the server answered. |

## Per screen

| Screen | Loading | Empty | Forbidden | Pending / in progress | Scanned |
| --- | --- | --- | --- | --- | --- |
| Overview (`/app`) | yes | yes | n/a | consent prompts | no (data heavy) |
| Applicants | yes | yes; consent not given explained | n/a | n/a | yes, 3 states |
| Applicant workspace tabs (profile, documents, evidence, expiry, history, missions, sharing) | yes, per tab | yes on each list tab | not found | documents: scan and read progress, self-refresh | documents form and upload scanned as components; tabs not whole-page scanned |
| Case readiness (mission) and snapshots | yes | yes | not found | needs review, unverified, conflicting labels | no |
| Shared with me | yes | yes | n/a | pending, active, paused, revoked, expired each distinct; revoked, expired and paused offer no way in | yes, 2 states |
| Alerts | yes | yes | n/a | new vs read | yes, 2 states |
| Privacy | yes | yes | n/a | deletion and export jobs show their stage | no |
| Account | yes | n/a | n/a | n/a | yes, 2 states |
| Agency list and each agency tab | yes | yes | not found | organisation pending, suspended | list scanned, 2 states; tabs have page tests, not whole-page scans |
| Platform administration | yes | yes | "restricted" panel | n/a | page tests only |
| Invitation accept pages | n/a | n/a | message for an invalid or expired link | n/a | no |
| Route information (public) | server-rendered | "No routes are currently published here" | n/a | n/a | yes, including database down |
| Status (public) | first check shown as "checking" | n/a | n/a | refreshes every 15 s | yes |

## Decisions recorded today

1. **Route information when the database is down.** Was an error screen with a reference
   number. Now a normal page (still HTTP 200) titled "Route information is not available
   right now": on our side, nothing the person entered is affected, try again, use the
   official site of the country for anything urgent. The cause is logged. Chosen because
   the page is the public face of the product and a person planning a trip should not hit
   a crash screen. Trade-off: a monitor that looks only at the status code will not see
   the outage on this page; `/api/health/ready` stays the real signal.
2. **Document status words.** The scan result "Clean" in green read like an approval, so
   it now says "No problems found"; "Ready" now says "Reviewed and approved"; the stage
   names "Structural validation", "In quarantine" and "Processing" now say "Checking the
   file", "Held for safety" and "Reading the file". English only; Bangla is deferred.
3. **Whole-page loading screens** now carry one hidden top heading so the page never has
   zero headings while it loads.

## Autosave, optimistic updates, assurance labels

- **Autosave: none exists.** Every save is an explicit button; the product has no
  optimistic updates (searched the signed-in code). A saved state is shown only after the
  server answers.
- **Assurance labels.** The five statements (declared, document supplied, named machine
  checks, agency reviewed, issuer confirmed) are built in `packages/services/src/assurance.ts`.
  No signed-in screen uses the words "verified" alone in green; case requirements use
  "On file", "Unverified", "Needs review". Not audited line by line for every screen.

## Weak network and phone (section 3)

| Test | Where | Result |
| --- | --- | --- |
| Interrupted upload (no answer ever) | `form-behaviour.test.tsx` | says it could not confirm, points to the document list, no re-upload demanded |
| Slow request | same | "working", then "taking longer than usual" |
| Job still processing | documents page tests | page watches and refreshes itself, stops when done |
| Retry | error boundary, status page, upload | covered |
| Duplicate click | `form-behaviour.test.tsx` | second click refused, button stays focusable |
| Page reload during processing | documents page tests | state comes from the server, not the browser |
| Narrow phone | `e2e/ux-public.spec.ts` | 320, 360, 390 wide for public pages including route information; the signed-in building blocks on a fixture |

Not run: a real browser with a real dropped connection, and the signed-in screens at phone
width with real sign-in.
