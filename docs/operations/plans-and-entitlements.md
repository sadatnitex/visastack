# Plans, entitlements and test payments (S29)

Runbook for the platform owner and whoever operates VisaStack. Decision record: ADR 0020, "Amendment, S29 (30 Oct 2026)". Code: `packages/core/src/entitlements.ts` (the registry), `packages/services/src/entitlements.ts` (the resolver), `packages/services/src/plans-admin.ts` (the Plans page services), `apps/web/src/app/app/admin/plans/` (the page).

## What decides what an agency may use

One resolver answers every limit check and Plan and Usage, in this order:

1. an active commercial override (until its end date): no limits;
2. a plan that lifts every limit (Founding Access, shown as Complimentary): no limits;
3. the agency's billing is Suspended: new team members, invitations, cases and the agency team's own file uploads are paused (travellers keep adding their own files, owner decision O13);
4. the plan's own limits. No plan at all means no limits, never zero.

A plan's rules are rows in `plan_entitlements`, one per plan and key: Team Members, Team Members and Invitations, New Cases, Open Cases, Storage, AI Allowance (shown only, not enforced yet) and one row per AI feature (on or off, and a daily limit per person). Travellers are all on Traveller Free; its AI feature rows are the daily limits every traveller gets.

## Creating and editing plans

Admin > Settings > Plans (`/app/admin/plans`). Platform owner only. Every save asks for a fresh sign-in check; what you typed comes back after it (kept in a signed cookie for this page for 15 minutes, never in the address), and you choose Save again.

- **New Plan:** a name, the billing period in days, a price (amount and three-letter currency code, or both empty for no price), each limit (empty means Unlimited; Storage is in MB) and each AI feature (On, with a daily limit per person or empty for none). A new plan is for agencies.
- **Change a plan:** the same fields. The billing period cannot change once any agency has been on the plan (it would move every billing date); make a new plan instead.
- **Give a plan to an agency:** on the agency's Organizations page, as before. Only agency plans that are offered (not retired) can be given; Traveller Free is never given to an agency.
- Every change is audited with what it was before and after: `PLAN_CREATED`, `PLAN_UPDATED`, `PLAN_PRICE_CHANGED`, `PLAN_RETIRED`.

## Price changes

A new price is a new row in `plan_prices`, in effect from the moment you save. An invoice always uses the price in effect when its billing period started, so:

- the change applies from each agency's next billing period;
- an invoice already made, and the period under way, keep the old price;
- Plan and Usage shows the agency "From {date}, your next billing period, the price is {amount}. Invoices already made keep their amounts."

The first Save of a new price shows exactly this and asks you to tick a box; the second Save stores it. Price history rows are never changed or deleted (the database refuses). Change prices only on the Plans page: after migration 0107 an invoice reads `plan_prices`, so a price typed straight into the `plans` table by SQL is not billed.

## Retiring a plan

Retire Plan on the plan's card. The first press says how many agencies are on it; they keep it, with its limits and price. Tick the box and press again: nobody new can be put on it, and a downgrade scheduled to it is not applied. Traveller Free and Founding Access (the plan every new agency starts on) cannot be retired.

## Test payments

`SSLCOMMERZ_MODE=sandbox` is the gateway's test mode. In it:

- only the platform owner can start an online payment (for an agency they belong to); agencies are told "Online payment is being tested right now, so it is not open to agencies yet. Nothing was charged.";
- the payment is marked TEST on the online payment and on its ledger row (and on any credit or refund made from it), and shows "Test Payment" on the invoice card, the receipt, the invoice and receipt PDFs and the refund panel;
- it marks the invoice paid (that is what is being tested), but it is left out of the Monthly Accounting File; Billing Rules says how many were left out this month;
- a test payment is never refunded through the live gateway, and a real payment never through the test gateway.

Billing Rules shows the mode (Test Payments Only, Live, Not Set Up); the status page shows Payments as "Test Payments Only"; the platform overview has an Online Payments row.

Switching from test to live: set `SSLCOMMERZ_MODE=live` with the live store settings (O6) when no online payment is open. A payment still open from the other mode is closed as expired (reason `mode_changed`) the next time it is checked, without asking the gateway. Reported and staff-recorded payments are always real money.

## Before the database update (migration 0107)

Run these on production (read-only) before giving the word for O8-S29. Each must show no rows, or you confirm what it shows:

```sql
-- 1. Currencies that are not three capital letters once trimmed (the migration refuses them).
select key, currency from plans
where currency is not null and upper(btrim(currency)) !~ '^[A-Z]{3}$';
-- 2. A priced Founding Access plan (it would not be marked as lifting every limit).
select key, price_minor_units from plans
where key = 'agency_founding_access' and coalesce(price_minor_units, 0) <> 0;
-- 3. The plan list: every key except traveller_free becomes an agency plan.
select key, name, active from plans order by key;
-- 4. Online payments so far: every one of them is marked as a test payment.
select count(*), max(created_at) from payment_attempts;
```

Until 0107 runs, everything keeps working on the old columns: limits are read from them, Founding Access is recognised by its key, new agencies are created, payments are recorded (their ledger rows get their mode from the migration). Plans cannot be changed (the page says "Plans can be changed after the database update."), and online payment cannot be started. 0107 is safe to run again from the top after a partial run.

## Setting the O13 days on Billing Rules

Owner decision O13 (30 Oct 2026): Grace 7 days after the due date, Suspended 30 days after it.

1. Open Admin > Settings > Billing Rules (`/app/admin/billing`).
2. Under Change the Rules: Grace 7, Suspended 30, tick Automatic Grace and Suspended.
3. Save. The page first shows how many agencies the rules would move today; tick the box to confirm and Save again (a fresh sign-in check follows).
4. From the next daily run, unpaid agencies move to Grace and then Suspended. Travellers who share records with a Suspended agency keep adding their own files.
