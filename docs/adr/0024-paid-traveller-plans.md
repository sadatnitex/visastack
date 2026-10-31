# ADR 0024: Paid traveller plans

Status: Proposed (31 Oct 2026). Design only. Nothing here is built. Build starts on the owner's word, after the decisions in section 2.

Amends: ADR 0020 scope ("Travellers have no invoices in V1", line 23; "Traveller subscriptions are not built", S29 note).

## 1. Context

- Every traveller is on Traveller Free today. The resolver ignores the account and always reads the `traveller_free` row (`packages/services/src/entitlements.ts` 362-398). Plan & Usage (`/app/account/plan`) tells travellers there are no paid plans.
- Plans already carry an audience (AGENCY or TRAVELLER, `packages/db/src/schema.ts` 3543, 3581), per-feature AI rules with daily limits (3606-3637) and a price history (3643-3671). AI daily limits are already read from the traveller's plan and counted per account (`ai-feature-settings.ts`).
- Every billing table (subscriptions, invoices, payment attempts, refunds, receipts, receipt counters) is keyed to an organization. The cash ledger (`invoice_payments`) is keyed by invoice only, so it carries over as is. One function records every payment (ADR 0020, section "One recording function").
- Online payment is SSLCOMMERZ, BDT only, pay by link, no automatic charging (ADR 0020 lines 24, 133).
- The public beta promise (directive 2026-10-10, items 6 and 7, and section 6.1): every operational feature stays available without payment during the beta, no card required, and future paid plans must use the same canonical entities (section 6.6). PRODUCT-CONTRACT: paid upgrades need the owner's approval for the particular operation.

## 2. Owner decisions needed before build (recommended defaults)

| # | Decision | Recommended default |
|---|---|---|
| D1 | What a paid plan sells during the beta | More room only: higher AI daily limits and more storage. No feature is paid-only while the beta lasts (keeps the beta promise). Paid-only features need the beta contract changed first. |
| D2 | Tiers | One paid tier, "Traveller Plus". A yearly length can come later as a second plan row. |
| D3 | Price and currency | BDT only (online payment is BDT only). The owner sets the number on the Plans page; the build ships none. Prices shown as the final amount. |
| D4 | Period and renewal | 30 days, paid in advance, renewed by paying a link. Reminders 7, 3 and 0 days before the end. 7 days after the end to pay without losing the period, then back to Traveller Free. Travellers never owe money: no Grace or Suspended state. |
| D5 | Trial | None. Everyone already has Traveller Free. |
| D6 | Family | Plus covers every person the account keeps (self, family member, minor). Not shared across accounts. |
| D7 | Tax / VAT | No tax lines at first (deferred item H16). The accountant confirms before live selling whether prices must include VAT. |
| D8 | Refunds | Full refund on request within 7 days of payment; Plus ends when the refund is confirmed. Recorded in VisaStack after it is made in the SSLCOMMERZ panel (O18 option 3). Platform owner only. |
| D9 | Payment readiness | Sandbox first (only the platform owner can pay in test mode). Live only on the owner's "go live" after O6. |
| D10 | Founding Access travellers | Traveller Free stays exactly as it is. Any future reduction of Free needs at least 30 days' notice and the owner's word. |
| D11 | Plus numbers (AI limits, storage) | Set by the owner on the Plans page, like O4. The build seeds nothing. |
| D12 | Legal wording | Terms of sale, renewal rule and refund policy reviewed by the lawyer (O10). |
| D13 | Manual payments | Online only for travellers: no "I Paid Another Way", so no personal bank slips are stored. |
| D14 | Accounting file | Person rows carry a short reference code, never a name or email (ADR 0020 promises no traveller data in that file). The owner and accountant confirm this is enough. |

## 3. Decision: the payer is an organization or a person

One migration (0110) adds columns only, on the existing billing tables. No second billing catalog (the directive forbids one).

- `subscriptions`, `invoices`, `payment_attempts`, `refund_requests`, `payment_receipts`: add `payer_account_id uuid`, allow `organization_id` to be empty, and check `num_nonnulls(organization_id, payer_account_id) = 1` (added unvalidated, then validated).
- The column is not named `owner_account_id`: the access ratchet treats that name as traveller record data.
- New indexes, apart from the agency ones: one current subscription per person; one live invoice per person, plan and period; one receipt number sequence per person; paid invoices by person and period end.
- New `person_receipt_counters (account_id)`, `subscriptions.renews` (default true), nullable `invoices.subscription_id`.
- New plan rule names `account_storage_bytes` and `person_storage_bytes`.
- Account deletion: financial rows keep `payer_account_id` without a foreign key (the ledger's rule); `subscriptions.payer_account_id` cascades; `subscriptions.assigned_by_account_id` becomes nullable with set-null (today it would block deleting a person who bought for themselves).

Why: every agency query filters on `organization_id = X`, which a person row never matches, so agency billing stays correct without edits; jobs that join organizations skip person rows until deliberately extended (the failure is "left out", never "mixed in"); making `organization_id` nullable surfaces every place that assumed an organization as a compile error.

Rejected: separate traveller billing tables (a second catalog, forbidden by the directive section 6.6); a full `billing_account_id` rewrite of every table (much larger change, no V1 benefit).

## 4. Entitlements

- `resolveForTraveller(db, accountId, now)` gives a paid plan only when the person has a current subscription on an active TRAVELLER plan and a PAID, unrefunded invoice whose period covers `now`. Otherwise Traveller Free.
- Coverage comes from paid invoices, so a failed or late job can never give more than was paid for, and lapse and refund take effect in the resolver before any job runs. Turning selling off never removes a period already paid for.
- Plan-driven for travellers: AI daily limits (already wired); account and per-person storage (the plan's rule, else today's setting; the platform hard stop stays a setting). The number of people an account keeps stays unlimited. AI Allowance stays shown only.
- Fix with this: the contributor upload path checks the account storage limit against the contributor's own account (`contributor-requests/accept/actions.ts` passes the contributor's `accountId` to `reserveUpload`). Plan storage must always be judged on the applicant's owner.

## 5. Payments, jobs and admin

- `startPersonCheckout(self, planId)`: per-person lock; refuses when already covered or reuses the open purchase invoice; creates a purchase invoice for [now, now + period) with a pseudonymous reference.
- Payment start, gateway notification, return page and daily reconciliation become payer-aware. Authorization for a person is "payer is me". Name and email are read when needed, never stored on invoices.
- Inside the recording function's transaction, a person invoice turning PAID creates or extends the subscription and issues the person receipt. Money that arrives while already covered is held (`already_covered`) for the owner to refund or credit.
- `process-billing-cycle` gains a person phase: renewal invoices 7 days before the end (only when `renews` is on), reminders through the notification outbox, end of subscription 7 days after an unpaid period, voiding of unpaid invoices. After a lapse nothing is deleted; only new uploads pause while over a limit.
- Plans page: create priced TRAVELLER plans with storage rules; Traveller Free stays unpriced and cannot be retired; "On it" counts real person subscriptions.
- Admin traveller billing view by reference code: invoices, payments, full-only refunds through the existing refund services. Accounting file gains a payer type and code.

## 6. Access gate

- A new branded `SelfScope` in `access/principal.ts`, built like `SystemScope` and `StaffScope`; only `withSession` can create it, enforced by a static test.
- Ratchet: any exported function touching a table with `payer_account_id` must take `SelfScope`, `StaffScope` or `SystemScope`. The baseline starts empty.
- A plan never changes who can see what. Agencies never see a traveller's plan or payments.

## 7. Privacy

- No card data stored. Payer identity is rendered on receipts at request time ("Deleted account" after deletion).
- Own-data export adds plan history, invoices and receipts. Deletion ends the subscription and keeps financial rows; it waits while a live payment is still within its window.
- Legal holds are untouched. Financial record retention is set with the accountant.

## 8. Experience

- Switch off: Plan & Usage stays as it is today.
- Switch on: a comparison table (Traveller Free and Traveller Plus) built from the plan rows, the price "BDT X for 30 days", and "Everything in VisaStack stays free during the beta. Plus gives you more room."
- Upgrade: Get Traveller Plus, a confirmation card (what you get, price, end date, "No automatic charge. We remind you before it ends."), then Pay with SSLCOMMERZ. Results reuse the four existing payment states.
- Current plan card: "Traveller Plus until 12 Dec", Stop Renewing or Keep Renewing, and Renew Now once a renewal invoice exists.
- Billing History: invoices and receipts with PDFs, and a refund request link.
- Accessibility: comparison as a real table with header cells; focus moves to the result heading; buttons stay usable during redirects; shared money and date style; plain words only.

## 9. Rollout safety

- `TRAVELLER_PLANS_ENABLED` (off by default) governs selling and renewal invoices only. A paid plan is offered only when active and priced.
- Migration 0110 is generated only after the previous one is on main, and runs in production only on the owner's word (O8). Code reports "not available yet" until the columns exist.
- Tests: agency billing characterization first; cross-account isolation (A cannot read, pay or refund B; agency staff see no person rows); ratchet and `SelfScope` minting; exactly-once recording across duplicate, replayed and late notifications; two-tab purchase; job reruns create nothing; resolver alone handles lapse and refund; storage judged on the applicant's owner; a database before 0110.
- Audit events `PERSON_PLAN_PURCHASED`, `PERSON_PLAN_RENEWED`, `PERSON_PLAN_RENEWAL_STOPPED`, `PERSON_PLAN_LAPSED`; job counts; an overview row "Traveller Plans: Off / Test / Live".

## 10. Build packages

| Order | Package | Scope | Migration | Owner gate | Acceptance |
|---|---|---|---|---|---|
| 1 | T0. Decisions | This ADR accepted; decisions D1 to D14 recorded in OWNER-ACTIONS | none | D1 to D14 | docs only |
| 2 | T1. Payer schema and SelfScope | Migration 0110, types, payer helper, `SelfScope`, ratchet rule, schema probe | yes (0110) | O8 | agency behaviour unchanged; check refuses both or neither; ratchet fails on an ungated function; works before 0110 |
| 3 | T2. Resolver, storage, plans admin | Coverage from paid invoices; plan-driven storage on the applicant's owner; priced TRAVELLER plans on the Plans page | none | switch off | Free without a covering paid invoice; Plus inside the period; contributor upload counted on the owner |
| 4 | T3. Checkout and payment | Person checkout, payer-aware payment flow, subscription on PAID, person receipts, upgrade screens | none | O6, then the switch | ADR 0020 security invariants for persons; isolation; two-tab purchase; test mode owner only; max code review and security review |
| 5 | T4. Renewal and lapse | Person phase of the billing job, reminders, Stop or Keep Renewing, lapse | none | switch | reruns create nothing; late pay inside 7 days restores coverage; nothing deleted |
| 6 | T5. Billing history | Invoices, receipts, PDFs, refund request link | none | O10 wording | page tests, axe, keyboard path |
| 7 | T6. Money operations | Admin traveller billing view, full-only refunds, accounting file payer code, readiness row | none | O18 | refund never above collected; no name or email in the file |
| 8 | T7. Privacy and launch | Deletion and export, runbook, sandbox end to end | none | O8, O6 live, "go live" | deletion keeps the ledger; export includes billing; sandbox run recorded |

## 11. Risks and open questions

- Charging during a beta that promises every feature free limits Plus to more room (D1).
- VAT on consumer sales (H16): live selling waits for the accountant.
- SSLCOMMERZ refund details are not yet checked against its live documentation; live refunds need a fixed outbound address (O18).
- Open: agencies paying for a traveller's Plus (the payer model allows a third payer kind later); a yearly length; a free Plus grant from support (commercial overrides are organization-only today).
