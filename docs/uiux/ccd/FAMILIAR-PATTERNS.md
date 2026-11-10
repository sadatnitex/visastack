# Familiar patterns

Owner direction, 10 November 2026: more than 60 percent of VisaStack's styles, behaviours and features should be ones people in Bangladesh already know from everyday apps (WhatsApp, Facebook, bKash, Gmail, Drive, Daraz, Foodpanda, Pathao), without the product looking busy. We copy the pattern, never an app's logo, colours or brand look. The flat rules stay: no shadow, no gradient, no glass, one filled primary per page, 44px targets, and truthful wording (Saved is not Shared, Received is not Reviewed, Suggested is not Confirmed, no approval odds).

## The measure

`apps/web/src/lib/ccd/familiar-registry.ts` lists one row per screen per pattern: how it is classed (familiar, partly, bespoke), the everyday app moment it matches, a weight from 1 to 5 for how often a traveller meets it, and its files. `familiar-baseline.json` holds the weighted and the count share. `familiar-conformance.test.tsx` fails when the weighted share falls below the baseline, when it rises without the baseline being raised, when a listed file is gone, when a bespoke row has no reason, or when a converted row's file no longer contains what it claims.

The share is an estimate from reading the code, not a measurement with people. Raise the baseline only in the change that converts a pattern.

| Point in time | Weighted share | Count share | Rows |
|---|---|---|---|
| Code audit (10 Nov 2026, 31 rows) | 37.5% | 41.9% | 31 |
| Before batch F1, with the Add button and two code screens added as rows | 38.2% | 41.2% | 34 |
| After batch F1 | 52.9% | 55.9% | 34 |
| After batch F3b | 57.9% | 61.1% | 36 |

The audit estimated about 39%; the rows as written come to 37.5%. The floating Add button on Documents already existed (#448): its row is counted in both the before and after figures.

## Batch F1 (this change)

| Pattern | Matches | Where |
|---|---|---|
| Done strip after an action | bKash "Successful", Gmail snackbar | Every form that shows a success line (`FormMessage`), and the sharing done line |
| Count on a phone tab | Facebook and Daraz tab numbers | Home and Sharing & Requests on the phone bar |
| Order-tracking stages | Foodpanda and Pathao order tracker | The case stage bar: a "Now:" headline, steps down a line on a phone |
| Code boxes | WhatsApp and bank verification codes | Staff authenticator code, guest document request code |

Rules each one follows:

- Done strip: the form's own message line stays the screen reader and no-script truth, and the strip is a hidden visual echo, so nothing is announced twice. It says exactly the existing success words, lasts 4 seconds, waits while the pointer or focus is on it, closes on its button or Escape, and fades in only when the person has not asked for less motion. A failure never goes there; it stays under the field. A form opts out with `toast={false}`.
- Tab count: made only from the unread notice counts the workspace already loads for the bell. Notices about requests count on Sharing & Requests, every other notice on Home. The words say "new", never "waiting", because an unread notice is not the same as a request still open. A true "waiting on you" count would need a new read for every page and a ratchet exception; it is a follow-up.
- Case stages: the headline names the stage, never a date or an outcome. Only the current stage is marked; no earlier stage is ticked.
- Code boxes: one real labelled input (`autocomplete="one-time-code"`, numeric keypad, paste of the whole code, spaces and dashes dropped) with boxes drawn over it. The field name, the format check and the server rules are unchanged. Before the page runs, or without scripts, it is the plain input. The staff "6 digit code or a backup code" box stays a plain field because a backup code is not all digits.

Not changed on purpose: the WhatsApp connect screen shows a code to send from WhatsApp, it does not take one, so there is no code to type there.

## Batch F3b: search first, and recent activity on Home

| Pattern | Matches | Where |
|---|---|---|
| Search box always in view, other filters behind a Filters button with a number | Google Drive and Gmail search | My Documents (every depth; the Filters button waits for Browse), the case checklist |
| Search above a long list, one plain line when nothing matches | Gmail and Drive search results | Cases for a traveller and Group Trips, from five rows |
| Recent activity as a short dated statement, then See All | bKash statement | Home (Browse depth), the last five events of the person's own record |

Rules each one follows:

- Search: it only hides rows the page already holds, client side; no new read. Every typed word must appear in the row's words, in any order, capitals ignored. With nothing typed the page's own layout shows untouched (folders, headings, links). Typing swaps it for the matches (under the same headings, for example Active Cases and Past Cases) and says how many match (read out politely); with none, one line says to clear the search or remove a filter, with a Clear Search button.
- Filters button: it shows the number of filters in use and opens the screen's own filters under the search box. Documents counts the category choice only; the four state tiles above stay as they are.
- Recent Activity: one bounded read, the newest five events of ONE record (the person's own when there is one, else the first person Home reads), through the same owner check as the Sharing page's Access Log. It uses the Access Log words, never a code; "You" for the person's own actions, a Blocked mark for a refused attempt. The read is skipped while core processing is off; a failed read is logged and leaves the card out. See All opens the Access Log on the Sharing page. Extra cost: one query on `audit_events` by `applicant_id` (index `audit_events_applicant_idx`), limit 5, once per Home load.
- Registry: the filter bar row moves to familiar; two rows are added for the new patterns. The activity log component itself (the long, filterable log) is unchanged and stays partly familiar.


## F2 camera check and receipts (10 Nov 2026)

- Take a Photo: opens the phone's own camera (a live view inside the page is blocked by the site's camera permission policy, so it is not used). The photo then shows with an outline frame and Use This or Retake, the way a bank identity check or a scanning app does; nothing is sent before Use This. On a phone it is the first, main button.
- Receipt: one shared card after a saved document or a sharing request: tick, what happened, when, to whom, an existing reference with Copy, an honest line, the next step and Done. It says Received, not Reviewed, where someone still has to look, and never that a file or a request was accepted.
- Registry: camera or file upload and upload receipt move to familiar.

## Trips list card and country flags (P12, 10 Nov 2026)

- Trips list card: it works like an order card in Foodpanda or Pathao: a round picture (the flag), the name, a coloured status chip, a progress bar and one next step, and the whole card opens the case. Estimated familiar.
- Country flag: a round flag beside the country name, as in Wise and bKash country lists, on the Trips list, Home cards, the case page, Countries and the destination box. Estimated familiar.
- Registry: two rows added. Estimated weighted share 70.3 percent before, 72.0 percent after (37 to 39 rows). An estimate from reading the code, not measured with people.
