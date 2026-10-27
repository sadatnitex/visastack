# Online invoice payments (SSLCOMMERZ)

Added in package S11 (ADR 0020). An agency owner or admin can pay an invoice online through the hosted SSLCOMMERZ page. VisaStack never sees card details. Money is counted only when SSLCOMMERZ itself confirms it in a call VisaStack makes to it. Everything here is off until the owner turns it on, and the agency Invoices page that starts a payment arrives with package S12.

## What it does, in plain words

1. A payer starts a payment for one invoice. VisaStack records the attempt, asks SSLCOMMERZ to open a payment page and sends the payer there. The attempt covers the whole amount still owed at that moment.
2. The payer pays (or does not) on the SSLCOMMERZ page.
3. SSLCOMMERZ tells VisaStack in two ways: it sends a notification straight to VisaStack's server, and it sends the payer's browser back. VisaStack believes neither by itself. Each time, it asks SSLCOMMERZ "is this payment real, for how much, in what currency, to which store?" and compares the answer with what it expects.
4. Only when every check passes is the money added to the invoice ledger, once. The invoice becomes Part Paid or Paid.
5. The payer then sees one of four plain results: Payment Received, We Are Confirming Your Payment, Payment Not Completed, Payment Needs a Check.
6. A daily job asks SSLCOMMERZ about payments that never got an answer, so a lost notification does not lose a payment.

## What can and cannot happen

- A browser that claims success, a forged notification, a replayed notification: nothing is recorded. The same real payment arriving by notification, browser and daily job is recorded once.
- A payment with the wrong amount, wrong currency or wrong store, a risky payment (the gateway flags it), or a payment for an invoice that was settled another way in the meantime: the money is not counted. The attempt is marked **Held For Review** with a plain reason. A platform admin decides what to do; a refund is made in the SSLCOMMERZ panel.
- A failed, cancelled or expired payment changes only the attempt. The invoice stays unpaid.
- SSLCOMMERZ unreachable: nothing is decided. VisaStack answers the notification with a "try later" so SSLCOMMERZ sends it again, and the daily job covers the rest.
- A payment that succeeds after VisaStack gave up on it (closed as expired) is still found for seven days and recorded once.
- Online payment covers invoices in BDT only. Other currencies use the manual path.

## Turning it on (owner steps, O6)

1. Open the SSLCOMMERZ sandbox account and note the store id and store password.
2. In Vercel, for the Preview or a test environment first, set `PAYMENT_PROVIDER=sslcommerz`, `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` (a secret) and `SSLCOMMERZ_MODE=sandbox`. `SSLCOMMERZ_MODE` has no default: if it is missing or anything other than `sandbox` or `live`, payments stay off and the platform status reports payments as not configured.
3. The migration `0095_payment_attempts` must have run (it creates the attempts table). Until it has, the code reports "not available yet" and records nothing.
4. In the SSLCOMMERZ merchant panel set the notification address (IPN) to `https://<your domain>/api/payments/sslcommerz/ipn`.
5. Make a sandbox payment of a small test invoice. Check: the invoice shows Paid, the ledger has one Online row, and paying again does nothing.
6. Switch to live only with the owner's word: set `SSLCOMMERZ_MODE=live` with the live store id and password, and the same notification address. There is no other live switch.

## When something looks wrong

- A payer says they paid and the invoice is unpaid: open the invoice; the attempt shows its state. "Redirected" for more than a few minutes means SSLCOMMERZ has not confirmed. The daily job asks again; a platform admin can also run a check by calling `GET /api/jobs/process-payment-reconciliation` with the header `Authorization: Bearer <CRON_SECRET>` (answers with counts only).
- An attempt is **Held For Review**: the reason is one of: `mismatch` (amount, currency or store differed; the audit record names which), `risky_payment`, `risk_unknown`, `already_paid` (the invoice was settled another way), `invoice_void`, `key_conflict`, `not_recordable`. The money is at SSLCOMMERZ and not in the ledger. Refund it in the SSLCOMMERZ panel or settle it through the review tools when they exist (package S18).
- Notifications are refused with 429: more than 300 requests an hour from one address, or more than 30 for one payment. The gateway retries later; the daily job is not limited.
- Sandbox and live are different accounts with different store ids and passwords. Never reuse one for the other.

## Security notes

- The store password is used only to talk to SSLCOMMERZ and to check notification signatures. It is never logged, stored, put in an audit record, shown to the browser or sent anywhere else. Errors carry fixed text, never the gateway's reply.
- The notification address needs no sign-in (SSLCOMMERZ cannot sign in), so it is protected by asking SSLCOMMERZ, by rate limits, and by the ledger's database-level uniqueness (one row per attempt, one per gateway payment id).
- The result page address is signed and lasts one hour. It shows only the payment's own recorded state, never anything the address claims.

## Not yet verified

The official SSLCOMMERZ v4 documentation could not be reached when this was built. Field names, the signature rule, the validation and query replies and the sandbox and live addresses follow the v4 integration as widely documented, and are exercised against a test double only. Before the sandbox account is used, check them against the official documentation (list in the S11 evidence in known-issues).
