# Paid traveller plans: operations

Design: `docs/adr/0025-paid-traveller-plans.md`. Selling is off (`TRAVELLER_PLANS_ENABLED` unset) until the owner turns it on.

## Migration 0110 (package T1)

What it does: lets a subscription, invoice, online payment, refund request or receipt belong to a person instead of an organization (never both, never neither, checked by the database); adds a person's own receipt numbering, whether a person's plan renews, the subscription an invoice pays for, and two plan rule names for traveller storage. Every existing row stays an organization's. Nothing visible changes and no code uses the new columns yet.

Safe for the running site: it only adds. Today's code never writes or reads the new columns, so it works the same before, during and after the run.

Before running (each must return 0):

```sql
select count(*) from subscriptions where organization_id is null;
select count(*) from invoices where organization_id is null;
select count(*) from payment_attempts where organization_id is null;
select count(*) from refund_requests where organization_id is null;
select count(*) from payment_receipts where organization_id is null;
```

Run: the "Database migrate" workflow from main, typing `migrate`, only with the owner's go-ahead for this run (O8).

After running, each must return 5 (the checks are in place and validated):

```sql
select count(*) from pg_constraint where conname like '%\_one\_payer' and convalidated;
```

If a run stops part way, run it again: every statement can be repeated.

Package T2 (the code that uses these columns) is merged only after this has run in production.
