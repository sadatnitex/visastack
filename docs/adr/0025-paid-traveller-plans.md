# ADR 0025: Paid traveller plans

Status: Accepted (31 Oct 2026; the owner chose the recommended defaults D1 to D14). Design only: nothing is built yet. Build follows the packages in section 10, each behind the off switch.

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

## 12. Practices adopted (global subscription standards, Bangladesh and South Asia context)

Each item below is part of the design and lands in the package named. Facts marked "verify" come from secondary sources and are confirmed with the provider, the accountant or the lawyer before live selling.

### 12.1 Entitlements and money correctness (global standard)

- **Entitlements apart from billing.** The resolver is the one source of truth for what a person gets; every feature asks it, never billing tables directly. Access follows money that has actually arrived (section 4), so no job or outage can grant unpaid access. (T2)
- **Idempotency everywhere money moves.** Every start, notification, return and reconciliation carries a key; the one recording function writes a payment exactly once (ADR 0020). Tests replay, duplicate and reorder notifications. (T3)
- **Append-only money records.** Invoices, payments, refunds and receipts are never edited in place; corrections are new rows. Invoice and receipt numbers are gap-free per series. (T1, T3)
- **Price locked for the paid period.** A price change applies from the next period only, with at least 30 days' notice to people who renew; the period already paid is never repriced. (T2, T4)
- **Expand, then contract.** Migration 0110 only adds columns and checks (added unvalidated, then validated), so the running version and the next one both work during deploy. (T1)
- **Kill switch and test mode.** `TRAVELLER_PLANS_ENABLED` stops selling at once without touching periods already paid; test mode lets only the platform owner pay. (T3)
- **Daily reconciliation.** Every person payment is matched against the provider each day; anything unmatched becomes a "Needs a Check" item for the owner (the existing rule). (T3, T6)

### 12.2 Fair, transparent selling (global standard, no dark patterns)

- **Final price shown up front**, in BDT, in the shared money style, VAT included once the business is VAT-registered (D7). No surprise fees at the last step. (T3, T5)
- **One-tap Stop Renewing**, as easy as buying, with access kept until the period ends (the "click to cancel" standard). No confirm-shaming wording, no pre-ticked extras. (T4)
- **Upgrade offered at the moment of need, not nagged.** When a person reaches a daily AI limit or a storage limit, the message they already see adds one plain line: what Plus would give and a link to Plan & Usage. No pop-ups, no repeated prompts, never during a task. (T3)
- **Reminders that respect people:** 7, 3 and 0 days before the end, in the app and by email, and on WhatsApp only for people who connected it. No reminders after someone stops renewing. (T4)
- **Refunds without friction:** a request link on Billing History; the 7-day full refund is honoured without questions. (T5, T6)

### 12.3 Bangladesh and South Asia context

- **Mobile wallets first.** Most people here pay with bKash, Nagad or Rocket rather than cards. The SSLCOMMERZ hosted page offers wallets, cards and internet banking (verify the exact list on the live merchant account), so the checkout says "Pay with bKash, Nagad, Rocket or card" in plain words and is built phone-first. (T3)
- **Prepaid, like a data pack.** Card-on-file auto-charging is uncommon and SSLCOMMERZ is pay by link, so Plus is sold as a prepaid period that never charges by itself, with reminders before it ends. People already understand this model from mobile data and talk-time packs. (T3, T4)
- **Episodic need.** People prepare visa files a few times a year, around travel seasons, not every month. Recommended after launch, when there is data: a 90-day "Travel Season" length with no renewal, alongside the 30-day period. Added as a second plan row; no code change beyond T2. (later, T8)
- **Wallet redirects fail often on weak networks.** The OTP and app-switch steps of wallet payments time out more than card payments. The design already confirms payments from the provider's notification and the daily reconciliation, not from the person's browser returning; the result page shows "Confirming" and checks again by itself, and "I paid but it does not show" leads to a support request with the payment reference filled in. (T3)
- **Light pages on slow phones.** The comparison and checkout screens load no extra scripts or images, work on 3G and small screens, and keep every tap target at least 44px. (T3, T5)
- **Prices people recognise.** Round local price points are common (for example ending in 99 or 49); the owner picks the number. Shown in BDT with the currency code, the platform's money style. (D3)
- **One payer for the household.** Plus covers every person the account keeps (D6), matching how families here usually have one person handle travel paperwork.
- **VAT and VAT invoices.** Digital services in Bangladesh are reported to carry the 15% standard VAT, and VAT-registered sellers issue VAT invoices in the NBR's format (Mushak 6.3) (verify both with the accountant, D7). The design keeps prices VAT-inclusive and adds a VAT line and the registration number to receipts behind a separate switch, only when the accountant confirms. (later, T8)
- **Auto-debit later, by choice.** bKash offers tokenized agreements that let a customer authorise repeat charges (third-party client libraries describe an agreement then charge flow; verify with bKash's official merchant documentation and a sandbox). The provider registry from S19 is the place for it. If added, it is strictly opt-in, cancellable in one tap, and the prepaid option stays. (later, T8)
- **Bangla.** All new wording is written so it can be translated, but Bangla itself stays deferred until the owner says so (owner rule).

### 12.4 Measuring it (privacy-safe)

- Counted without personal data: Plan & Usage views, Get Traveller Plus taps, checkouts started, payments confirmed, renewals, lapses, stops and refunds, by day. From these: conversion, renewal rate and refund rate on the admin overview. No per-person tracking, no third-party analytics. (T6)
- Health signals: checkout success rate, time to confirmation, stuck "Confirming" payments, and reconciliation mismatches, each with an alert threshold the owner sets. (T6)

### 12.5 Added package

| Order | Package | Scope | Migration | Owner gate | Acceptance |
|---|---|---|---|---|---|
| 9 | T8. After launch | Travel Season 90-day length (plan row only); VAT line and Mushak 6.3 fields on receipts behind their own switch; opt-in bKash auto-debit through the provider registry | only if VAT fields need columns | accountant (VAT), bKash merchant approval, owner | VAT shown only when switched on; auto-debit never starts without an explicit agreement and stops in one tap |

### 12.6 Coordination

- Another session builds the payment provider packages (S19 onward). Migration numbers are taken in merge order: whichever of S19 or T1 reaches main first uses 0110, and the other regenerates its migration on top (the handoff's rule: a migration is generated only after the previous one is on main).
- T1 touches the billing tables S19 also touches. T1 starts only when no S19 branch with billing table changes is open, or after agreeing the order with the owner.

## 13. Delivery notes

This section supersedes the T1 and T2 rows of section 10 and the "Code reports not available yet" line of section 9 where they differ.

- **T1, database first (31 Oct 2026).** Drizzle names every declared column in each insert and plain select, so code that declares the payer columns fails on a database without them, and making every billing read and write tolerate a missing column (the 0107 pattern) would change about forty places in the money code that the payment provider packages also change. T1 therefore ships migration 0110 alone: the payer columns, the one-payer checks, the person indexes and `person_receipt_counters`. `schema.ts` and its snapshot (`0108_snapshot.json`) do not declare them yet, so today's code reads and writes exactly as before on either side of the run. Between merge and run, readiness reports the database as behind.
- **Kept out of T1 on purpose:** the assigning account becoming optional with "set null" on deletion, and the two traveller storage rule names. Both change what today's code can see (an account deletion that used to be refused would start to succeed, and a regenerated check from the old `schema.ts` text could undo the rule names), so they move to T2, where `schema.ts` declares them in the same change.
- **T2 starts only after 0110 has run in production,** checked against `drizzle.__drizzle_migrations` before merging. T2 declares the 0110 columns in `schema.ts`; `drizzle-kit generate` would write plain `ADD COLUMN` and `ADD CONSTRAINT` statements that fail where 0110 ran, so T2 discards that generated SQL for everything 0110 already made and keeps the regenerated snapshot. T2's own migration carries only what is new to it (the assigning account and the storage rule names). T2 adds a test that the database after every migration matches the declared schema for these five tables, so the two can never drift apart unnoticed.
- **T2 and T3 follow-ups found in review:** the refund guard of migration 0104 freezes `organization_id` on an open refund but not `payer_account_id` (add it in T3, before any person refund exists); person billing rows carry no foreign key to accounts on purpose (money records outlive the account), so the code that writes them (T3) checks the payer exists and that an invoice's subscription belongs to the same payer and plan.
- **T2 (31 Oct 2026).** `schema.ts` declares everything 0110 made, plus migration 0111. Agency billing paths state they handle organizations only (`billing-payer.ts`): online payment start and manual payment reports answer "not found" for a person's invoice, the one recording function refuses it until T3, and the remaining agency-only helpers throw if a person's row ever reaches them, which rolls the step back. The resolver gives a traveller a paid plan only while a paid, unrefunded invoice of their current subscription covers now. Storage limits come from the record owner's plan (`account_storage_bytes`, `person_storage_bytes`), else the upload settings, and the account total is always the owner's, whoever uploads (this fixes the contributor gap). A test compares the migrated database with the declared schema for the six billing tables.
- **Who assigned a subscription (T2, migration 0111):** instead of "set null when the assigner is deleted" (which would have changed today's account deletions), the column may be empty only on a person's own purchase; a database rule keeps it required on every organization's subscription, so an agency assigner still cannot be deleted, exactly as before.
- **Moved:** the `SelfScope` gate and its ratchet rule move to T3, the first code that returns or changes a person's billing rows (checkout, invoices, receipts). In T2 the only code that reads person billing tables is the resolver's "does a paid period cover now" check for the account the caller already acts as, like AI use today. Creating and pricing traveller plans on the Plans page moves to T2b, so until then no paid traveller plan can exist and everything above stays dormant.
