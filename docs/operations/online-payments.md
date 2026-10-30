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
3. The migration `0096_payment_attempts` must have run (it creates the attempts table). Until it has, the code reports "not available yet" and records nothing.
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

## Update 2026-10-30 (S19 step 0): more than one payment provider

Payment providers now come from one registry (`apps/web/src/lib/payment-providers.ts`, ADR 0020 amendment S19 step 0). Today it holds SSLCOMMERZ only, so nothing changes for anyone: the same addresses, the same settings, the same screens. The sentence above "Online payment covers invoices in BDT only" now means "in the currencies the configured providers take" (SSLCOMMERZ: BDT).

- Choosing providers: `PAYMENT_PROVIDERS=sslcommerz` (a comma list, earliest first). Leaving it unset keeps `PAYMENT_PROVIDER=sslcommerz` working exactly as before.
- Result page link: set `PAYMENT_RESULT_SIGNING_SECRET` (at least 32 characters, a secret) in Vercel Production. Without it the link is signed with a key derived from the sign-in cookie secret, which also works. Links made before this change keep working for their hour.
- A provider that is switched off while some of its payments are still open: those payments are left exactly as they are (never closed as expired) and counted in the daily check's answer (`providerNotConfigured`). Switch the provider back on, or settle them by hand in its panel and record them.

## Adding a Payment Provider

For a later direct bKash, Nagad or Rocket integration (owner decision O14 keeps them inside SSLCOMMERZ for now), or any other gateway.

Engineering (one package):

1. Write the adapter `packages/adapters/src/payment-<name>.ts` implementing `PaymentPort` (and `RefundingPaymentPort` if it can refund). Money only from its server-to-server validation or query; fixed error text; the mode (`TEST` for its sandbox, `LIVE`) on the port.
2. Add one entry to `PAYMENT_PROVIDERS` in `apps/web/src/lib/payment-providers.ts`: name, currencies (ISO codes), refunds yes or no, its setting names (including `<NAME>_MODE`, `sandbox` or `live`, no default), its secret names, `callbackPath: '/api/payments/<name>'`, and how to read its callback.
3. List its settings in `.env.example`. The registry contract test (`payment-providers.test.ts`) fails until the currencies, callback folder, secrets, scrubbing and `.env.example` all agree.
4. Nothing else changes: the invoice ledger, the services, the Invoices page, the refund panel and the routes (`/api/payments/[provider]/...`) already serve every registry entry.

Owner steps (after that package is merged):

1. In Vercel Production set `PAYMENT_PROVIDERS` to the list in the order you want, for example `sslcommerz,<name>` (SSLCOMMERZ first keeps taka on SSLCOMMERZ).
2. Set the new provider's settings, `<NAME>_*`, including `<NAME>_MODE=sandbox` first. Secrets only in Vercel, never in a file.
3. Make sure `PAYMENT_RESULT_SIGNING_SECRET` is set (at least 32 characters).
4. In the new provider's merchant panel register `https://vs.obsidianglobal.studio/api/payments/<name>/ipn` as the notification address and `https://vs.obsidianglobal.studio/api/payments/<name>/return` as the return address.
5. Redeploy, then make one small test payment as the platform owner (test mode is owner only). Check: the invoice shows Paid, labelled Test Payment, and the platform overview shows "Online Payments: <Name>" as Test payments only.
6. Switch to live only with your word: `<NAME>_MODE=live` with the live settings.

## Update 2026-10-30 (S19 step 0, round 2)

- **A provider chosen with settings missing is reported, not quietly off:**
  - the readiness check fails, naming the provider and each missing setting (never a value);
  - the daily check answers as a failed run and logs it, while still checking the other providers;
  - each notification to it is logged and answered 503.
  `PAYMENT_PROVIDERS` set to nothing usable (such as `,`) also fails readiness.
- **Stranded payments and refunds stay visible.** A provider is "stranded" when it is switched off while some of its payments or sent refunds are open. The daily check, Check Now and Check Status count those even when no provider is on at all. The payer of such an invoice is told "Your earlier payment was started with a payment method that is switched off now. Contact us before paying again, so you are not charged twice." and is offered no new online payment for that invoice until it is settled. Staff pressing Check Now are told how many sent refunds wait on a payment method that is switched off, and to check them in that method's own panel.
- **Some providers live, some in test mode:**
  - Billing Rules shows Partly Live and names the invoice currencies that can still take only test payments;
  - the status page shows Payments as Partly Live with the same currencies in plain words.
  It says Live only when every provider is live.
- **Refunds of a payment taken with a provider that is switched off** are refused before anything else. The refusal says to refund it in that payment method's own panel and record it with Record a Refund Made Outside VisaStack.
- **Result page links:** only VisaStack's own keys sign them. The old store-password key is gone (decision O2 closed: no such link ever existed, since SSLCOMMERZ was never set up in production). `PAYMENT_RESULT_SIGNING_SECRET` shorter than 32 characters fails readiness. A link made just before you set it keeps working for its hour.
- **The platform overview** row is "Online Payments" (with several providers, "Online Payments in <currency>"), and its detail names the provider.

## Update 2026-10-30 (S19 step 0, round 3)

- Change `PAYMENT_RESULT_SIGNING_SECRET` only when no payment is in progress. A result link lasts one hour, and a link signed with the old value stops working once the value changes.
- A payment counts as stranded only when it was sent to the payment page (still open, or closed as expired) within the last 7 days with a payment method that is switched off now. Only such a payment stops the payer from paying online again. Older ones, and ones that never reached the payment page, never block, but the daily check still counts the open ones for staff.
- A refund of a payment whose payment method is still on but cannot send refunds gets "This payment cannot be refunded through the payment gateway. Refund it another way, then record it here." The "switched off" sentence is only for a payment method that is switched off.
- A provider chosen with settings missing is logged at most once every 10 minutes per running server, however often its addresses are called; each call is still answered 503.
- With no provider set up and the payments table not created yet, the daily check is a quiet run, not a failed one.

## Update 2026-10-30 (S19 step 0, round 4)

- A payer is stopped from paying online again only by a **live** payment that was sent to the payment page in the last 7 days with a payment method that is switched off now, because that gateway may have taken real money. Test payments, payments closed as expired (abandoned checkouts) and payments that never reached the payment page never stop anyone. The daily check still counts them for staff.
- Refund through the Gateway is offered only for a payment method that can refund. When SSLCOMMERZ is switched off, refunding one of its payments says to refund it in SSLCOMMERZ's own panel and record it with Record a Refund Made Outside VisaStack, even if no other payment method can refund.

## Update 2026-10-30 (S19 step 0, round 5): correction to round 4

A live payment closed as expired in the last 7 days also stops the payer from paying online again while its payment method is switched off. The daily check keeps asking about such payments, because they can still succeed late, so paying again could charge twice. In plain terms, a payment blocks when it is live, was sent to the payment page in the last 7 days, is still open or was closed as expired, and its payment method is switched off. Test payments, payments that never reached the payment page, and anything older than 7 days never block.
