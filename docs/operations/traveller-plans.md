# Paid traveller plans: operations

Design: `docs/adr/0025-paid-traveller-plans.md`. No code sells or reads paid traveller plans yet; selling will sit behind a switch that later packages add.

## Migration 0110 (package T1)

What it does: lets a subscription, invoice, online payment, refund request or receipt belong to a person instead of an organization (never both, never neither, checked by the database), and adds a person's own receipt numbering, whether a person's plan renews, and the subscription an invoice pays for. Every existing row stays an organization's.

What people notice:

- Between the merge and the run: the readiness check reports the database as behind (`/api/health/ready` answers `degraded`, the status page headline says some parts are having problems, and the admin overview lists `0110_paid_traveller_plans` as pending). Everything else works as before. Run it soon after the merge.
- After the run: nothing. No code reads or writes the new columns until package T2.

Safe for the running site: it only adds. Each step gives up after 5 seconds instead of making the site wait behind a long query; a step that gave up is simply run again. Do not run it during the nightly database backup (around 05:17 UTC).

Run: the "Database migrate" workflow from main, typing `migrate`, only with the owner's go-ahead for this run (O8).

After running, both must hold:

```sql
-- The migration is recorded as applied (its journal time):
select count(*) from drizzle.__drizzle_migrations where created_at = 1793434153337;   -- 1
-- The five one-payer checks exist and were validated against every row:
select count(*) from pg_constraint where conname like '%\_one\_payer' and convalidated;   -- 5
```

And `/api/health/ready` answers `ready` again.

If a run stops part way, run it again: every statement can be repeated.

Package T2 (the code that uses these columns) is merged only after this has run in production.

## Migration 0111 (package T2)

What it does: lets a person's own purchase record no assigning account (so it never blocks deleting their own account), while a database rule keeps it required on every organization's subscription; and adds two plan rules for traveller storage (the whole account, and each person kept).

What people notice: between the merge and the run, readiness reports the database as behind. After the run, nothing: no paid traveller plan can exist until T2b.

Run outside the nightly backup, with the owner's go-ahead for this run (O8). After running, both must hold:

```sql
select count(*) from drizzle.__drizzle_migrations where created_at = 1793441322837;   -- 1 (0111 recorded)
select count(*) from pg_constraint where conname = 'subscriptions_organization_assigned' and convalidated;   -- 1
```

## Creating a paid traveller plan (package T2b)

On Admin > Settings > Plans, use New Traveller Plan:

- Name, period in days (30 is the default; it cannot change once someone has been on the plan), and the price in BDT. Leave the price empty while the plan is not for sale; a price of 0 is refused.
- Storage for the Whole Account and Storage per Person, in whole MB. Empty follows the upload settings shown beside the box.
- The daily limit of each AI feature per person.

A paid plan can never give less than Traveller Free: the save says which rule to raise. Traveller Free's storage follows the upload settings and is not set on this page.

Nothing is sold yet: every paid traveller plan shows "Not Sold Yet" until checkout (package T3) is switched on, so creating or changing one charges nobody and changes nothing for travellers. Retiring a paid plan stops new purchases; people already on it keep it until the period they paid for ends. Every save asks for a fresh sign-in and is recorded in the audit log.
