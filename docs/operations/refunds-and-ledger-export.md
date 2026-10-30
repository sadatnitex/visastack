# Refunds, credits and the monthly accounting file (S18)

Contract: ADR 0020, Phase 2 and the S18 amendment (30 Oct 2026). Code: `packages/services/src/refunds.ts` (refunds, credits, refunds made outside VisaStack, the daily check), `ledger-export.ts` (the monthly file), `applyInvoiceRefund` in `invoice-ledger.ts` (the one place a refund reaches the ledger), the refund methods of `SslcommerzPaymentPort` in `packages/adapters/src/payment.ts`. Screens: the admin organization page (`/app/admin/organizations/<id>`, card "Refunds and Credits") and Billing Rules (`/app/admin/billing`, card "Monthly Accounting File").

Status on 30 Oct 2026: built and tested, not merged and not live. Migration 0104 runs only on the owner's word (O8). Refunds through SSLCOMMERZ also need O6 (credentials), the outbound address decision (O18) and the switch `PAYMENT_REFUNDS_VIA_GATEWAY=true` (Vercel Production, exactly "true"; off by default). While it is off, the card offers only **Record a Refund Made Outside VisaStack** and says that refunds are made in the payment gateway's merchant panel and recorded here. An incomplete payment configuration never breaks the page: gateway actions are simply not offered.

## Who can do this

Only the platform owner (`BILLING_REFUND_MANAGE` and `BILLING_LEDGER_EXPORT`, held by no other role). Every action that moves or releases money asks you to confirm it is you (password, plus your authenticator code when staff codes are on). "Check Now" does not ask: it only records what the gateway itself confirms.

## The rules in plain words

- Money leaves an invoice's record only when it has really gone back: when the gateway confirms a refund, or when you record a refund you made another way, with its reference and day.
- A payment can never give back more than it brought in, counting refunds that are still on their way.
- An invoice with any refund is never owed again. It is not chased, not overdue, cannot be paid online and cannot take a payment report. Its agency sees Refunded or Partly Refunded and nothing owed. If money is genuinely owed again, issue a new invoice. A fully refunded invoice (nothing collected) can be voided as before.
- Held money (a payment the gateway confirmed that VisaStack did not count, listed under "Payments Needing a Check") is either applied to an open invoice once, or refunded. Refunding held money does not touch any invoice, because it was never counted.
- The agency's owners and admins get a notice (in the app and by email) for each refund and credit. It names the invoice, never an amount.

## How to refund through the payment gateway

1. Open the agency on `/app/admin/organizations`, then the "Refunds and Credits" card.
2. Under "Payments That Can Be Refunded" (or "Payments Needing a Check" for held money), open **Refund** on the payment. It is offered only for money paid online, when the gateway can be asked.
3. Enter the amount (up to what is shown) and a reason, then **Send Refund**, and confirm it is you.
4. What you see next:
   - "sent to the payment gateway": the refund is listed as **Sent (Waiting for Confirmation)**. Nothing is taken off the invoice yet.
   - "The payment gateway refused this refund": listed as **Not Completed**. Nothing changed.
   - "We could not confirm the refund was sent": see below.
5. The daily payment check (the `process-payment-reconciliation` job) asks the gateway about every sent refund. **Check Now** on the card does the same for this agency at once. When the gateway says refunded, the refund shows as **Refunded** and the invoice total drops; if the gateway cancelled it, it shows as **Not Completed**.

## What to do on "We could not confirm the refund was sent"

The refund is listed as **Waiting to Send**. It still counts against what that payment can give back, so it can never be sent twice by accident.

1. Open the SSLCOMMERZ merchant panel and look for a refund on that payment. VisaStack's refund id is the refund request id; it is sent as the refund's reference.
2. If the refund **is** there: open **It Went Through** on the refund, enter the panel's refund reference and the day it was made (not before the day the refund was asked for, not in the future), and confirm it is you. The refund shows as **Refunded** and the invoice total drops, in one step.
3. If the refund **is not** there: open **It Did Not Go Through**, give a reason ("not in the panel") and confirm it is you. The amount can be refunded again. While the gateway switch is on you may instead **Send Again**: it is sent with the same refund id.
4. If **Send Again** is answered "failed", the amount stays blocked: a "failed" to a second send can mean the first one already went through. Check the panel and choose It Went Through or It Did Not Go Through; Send Again is no longer offered for that refund.

Nothing confirms a refund waiting to send by itself: you decide, from the merchant panel.

A refund marked **Needs a Check** was confirmed by the gateway, but the invoice no longer holds that much money, so nothing was taken off. It stays listed (and is asked about last each day) until a person looks at the invoice and the panel.

## How to record a refund made outside VisaStack

The day refunded cannot be before the day the money came in, nor in the future.

Use this for a payment typed in by hand or reported by the agency (refunded by bank transfer or bKash), and for any refund made in the SSLCOMMERZ panel (for example while live gateway refunds are not set up, O18).

1. On the payment, open **Record a Refund Made Outside VisaStack**.
2. Enter the amount refunded, the reference (the transfer id, or the panel's refund reference), the day it was made (not in the future) and a reason. **Record Refund**, then confirm it is you.
3. It is recorded as **Refunded** at once, and the invoice total drops in the same moment. For held money, the payment is closed when nothing is left of it.

## How to apply held money to an invoice

1. Under "Payments Needing a Check", open **Apply to Next Invoice** on the payment. It is offered only where the gateway confirmed exactly this payment (the invoice was already paid or cancelled, or the gateway flagged a risk). Money held because the gateway's answer did not match can only be refunded.
2. Leave "The Open Invoice Due First" or choose another open invoice of the same agency in the same currency. Refunded invoices are never offered.
3. **Apply to Next Invoice**, then confirm it is you. The credit is the smaller of what is left of the held money and the invoice's balance; whatever is left can only be refunded. A held payment can be applied once.
4. If that pays off everything overdue and VisaStack had set the agency to Grace or Suspended, it returns to Active at once (S17's rule). A status a person set is never changed.

If the agency has no open invoice yet, the card says so: apply the credit after its next invoice is made, or refund it.

## How to download the monthly accounting file

1. Open `/app/admin/billing`, card **Monthly Accounting File**.
2. Choose the month (for example 2026-10) and **Download Accounting File (CSV)**, then confirm it is you. The file downloads as `visastack-ledger-YYYY-MM.csv`.
3. The month is a Bangladesh calendar month (from midnight on the 1st, Bangladesh time), by when each row was recorded. Once a month is over its file never changes.
4. One row per payment, credit or refund that was counted: entry id, when recorded (Bangladesh time), the collected or refunded day, invoice reference, agency code and name, kind, IN or OUT, the exact amount (never with a minus sign), currency, provider and its transaction id, reference, the refund request id for a refund, and whether the gateway or a staff member recorded it. Held money is not in it until it is counted. No traveller data is in it.
5. Every cell is quoted, and a cell that would start a spreadsheet formula starts with an apostrophe instead, so the file is safe to open in Excel or Google Sheets. The file starts with a UTF-8 byte-order mark, so Excel shows Bangla and accented agency names correctly.
6. A month above 20,000 rows is refused with a plain message; nothing is downloaded.

Each download is recorded in the audit trail (`BILLING_LEDGER_EXPORTED`, with the month and the row count).

## Money arriving on a refunded invoice

An invoice with any refund is never owed again. If an online payment for it arrives anyway (for example a payment page opened before the refund), it is held under **Payments Needing a Check** ("The invoice was refunded, so nothing more is owed on it."). Apply it to another open invoice or refund it. A payment typed in or a reported payment on such an invoice is refused with the reason.

## The daily check

The `process-payment-reconciliation` job asks about payments and then sent refunds. It stops starting new gateway calls after about 40 seconds (the job may run for 60) and reports how many were left (`leftForLater`); the next run asks about them. The run reads as failed (503) when the refund check crashed or no sent refund could be asked about, as for payments; refunds not available yet (before 0104) is not a failure.

## Before migration 0104

Run this first in the production database (read only). It must return 0:

```sql
select count(*) from invoice_payments where kind in ('REFUND', 'CREDIT');
```

If it returns anything but 0, stop and tell the owner: a refund or credit was written without a refund request behind it.

Then, with the owner's word, run migration 0104 (`db-migrate.yml`). It is re-runnable from the top, statement by statement. It adds the `REFUNDED` attempt status, the `refund_requests` table with its guard (no deletes; money and source never change; final rows frozen) and two indexes.

Until it runs: the "Refunds and Credits" card says "Refunds are not available yet.", every refund action answers the same, the daily job reports refunds not available, nothing crashes, and the monthly file already works.

To check after it ran:

```sql
select to_regclass('refund_requests') is not null as table_present,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'payment_attempt_status' and e.enumlabel = 'REFUNDED') as status_present;
```

Both must be true.

## Audit events

`INVOICE_REFUND_REQUESTED`, `INVOICE_REFUND_SUBMITTED`, `INVOICE_REFUND_CONFIRMED` (also for It Went Through, with `confirmedBy: staff_from_panel`), `INVOICE_REFUND_NEEDS_CHECK` (once per refund, for `ledger_refused` and `retry_refused`), `INVOICE_REFUND_FAILED`, `INVOICE_REFUND_CANCELLED`, `INVOICE_REFUND_RECORDED`, `INVOICE_CREDIT_APPLIED` (plus the credit's own `INVOICE_PAYMENT_RECORDED`), `PAYMENT_ATTEMPT_STATUS_CHANGED` when a held payment is closed, and `BILLING_LEDGER_EXPORTED`. Each carries ids, statuses and amounts, never a store credential.

## Not verified

- Every SSLCOMMERZ refund detail (parameter names, the meaning of `cancelled`, timing, what a repeated refund id does, partial-refund limits, sandbox behaviour): built from search summaries of the v4 documentation; the documentation site could not be reached. Tested only against a fake gateway.
- Live refunds need the server's outbound address registered with SSLCOMMERZ; Vercel has none fixed by default (O18).
- Nothing here has run against production yet.
