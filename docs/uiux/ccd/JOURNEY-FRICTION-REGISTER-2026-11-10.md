# Traveller and agency journeys: friction register (10 Nov 2026)

For the owner and every session that builds a journey fix. It records what people can actually do today, where they get stuck, and which lane or package fixes it. It sits beside `CASE-PAGE-AND-LIST-PATTERN-PLAN-2026-11-09.md` (layout) and does not replace it: the plan changes how screens are laid out; this register changes the steps and the words. Main was `e7afb2a8` (#477) when this was written. Every finding was traced in code (file and line) and the main ones were re-checked by the coordinator; nothing here was seen live in a browser.

## 1. What a person can do today

| Journey | Works today (verified in code) | Missing or partial |
|---|---|---|
| A. New traveller | Sign-up, email confirmation, a 4-step first run (optional country, one consent button, who the record is for, what to do first). No full profile is required before the first upload. | After confirming the email the person must sign in again (`app/auth/actions.ts:137`). The first run offers 4 to 6 equal choices with no recommended one. |
| B. Reusable record | Record hub with filters (Everything, Profile Details, Ready to Use, Needs Attention, Previous Versions); stored, missing, expired and previous versions are shown; a conflict asks "Which is right?" with Use, Both Are Right, Keep My Current Value. | History is a log, not a side-by-side view. Several labels are engineering words. |
| C. Documents | Drop, folder, camera and choose-kind upload; suggestions are never saved until accepted; passports are read without AI from the two lines at the bottom; manual entry path exists; failure advice exists; a document can be reused in a case. | Every file is capped at 4 MB (`lib/upload-preflight.ts:12`) with no help to shrink a phone photo. Expiry dates come only from passports; other documents cannot be given one (`applicant/[id]/expiry/page.tsx:79`). |
| D. Preparing a case | "Start a Trip": 3 questions (where, why, who), then the case page with the checklist attached when exactly one fits. Prepare Again reuses a past case. Summaries can be previewed, copied, printed. | The Cases list has a second, different form that requires a typed title (`create-mission-form.tsx:120`). The trip form refuses a person who does not know the country yet. Four names for Summaries. |
| E. Agency | Do Next list ranks overdue, received, overdue tasks, unassigned; request form; accept, replace, cancel; follow-up message copy with safety scrubbing; assignment. | Asking for something is only possible on Clients, not on the case (`RequestEvidenceForm` rendered only in `agency/[orgId]/clients/page.tsx`); the form resets the traveller and case after each item; requests without a due date are never chased. |
| F. Sharing | Grant form with a scope summary, review then confirm, expiry (30 days default, 90 maximum), pause, resume, revoke with a warning, access log, client invitations with an "If you accept" list. | The grant row hides what is shared and until when behind a fold; the agency client invitation page does not say how long access lasts or how to end it; the sharing invitation page does not show who is sharing. |

Navigation note: the owner's decision P13 (`VOCABULARY.md` rows 139 to 145) set the tabs to Home, My Documents, My Trips, Sharing & Requests. It supersedes the older "Home, Record, Cases, Sharing" naming, so the tabs stay as they are.

## 2. Friction register

Objective means anyone can reproduce it (dead end, missing feedback, two forms for one job, hidden essential fact). Wording means a grade 5 to 8 reader would struggle.

| ID | Problem | Evidence | Who | Kind | Fix | Owner of the fix |
|---|---|---|---|---|---|---|
| A1 | One consent button has four names; some messages name a button that does not exist under that name | `(home)/first-run.tsx` near 125 and 278, `(home)/page.tsx` near 485 and 527, `lib/labels.ts` near 239 | Every new person | Objective | One name, "Let VisaStack Process My Details", and a working link wherever a page says to turn it on | Lane 1 |
| A2 | Confirming the email ends on a sign-in form | `app/auth/actions.ts:137` | New people on phones | Objective | Sign in automatically after confirmation | Built 10 Nov (packet P1), not seen live: a real confirmation email is needed |
| A5 | First run offers 4 to 6 equal choices | `(home)/first-run.tsx` near 187 to 240 | New people | Preference | Mark one recommended first step | Lane 1 if small, else later |
| B2 | "Add the Details Yourself" opens the whole profile, not the field | `reading-status.tsx:35` | Manual entry | Objective | Link to the right section | Lane 1 |
| B3 | Pages say "turn on processing on Home" with no button | profile near 354, review near 227, `ai-review.tsx` near 283 | People who chose Not Now | Objective | A link to where it is switched on | Lane 1 |
| B6 | History labels: Extracted (Pending), Declared, Stale, Conflicted, Superseded, API, System | `applicant/[id]/history/page.tsx:27-45` | Every reader | Wording | Plain labels, display only | Lane 1 |
| B1 | No way to give a non-passport document an expiry date | `expiry/page.tsx:79` | Anyone with a visa, permit or certificate | Objective | A "Set Expiry Date" action | Owner said yes (P3); built on branch `claude/ux-p3-document-expiry`, migration 0134 pending the owner's word |
| C1 | 4 MB cap with no help for large phone photos | `lib/upload-preflight.ts:12` | Phone users, the main audience | Objective | Shrink large photos in the browser before sending | Built in packet P2 (owner said yes, 10 Nov); awaiting review and merge |
| C2 | "Contact support" with no link | `documents/page.tsx:143-153` | Anyone with a failed file | Objective | Link to help | Lane 1 |
| D1, D2 | Two start forms; one demands a typed title | `create-mission-form.tsx:115-124`, `mission/start/start-form.tsx:115-151` | Travellers | Objective | One start path (3 questions), old form kept for "Not sure where yet" and extra details | Lane 1 |
| D3 | Trip form refuses an undecided traveller | `mission/start/actions.ts:71-73` | Travellers | Objective | A plain link to start without a country | Lane 1 |
| D6, D7 | Summaries have four names and an eyebrow "Share" | `outputs/page.tsx` near 183 to 263, `missions/page.tsx` near 237 | Travellers | Wording | One name; never "Share" | Lane 1 |
| E1 | Cannot ask for a document from the case | `agency/[orgId]/clients/page.tsx` near 289 to 318 | Agency staff | Objective | Same form, same server action, on the case workspace | Lane 2 |
| E2 | Form forgets traveller and case after each item | `agency/[orgId]/request-evidence-form.tsx` near 40 to 50 | Agency staff | Objective | Keep them selected | Lane 2 |
| E3 | Requests without a due date are never chased | `do-next.ts` tier 1 | Agency staff | Objective | A chase tier by days since sent | Needs the owner (packet P4), ranking change |
| E4 | Case shows "N items to review" but review happens on Clients | `case-needs.ts:35-42` | Agency staff | Objective | Link the count to the exact request | Package 7 |
| E5 | Follow-up is copy-only behind a fold | `follow-up-copy.tsx` near 45 to 75 | Agency staff | Preference | Open in WhatsApp with the scrubbed text | Lane 2 (optional) |
| E8 | Two request systems both called "requests" | `workspace-navigation.ts` near 165, `collection/page.tsx` near 130 | Agency staff | Wording | One line under each: who it is for | Lane 2 |
| E9 | Member with no cases hits a dead end | `agency/[orgId]/cases/page.tsx` near 161 | Agency members | Objective | Link to Team | Lane 2 |
| E10 | Raw "x" unassign button, busy label never changes | `mission-collaboration.tsx` near 250, 340 | Agency staff | Objective | Accessible name, busy label | Lane 2 |
| E7 | "Evidence Requests" is hard to read | `applicant/[id]/evidence/page.tsx:295` | Travellers | Wording | "Requests from Agencies" | Package 4 |
| F1 | Grant row hides what is shared and until when | `applicant/[id]/sharing/page.tsx:521-545` | Travellers | Objective | One line in the row: what and until when | Lane 3 (package 5) |
| F2 | Agency client invitation does not say how long or how to stop | `client-invitations/accept/page.tsx:84-135`, `lib/client-invitation-terms.ts` | Travellers | Objective | One truthful line about duration and how to pause or end, wording only | Lane 3 (package 5) |
| F3 | Sharing invitation does not show who is sharing | `sharing-invitations/accept/page.tsx:50-95` | Recipients | Objective | Show the sharer's name if the service already returns it | Lane 3 (package 5) |
| F4 to F9 | Raw category codes, three repeated warnings, disabled submit with no reason, free-text purpose, policy wording | `sharing-invitations/accept/page.tsx:65`, `grant-form.tsx:202-437`, `sharing/page.tsx:420-482` | Travellers and recipients | Mixed | Plain words, one warning, helper text, purpose chips | Lane 3 (package 5) |

## 3. Lanes running and queued

| Lane | Branch | Contents | Not allowed to touch |
|---|---|---|---|
| 1 | `claude/ux-lane1-first-journey` | A1, A5 (if small), B2, B3, B6, C2, D1, D2, D3, D6, D7, plain words on record, profile, documents, expiry, history, missions, prepare-again, outputs, first run; a vocabulary guard that bans the engineering words | Case page, sharing, agency, evidence pages, navigation labels |
| 2 | `claude/ux-lane2-agency-ask` | E1, E2, E5 (optional), E7 agency side, E8, E9, E10 | Case page, traveller pages, ranking in `do-next.ts` |
| 3 (queued) | to be named | Package 5 (sharing) plus F1 to F9 | Grant, scope, pause and revoke behaviour |
| Owner's session | its own | Package 3 (case page finish), then the plan's sequence | |

Every lane keeps services, access rules, readiness, consent semantics, server action names and form field names unchanged, and needs no database change. Each lane stops before merging until the coordinator has reviewed it.

## 4. Decisions only the owner can make

| Packet | What it would change | Why it needs you | Recommendation |
|---|---|---|---|
| P1 | Sign the person in straight after they confirm their email | Changes sign-in behaviour in Neon Auth | Yes, if Neon Auth supports it without weakening the confirmation link |
| P2 | Shrink photos over 4 MB in the browser before upload, and say so on screen | The stored file is then a smaller copy, not the original photo | Yes, for photos only (never PDFs), keep the long edge at 2,000 pixels or more so text stays readable |
| P3 | Let a person type an expiry date for any document | A new stored fact, likely a database change | Yes, as a separate package after the lanes |
| P4 | Chase requests that have no due date after a set number of days | Changes the agency Do Next ranking | Yes, after 3 days without a reply |

**Owner decision, 10 Nov 2026: "yes P1 P2 P3 P4", and the coordinator session controls and manages every running session.** Each packet is built in its own session, one at a time behind the lanes, and stops before merging for the coordinator's review. P3 will probably need migration 0134; running it in production still needs the owner's separate word "migrate 0134" (or whichever number is next free at the time). P1 may need a Neon Auth setting change; the session prepares it and the coordinator checks it before anything changes in production.

Run order (at most two build sessions at a time beside the owner's case page session): Lane 1 and Lane 2 now; then P2 (photos), Lane 3 (sharing), P4 (agency chase, after Lane 2 merges, same files), P1 (sign-in after confirmation), P3 (expiry dates). The case page session takes the plan's next package only when the coordinator hands it over.

## 5. Outside tools (decision 10 Nov 2026)

| Tool | Decision | Boundary and rollback |
|---|---|---|
| Impeccable | Its review guides (critique, distill, clarify, onboard, harden, polish) are used as checklists from a scratch copy outside the repo | Its installer adds an edit hook and downloads a program into the home folder, so it is not installed; `scripts/ui-ratchet.mjs` and `scripts/check-flat-design.mjs` stay the gates. Nothing to roll back. |
| Diagram Design | Used for the journey maps, published as a private page for the owner | Not committed, so no second source of truth |
| Graphify | Not used now | Each lane already has its files named; reconsider for package 7 if agency changes span many modules |
| Superpowers | Practices only (test first, prove a guard fails, verify before claiming done), already required by `CLAUDE.md` | Its session-start hook would compete with the repo's agent rules, so it is not installed |
| Taste Skill | Not used | It targets photo-led marketing sites with motion and effects, against the flat Harbor rules |
