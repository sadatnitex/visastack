# UX3 hand-back: the agency Document Requests list (no migration)

- Built on the real page, rendered first with made-up data. Branch work only (not pushed): `ux3-wip`, from the head of PR 424. Tables: none. No service, action, permission or stored-value change. Presentation only.
- What the real page showed: the customer ("For") was the third column behind Destination; the New Request button sat against the description with no gap; there was no way to look at one status; and the table had no `data-label` attributes, so on a tablet or phone (the shared table turns into a stack at 1180 px) every value showed beside a blank gutter with no name.
- What changed (`apps/web/src/app/app/agency/[orgId]/collection/`):
  - The shared page header carries New Request on the right.
  - Status filters with counts (All, Sent, Draft, Closed, Expired, Revoked), only for statuses that have a request; `?status=` filters the list, the current one is marked, and a value that is not a status shows everything.
  - The customer is the first column and the way in; a request with no name says "Not Named Yet". Every cell is labelled. On a phone each request is a three-line card.
  - The Links table on a request page gets its labels too.
  - Styles: one `WP-UMPE-UX3` block. The selected filter uses the brand tint, not the one dark block a screen may have.
- Measured on the real page with made-up data (phone 390 wide, desktop 1184 wide), before then now: phone 1,527 px (1.81 screens) to 1,184 px (1.40); desktop 800 px (1.00) to 800 px (1.00).
- Tests: 3 new (customer first and labels, filter counts, chosen status and a bad value); proven red by inverting the filter, then restored. The agency folder, wording, accessibility-page and surface guards pass (45 files, 399 tests). axe (WCAG 2.2 AA and best practice): no violation at 2 widths.
- Not done, and why: the concept's queue of what came back ("Submitted for Review", "Needs Correction", per-file Accept) needs a count of answers per request. The list service returns only the request's own status (Draft, Sent, Expired, Revoked, Closed), and answers live per request behind their own reads. Showing that on the list is a service change (a read that counts answers and decisions across requests, scoped so a member sees only their own), so it needs its own brief and a security review. Left for an owner decision.
- Also found, not changed: two platform tables (`admin/page.tsx`, `admin/insights/page.tsx`) have the same missing labels on narrow screens.
- Not verified: a signed-in agency account, a screen reader, a real phone, dark appearance, the e2e browser checks.
