# Recurring invoices, reminders and overdue handling (S17)

Contract: ADR 0020, Phase 2 and the S17 amendment (29 Oct 2026). Code: `packages/services/src/billing-cycle.ts` (the daily run), `billing-settings.ts` (the rules), `billing-history.ts` (status history that works before and after the migration), `invoice-ledger.ts` (reactivation on payment). Page: `/app/admin/billing` (Billing Rules).

## What it does, in plain words

Every day, VisaStack:

1. **Makes invoices.** Each agency on a paid plan gets one invoice at the start of each billing period (the plan's period length, counted from when the agency's plan started). The invoice is due a set number of days (7 unless changed) after the period starts, or after the day it is made if that is later (a missed run, or an agency back to Active after paying), so no invoice is ever born overdue. The agency's owners and admins get a notice in the app and by email with a "Pay Invoice" link to their Invoices page. The notice names the invoice and its due day, never the amount.
2. **Sends reminders** to the same people: 3 days before the due date, on the due date, and 3 and 7 days after. Each is sent once. If a day is missed, only the reminder for where things stand now is sent ("due today" is said only on the due day; after it, "was due on"). Paying or voiding the invoice cancels any reminder still waiting. An agency with no active owner or admin is left out of reminders (so it never uses up the work limit), counted in `withoutContacts` and logged once per run (`billing_cycle_no_contact`).
3. **Changes billing status, only if switched on.** An invoice is overdue from the Bangladesh day after its due day. With "Automatic Grace and Suspended" on, an agency whose oldest overdue invoice is past its due day by the Grace day count moves to Grace, and by the Suspended day count to Suspended (straight to Suspended if it is already that late). Grace at 1, the smallest allowed, moves an agency the day after its due day.
4. **Ends a status it set.** When an agency that VisaStack moved to Grace or Suspended owes nothing overdue any more, it returns to Active: at once when the last overdue invoice is paid in full (in the same database transaction as the payment), or at the next daily run if an invoice was voided. This happens even with automatic handling switched off.

A status a person set is never changed automatically: not lifted when paid, and a Grace a person set is never moved on to Suspended. If a person sets an agency back to Active while an invoice is still overdue, that invoice no longer counts; only invoices that fall due after the person's change do.

## What each status does

| Status | For the agency | For travellers |
|---|---|---|
| Active | Everything works | Nothing changes |
| Grace | Nothing changes; it is a warning | Nothing changes |
| Suspended | Adding cases, team members, invitations and files is paused. Nothing is deleted or hidden; existing cases stay readable | Every record stays visible and nothing is deleted. **Owner decision open (O13):** a traveller who shares records with a suspended agency also cannot add new files, as before S17 |

## Schedule and job

- Route: `GET /api/jobs/process-billing-cycle`, daily at 06:15 UTC (12:15 in Bangladesh), `apps/web/vercel.json`. Signed with the cron secret; refuses without it (503) or with a wrong one (403).
- It sends the notices it queued straight after the run.
- Order: returns to Active first, then invoices, then moves to Grace or Suspended, then reminders. Invoices come before moves, so an agency suspended in a run still gets the invoice for a period that began that day. Each of the four steps starts at most 200 pieces of work of its own, so no step crowds out another; the run stops starting new work after 40 seconds and the next run carries on. Each agency is handled in its own transaction, so one failure is rolled back and tried again the next day.
- Each failure is logged once as a `server_error` line with `where: billingCycle`, the `step` (`return`, `status`, `invoice` or `reminder`), the `organizationId`, the `invoiceId` when there is one, and the error name and database code with its message cleaned by the shared server-error report (no amounts or personal data).
- It returns counts only: `available`, `overdueHandlingEnabled`, `invoicesCreated`, `remindersQueued` (only reminders actually written), `movedToGrace`, `movedToSuspended`, `returnedToActive`, `withoutContacts`, `failed`, `stoppedEarly`. A 503 means it could not start, migration 0103 has not run, or every piece of work failed.
- Days are calendar days in Bangladesh time, from one reading of the database clock.
- Invoice creation (by the run or by hand) is serialised per agency on its billing account row, and a payment always takes that row's lock before deciding anything. Running it again, or twice at once, never makes a second invoice for the same period: the run skips a period that overlaps any invoice for the same agency and plan (void or not), and the database refuses a second live invoice for the same agency, plan and period start. An admin invoice whose period overlaps a live one for the same plan is refused by the same overlap rule.
- Due dates are stored as UTC midnight of their Bangladesh day, so the email and every page show the same day.
- It never bills the past: nothing that started before the migration ran (`billing_settings.invoicing_starts_at`), and after a gap only the period running now. Each agency's first automatic invoice is therefore for its first period that starts after the migration.
- Not billed: trial, suspended or closed billing accounts, agencies without a billing account, suspended or closed organizations, plans priced at zero or without a price.

## Settings (Billing Rules, platform owner only)

`/app/admin/billing`, linked from Platform Settings. Changing anything needs a fresh sign-in check and is audited (`BILLING_SETTINGS_UPDATED`, rules before and after).

| Setting | Standard | Allowed |
|---|---|---|
| Payment Due After (Days) | 7 | 1 to 60 |
| Automatic Grace and Suspended | Off | Off or On (On needs both day counts) |
| Move to Grace (Days After the Due Date) | not set | 1 to 364 (1 means the day after the due date) |
| Suspend (Days After the Due Date) | not set | later than Grace (2 or more), up to 365 |

## Before running migration 0103 in production

The migration adds a unique index that cannot be created if two live invoices already share an agency, plan and period start. Run this read-only check first; it must return no rows:

```sql
select organization_id, plan_id, period_start, count(*)
from invoices
where status <> 'VOID'
group by 1, 2, 3
having count(*) > 1;
```

If it returns rows, void the duplicate (one with nothing collected) from the agency's admin page first, then run the migration. The migration is re-runnable statement by statement. Until it runs: no invoice is made automatically, the run reports `available: false`, Billing Rules says the rules are not available yet, and every existing billing action (opening an account, changing a status, invoices and payments) works as before.

## How to switch automatic Grace and Suspended on (owner, O13)

1. Decide on traveller uploads while an agency is suspended (see the table above). Today they are blocked; S17 keeps that.
2. On Billing Rules, enter the Grace and Suspend day counts and save with the switch still Off. The page then says how many agencies switching on would move today. Old unpaid invoices made by hand count too: void any that should not.
3. Choose On and save. The page shows (as information, not an error) how many agencies exactly those day counts move today, with a box that names the counts; tick it and save again (a fresh sign-in check follows). Changing the day counts while it is on asks for the same confirmation; changing only the due days does not. If you change the numbers after the preview, a fresh preview is shown instead of saving.
4. The next daily run applies it. The admin organization page shows each automatic change as "VisaStack (automatic)" with a plain reason ("Invoice INV-... unpaid 14 days after its due date", "Paid in full", "No unpaid invoices"); the stored reason starts with "system:".

To switch it off, choose Off and save. Statuses already set stay until the agency pays in full or a person changes them.

## When something looks wrong

- **A staff member lost Owner or Admin:** their billing notices disappear from their in-app list, and queued emails to them are not sent.
- **An agency was moved and should not have been:** set its status by hand on the admin organization page (that is a person's decision and the run will not undo it for invoices already overdue), and void or correct the invoice.
- **No invoices appear:** check the agency has a billing account that is Active or in Grace, a current plan with a price above zero, and a period that started after the migration ran.
- **`failed` above zero:** each failure has its own `billingCycle` log line with the step, organization and invoice; the work is retried the next day. A run with failures also logs one `triggerBillingCycle` line with the count.

## Not yet verified

- Not run against production: migration 0103 has not been applied, and no real agency is on a priced plan.
- Concurrency was tested on the in-memory database (two runs at once, two changes by hand at once), not on the production database. The single lock order is checked by a source-order guard test, because the in-memory database runs one transaction at a time and cannot show a deadlock.
- The cron count is now 21; it is assumed to fit the hosting plan, not checked.
