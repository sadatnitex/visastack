import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite, migrationsFolder } from '@visastack/db/testing';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import { staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import {
  createInvoice,
  getBillingAccountForOrganization,
  listBillingStatusHistory,
  openBillingAccount,
  recordInvoicePayment,
  transitionBillingStatus,
  voidInvoice,
} from './billing';
import {
  type BillingStanding,
  automaticStatusChange,
  automaticSuspensionDay,
  cycleInvoiceRef,
  previewOverdueHandling,
  reminderStage,
  reminderWords,
  runBillingCycle,
} from './billing-cycle';
import {
  BILLING_SETTINGS_UNAVAILABLE,
  getBillingSettings,
  updateBillingSettings,
} from './billing-settings';
import { billingDay } from './billing-standing';
import type { Db } from './db';
import { listDocuments } from './documents';
import { applyInvoiceCollection } from './invoice-ledger';
import { listMissions } from './missions';
import { titleDate } from './naming';
import { listNotificationsForAccount, runNotificationWorker } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import { canPerformPlatformAction, grantPlatformRole } from './platform-roles';
import type { EmailPort } from './ports';
import { loadWorkspaceToolbarState } from './workspace-toolbar';

const DAY = 24 * 60 * 60 * 1000;
const TEST_TIMEOUT_MS = 120_000;
const scope = () => systemScopeForTest('process-billing-cycle');

function asDb(client: PGlite): Db {
  return drizzle(client, { schema }) as unknown as Db;
}

async function freshDb(): Promise<Db> {
  return asDb(await createMigratedPglite());
}

async function account(db: Db, email: string): Promise<string> {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  return created.value.id;
}

interface World {
  readonly db: Db;
  readonly owner: { readonly accountId: string; readonly email: string };
  readonly actor: { accountId: string; email: string; bootstrapEmails: string[] };
  readonly organizationId: string;
  readonly orgOwnerId: string;
  readonly orgAdminId: string;
  readonly caseManagerId: string;
  readonly planId: string;
}

/** A platform owner, one active agency with an owner, an admin and a case manager, an Active billing account and a priced plan. */
async function world(db: Db, tag: string, platform?: World): Promise<World> {
  const ownerEmail = platform?.owner.email ?? `owner-${tag}@platform.example.com`;
  const ownerId = platform?.owner.accountId ?? (await account(db, ownerEmail));
  if (!platform) {
    const granted = await grantPlatformRole(db, {
      actor: { accountId: ownerId, email: ownerEmail, bootstrapEmails: [ownerEmail] },
      targetAccountId: ownerId,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
  }
  const actor = { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] as string[] };
  const orgOwnerId = await account(db, `agency-owner-${tag}@acme.example.com`);
  const org = await createOrganization(db, { actorAccountId: orgOwnerId, name: `Acme ${tag}` });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await account(db, `reviewer-${tag}@platform.example.com`);
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  const orgAdminId = await account(db, `agency-admin-${tag}@acme.example.com`);
  const caseManagerId = await account(db, `agency-cm-${tag}@acme.example.com`);
  await db.insert(schema.memberships).values([
    { accountId: orgAdminId, organizationId: org.value.id, role: 'ADMIN', active: true },
    { accountId: caseManagerId, organizationId: org.value.id, role: 'CASE_MANAGER', active: true },
  ]);
  const plan = (await db.select().from(schema.plans).where(eq(schema.plans.key, 'agency_pro')))[0];
  if (!plan) throw new Error('plan');
  await db
    .update(schema.plans)
    .set({ priceMinorUnits: 500_000, currency: 'BDT' })
    .where(eq(schema.plans.id, plan.id));
  const opened = await openBillingAccount(db, {
    actor,
    stepUpSatisfied: true,
    organizationId: org.value.id,
    initialStatus: 'ACTIVE',
    reason: 'terms agreed',
  });
  if (!isOk(opened)) throw new Error('billing account');
  // The account was opened long before any invoice in these tests fell due.
  await db
    .update(schema.billingStatusHistory)
    .set({ createdAt: new Date(Date.now() - 400 * DAY) })
    .where(eq(schema.billingStatusHistory.billingAccountId, opened.value.id));
  return {
    db,
    owner: { accountId: ownerId, email: ownerEmail },
    actor,
    organizationId: org.value.id,
    orgOwnerId,
    orgAdminId,
    caseManagerId,
    planId: plan.id,
  };
}

/** Puts the agency on the priced plan from `startedAt`, ending the plan it was given when created. */
async function subscribe(w: World, startedAt: Date): Promise<void> {
  await w.db
    .update(schema.subscriptions)
    .set({ endedAt: startedAt })
    .where(
      and(
        eq(schema.subscriptions.organizationId, w.organizationId),
        isNull(schema.subscriptions.endedAt),
      ),
    );
  await w.db.insert(schema.subscriptions).values({
    organizationId: w.organizationId,
    planId: w.planId,
    startedAt,
    assignedByAccountId: w.owner.accountId,
    reason: 'seed',
  });
}

async function setRules(
  db: Db,
  rules: Partial<typeof schema.billingSettings.$inferInsert>,
): Promise<void> {
  await db.update(schema.billingSettings).set(rules).where(eq(schema.billingSettings.id, true));
}

async function invoicesOf(w: World) {
  return w.db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, w.organizationId));
}

async function notices(db: Db, eventType: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.eventType, eventType));
}

async function status(w: World): Promise<string | undefined> {
  const found = await getBillingAccountForOrganization(w.db, {
    actorAccountId: w.orgOwnerId,
    organizationId: w.organizationId,
  });
  if (!isOk(found)) throw new Error('billing account');
  return found.value?.status;
}

async function historyOf(w: World) {
  const found = await listBillingStatusHistory(w.db, {
    actorAccountId: w.orgOwnerId,
    organizationId: w.organizationId,
  });
  if (!isOk(found)) throw new Error('history');
  return found.value;
}

/**
 * An invoice made by hand, due on `dueDate`, for a one-day period a week earlier (so the
 * invoices one test makes never overlap, which is refused).
 */
async function adminInvoice(w: World, ref: string, dueDate: Date, amount = 5000) {
  const periodStart = new Date(dueDate.getTime() - 7 * DAY);
  const made = await createInvoice(w.db, {
    actor: w.actor,
    stepUpSatisfied: true,
    organizationId: w.organizationId,
    planId: w.planId,
    periodStart,
    periodEnd: new Date(periodStart.getTime() + DAY),
    invoiceRef: ref,
    invoicedAmountMinorUnits: amount,
    currency: 'BDT',
    dueDate,
  });
  if (!isOk(made)) throw new Error(`invoice ${ref}: ${made.error.message}`);
  return made.value;
}

async function pay(w: World, invoiceId: string, amount: number) {
  const paid = await recordInvoicePayment(w.db, {
    actor: w.actor,
    stepUpSatisfied: true,
    invoiceId,
    amountMinorUnits: amount,
    collectedDate: new Date(),
    paymentReference: `bank-${randomUUID().slice(0, 8)}`,
    reason: 'received by transfer',
  });
  if (!isOk(paid)) throw new Error(`payment: ${paid.error.message}`);
  return paid.value;
}

async function setByHand(w: World, toStatus: 'ACTIVE' | 'GRACE' | 'SUSPENDED') {
  const moved = await transitionBillingStatus(w.db, {
    actor: w.actor,
    stepUpSatisfied: true,
    organizationId: w.organizationId,
    toStatus,
    reason: `set by hand to ${toStatus}`,
  });
  if (!isOk(moved)) throw new Error(`transition: ${moved.error.message}`);
}

const POLICY = { graceAfterDays: 7, suspendAfterDays: 30 };

/** The platform owner's scope for the billing rules. */
async function ownerScopeOf(w: World) {
  const minted = await staffPrincipal(
    w.db,
    { accountId: w.owner.accountId, email: w.owner.email, bootstrapEmails: [] },
    'BILLING_SETTINGS_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

async function preview(w: World, now?: Date) {
  const counted = await previewOverdueHandling(w.db, await ownerScopeOf(w), POLICY, now);
  if (!isOk(counted)) throw new Error('preview');
  return counted.value;
}

async function settingsOf(w: World) {
  const read = await getBillingSettings(w.db, await ownerScopeOf(w));
  if (!isOk(read)) throw new Error('settings');
  return read.value;
}

describe('billing cycle rules (pure)', () => {
  it('reaches each reminder stage for its window only, and nothing after day 13', () => {
    const at = (d: number) => reminderStage(d);
    expect([4, 3, 2, 1, 0, -1, -2, -3, -6, -7, -13, -14].map(at)).toEqual([
      null,
      'before_3',
      'before_3',
      'before_3',
      'due_0',
      'due_0',
      'due_0',
      'overdue_3',
      'overdue_3',
      'overdue_7',
      'overdue_7',
      null,
    ]);
  });

  it('names an invoice after the organization and the period start day in Bangladesh', () => {
    // 18:30 UTC on 31 Oct is already 1 Nov in Dhaka.
    expect(
      cycleInvoiceRef('a1b2c3d4-0000-4000-8000-000000000000', new Date('2026-10-31T18:30:00Z')),
    ).toBe('INV-A1B2C3D4-20261101');
  });

  it('never moves a status a person set, and covers only debts due after their change', () => {
    const now = new Date('2026-12-31T06:00:00Z');
    const overdue = (daysAgo: number) => ({
      invoiceId: randomUUID(),
      invoiceRef: `INV-${daysAgo}`,
      dueDate: new Date(now.getTime() - daysAgo * DAY),
    });
    const standing = (s: Partial<BillingStanding>): BillingStanding => ({
      status: 'ACTIVE',
      cause: 'MANUAL',
      changedAt: new Date('2026-01-01T00:00:00Z'),
      overdue: [],
      ...s,
    });
    // Off: nothing moves however late.
    expect(automaticStatusChange(standing({ overdue: [overdue(90)] }), null, now)).toBeNull();
    // On: Grace at 7 days, Suspended at 30, straight there when already past it.
    expect(automaticStatusChange(standing({ overdue: [overdue(6)] }), POLICY, now)).toBeNull();
    expect(automaticStatusChange(standing({ overdue: [overdue(7)] }), POLICY, now)?.toStatus).toBe(
      'GRACE',
    );
    expect(
      automaticStatusChange(standing({ overdue: [overdue(3), overdue(40)] }), POLICY, now),
    ).toMatchObject({ toStatus: 'SUSPENDED', reason: 'system: overdue 40 days (INV-40)' });
    // A Grace or Suspended a person set is never touched.
    for (const s of ['GRACE', 'SUSPENDED'] as const) {
      expect(
        automaticStatusChange(standing({ status: s, overdue: [overdue(90)] }), POLICY, now),
      ).toBeNull();
      expect(automaticStatusChange(standing({ status: s }), POLICY, now)).toBeNull();
    }
    // Active set by a person after the invoice fell due: their decision covers that invoice.
    const later = new Date(now.getTime() - 5 * DAY);
    expect(
      automaticStatusChange(standing({ changedAt: later, overdue: [overdue(40)] }), POLICY, now),
    ).toBeNull();
    // A Grace VisaStack set moves on to Suspended, and returns to Active once nothing is overdue,
    // even with automatic handling switched off.
    expect(
      automaticStatusChange(
        standing({ status: 'GRACE', cause: 'NONPAYMENT', overdue: [overdue(30)] }),
        POLICY,
        now,
      )?.toStatus,
    ).toBe('SUSPENDED');
    expect(
      automaticStatusChange(standing({ status: 'SUSPENDED', cause: 'NONPAYMENT' }), null, now),
    ).toMatchObject({ toStatus: 'ACTIVE', reason: 'system: no overdue invoices' });
    // Trial and Closed accounts are never moved.
    for (const s of ['TRIAL', 'CLOSED'] as const) {
      expect(
        automaticStatusChange(standing({ status: s, overdue: [overdue(90)] }), POLICY, now),
      ).toBeNull();
    }
  });
});

describe('recurring period invoices', () => {
  let db: Db;
  let w: World;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'cycle');
    await setRules(db, { invoicingStartsAt: new Date(Date.now() - 400 * DAY) });
  });

  it(
    'creates one invoice and one set of notices however many times it runs, also two runs at once',
    async () => {
      const started = new Date(Date.now() - 95 * DAY);
      await subscribe(w, started);
      const first = await runBillingCycle(db, scope());
      expect(first).toMatchObject({ available: true, invoicesCreated: 1, failed: 0 });
      const again = await runBillingCycle(db, scope());
      expect(again.invoicesCreated).toBe(0);
      const [a, b] = await Promise.all([
        runBillingCycle(db, scope()),
        runBillingCycle(db, scope()),
      ]);
      expect(a.invoicesCreated + b.invoicesCreated).toBe(0);

      const invoices = await invoicesOf(w);
      expect(invoices).toHaveLength(1);
      const invoice = invoices[0];
      if (!invoice) throw new Error('invoice');
      // Only the period running now: 90 days after the start, 30 days long, due 7 days in.
      expect(invoice.periodStart.getTime()).toBe(started.getTime() + 90 * DAY);
      expect(invoice.periodEnd.getTime()).toBe(started.getTime() + 120 * DAY);
      // Made five days into its period, so due 7 Bangladesh days after today (not after the
      // period start), stored as UTC midnight of that day.
      expect(invoice.dueDate.getTime()).toBe(billingDay(new Date(), 7).getTime());
      expect(invoice.dueDate.getUTCHours()).toBe(0);
      expect(invoice).toMatchObject({
        invoicedAmountMinorUnits: 500_000,
        currency: 'BDT',
        status: 'OPEN',
        invoiceRef: cycleInvoiceRef(w.organizationId, invoice.periodStart),
      });

      // The agency's owner and admin, in the app and by email; never the case manager. The
      // notice names the invoice and its due day, never an amount.
      const issued = await notices(db, 'INVOICE_ISSUED');
      expect(issued.map((n) => `${n.recipientAccountId}:${n.channel}`).sort()).toEqual(
        [
          `${w.orgOwnerId}:EMAIL`,
          `${w.orgOwnerId}:IN_APP`,
          `${w.orgAdminId}:EMAIL`,
          `${w.orgAdminId}:IN_APP`,
        ].sort(),
      );
      const payload = issued[0]?.payload as {
        subject: string;
        summary: string;
        deepLinkPath: string;
      };
      expect(payload.subject).toBe('New Invoice');
      // S30: the first words name the agency.
      expect(payload.summary).toMatch(/^Acme [^:]+: invoice /);
      expect(payload.summary).toContain(invoice.invoiceRef);
      expect(payload.summary).not.toMatch(/5000|500000|BDT|5,000/);
      expect(payload.deepLinkPath).toBe(`/app/agency/${w.organizationId}/plan/invoices`);

      const audit = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'INVOICE_CREATED'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ method: 'SYSTEM', actorAccountId: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'bills the next period when it begins, never the past, and nothing before billing rules existed',
    async () => {
      const started = new Date(Date.now() - 95 * DAY);
      await subscribe(w, started);
      // Billing rules came in after this period began: it is not billed.
      await setRules(db, { invoicingStartsAt: new Date(Date.now() - 2 * DAY) });
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);
      // The next period, which begins after the rules, is billed when it begins.
      const nextStart = new Date(started.getTime() + 120 * DAY);
      const atNext = await runBillingCycle(db, scope(), {
        now: new Date(nextStart.getTime() + 1000),
      });
      expect(atNext.invoicesCreated).toBe(1);
      // A run down for three periods bills only the period running at that moment.
      const muchLater = new Date(nextStart.getTime() + 95 * DAY);
      expect((await runBillingCycle(db, scope(), { now: muchLater })).invoicesCreated).toBe(1);
      const starts = (await invoicesOf(w)).map((i) => i.periodStart.getTime()).sort();
      expect(starts).toEqual([nextStart.getTime(), started.getTime() + 210 * DAY]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'skips a period an invoice made by hand already covers, and agencies it must not bill',
    async () => {
      const started = new Date(Date.now() - 10 * DAY);
      await subscribe(w, started);
      // An admin invoice for this period that starts at a different time of day.
      const made = await createInvoice(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        organizationId: w.organizationId,
        planId: w.planId,
        periodStart: new Date(started.getTime() - 3 * 60 * 60 * 1000),
        periodEnd: new Date(started.getTime() + 30 * DAY),
        invoiceRef: 'INV-BY-HAND',
        invoicedAmountMinorUnits: 500_000,
        currency: 'BDT',
        dueDate: new Date(started.getTime() + 7 * DAY),
      });
      expect(isOk(made)).toBe(true);
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);
      // Voiding it does not make the run bill the period again.
      if (isOk(made)) {
        await voidInvoice(db, {
          actor: w.actor,
          stepUpSatisfied: true,
          invoiceId: made.value.id,
          reason: 'issued in error',
        });
      }
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);

      // Trial and Suspended accounts, suspended organizations, free plans: nothing billed.
      const other = await world(db, 'skipped', w);
      await subscribe(other, new Date(Date.now() - DAY));
      await setByHand(other, 'SUSPENDED');
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);
      await setByHand(other, 'ACTIVE');
      await db
        .update(schema.organizations)
        .set({ status: 'SUSPENDED' })
        .where(eq(schema.organizations.id, other.organizationId));
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);
      await db
        .update(schema.organizations)
        .set({ status: 'ACTIVE' })
        .where(eq(schema.organizations.id, other.organizationId));
      await db
        .update(schema.plans)
        .set({ priceMinorUnits: 0 })
        .where(eq(schema.plans.id, other.planId));
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);
      await db
        .update(schema.plans)
        .set({ priceMinorUnits: 500_000 })
        .where(eq(schema.plans.id, other.planId));
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops at its work limit and carries on at the next run',
    async () => {
      await subscribe(w, new Date(Date.now() - DAY));
      const other = await world(db, 'second', w);
      await subscribe(other, new Date(Date.now() - DAY));
      const first = await runBillingCycle(db, scope(), { limit: 1 });
      expect(first).toMatchObject({ invoicesCreated: 1, stoppedEarly: true });
      const second = await runBillingCycle(db, scope(), { limit: 1 });
      expect(second.invoicesCreated).toBe(1);
      expect((await runBillingCycle(db, scope())).invoicesCreated).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it('refuses a hand-made invoice for a period the run already billed', async () => {
    const started = new Date(Date.now() - DAY);
    await subscribe(w, started);
    await runBillingCycle(db, scope());
    const billed = (await invoicesOf(w))[0];
    if (!billed) throw new Error('invoice');
    const duplicate = await createInvoice(db, {
      actor: w.actor,
      stepUpSatisfied: true,
      organizationId: w.organizationId,
      planId: w.planId,
      periodStart: billed.periodStart,
      periodEnd: billed.periodEnd,
      invoiceRef: 'INV-DUPLICATE',
      invoicedAmountMinorUnits: 500_000,
      currency: 'BDT',
      dueDate: billed.dueDate,
    });
    expect(isErr(duplicate) && duplicate.error.code).toBe('invalid');
    expect(await invoicesOf(w)).toHaveLength(1);
  });
});

describe('reminders', () => {
  let db: Db;
  let w: World;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'remind');
  });

  async function stagesSent(invoiceId: string): Promise<Record<string, number>> {
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventType, 'INVOICE_REMINDER'),
          eq(schema.notifications.resourceId, invoiceId),
        ),
      );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const stage = row.idempotencyKey.split(':').at(-1) ?? '';
      counts[stage] = (counts[stage] ?? 0) + 1;
    }
    return counts;
  }

  it(
    'sends each stage once, to owners and admins in both channels, rerun every day',
    async () => {
      const due = new Date(Date.now() + 20 * DAY);
      const invoice = await adminInvoice(w, 'INV-REMIND', due);
      for (let day = -5; day <= 15; day++) {
        // Twice a day: a rerun sends nothing new.
        for (let run = 0; run < 2; run++) {
          await runBillingCycle(db, scope(), { now: new Date(due.getTime() + day * DAY) });
        }
      }
      // Two contacts times two channels for each stage.
      expect(await stagesSent(invoice.id)).toEqual({
        before_3: 4,
        due_0: 4,
        overdue_3: 4,
        overdue_7: 4,
      });
      const today = (await notices(db, 'INVOICE_REMINDER')).find((n) =>
        n.idempotencyKey.endsWith(':due_0'),
      );
      expect(today?.payload).toMatchObject({
        subject: 'Invoice Due Today',
        timing: 'today',
        deepLinkPath: `/app/agency/${w.organizationId}/plan/invoices`,
      });
      expect(JSON.stringify(today?.payload)).not.toMatch(/5000|BDT/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends only the stage reached when days were missed, and nothing once paid',
    async () => {
      const due = new Date(Date.now() + 20 * DAY);
      const late = await adminInvoice(w, 'INV-SKIPPED', due);
      await runBillingCycle(db, scope(), { now: new Date(due.getTime() + 4 * DAY) });
      expect(await stagesSent(late.id)).toEqual({ overdue_3: 4 });

      const paidDue = new Date(Date.now() + 25 * DAY);
      const paidLater = await adminInvoice(w, 'INV-PAID', paidDue);
      await runBillingCycle(db, scope(), { now: new Date(paidDue.getTime() - 3 * DAY) });
      expect(await stagesSent(paidLater.id)).toEqual({ before_3: 4 });
      await pay(w, paidLater.id, 5000);
      // Still queued reminders for a paid invoice never go out.
      const left = await db
        .select({ status: schema.notifications.status })
        .from(schema.notifications)
        .where(eq(schema.notifications.resourceId, paidLater.id));
      expect(new Set(left.map((r) => r.status))).toEqual(new Set(['CANCELLED']));
      for (const day of [0, 3, 7]) {
        await runBillingCycle(db, scope(), { now: new Date(paidDue.getTime() + day * DAY) });
      }
      expect(await stagesSent(paidLater.id)).toEqual({ before_3: 4 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'checks again when sending that the person is still an owner or admin',
    async () => {
      const due = new Date(Date.now() + 2 * DAY);
      await adminInvoice(w, 'INV-ROLE', due);
      await runBillingCycle(db, scope(), { now: new Date() });
      await db
        .update(schema.memberships)
        .set({ role: 'CASE_MANAGER' })
        .where(eq(schema.memberships.accountId, w.orgAdminId));
      const sent: string[] = [];
      const email: EmailPort = {
        send: async (message) => {
          sent.push(message.to);
          return { providerMessageId: randomUUID() };
        },
      };
      await runNotificationWorker(db, email, 'https://app.example.test');
      const rows = await notices(db, 'INVOICE_REMINDER');
      const byRecipient = (id: string) =>
        rows.filter((r) => r.recipientAccountId === id).map((r) => r.status);
      expect(new Set(byRecipient(w.orgOwnerId))).toEqual(new Set(['SENT']));
      expect(new Set(byRecipient(w.orgAdminId))).toEqual(new Set(['FAILED']));
      expect(sent).toContain('agency-owner-remind@acme.example.com');
      expect(sent).not.toContain('agency-admin-remind@acme.example.com');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('overdue handling and reactivation', () => {
  let db: Db;
  let w: World;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'overdue');
  });

  it(
    'changes nothing while switched off, however late, and nothing when the rules table is missing',
    async () => {
      await adminInvoice(w, 'INV-LATE', new Date(Date.now() - 40 * DAY));
      const off = await runBillingCycle(db, scope());
      expect(off).toMatchObject({ overdueHandlingEnabled: false, movedToSuspended: 0 });
      expect(await status(w)).toBe('ACTIVE');
      // Day counts saved but the switch left off: still nothing.
      await setRules(db, { ...POLICY, overdueHandlingEnabled: false });
      const saved = await runBillingCycle(db, scope());
      expect(saved).toMatchObject({ overdueHandlingEnabled: false, movedToSuspended: 0 });
      expect(await status(w)).toBe('ACTIVE');
      expect(await historyOf(w)).toHaveLength(1);

      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await db.execute(sql`drop table billing_settings`);
      expect(await runBillingCycle(db, scope())).toMatchObject({
        available: false,
        movedToSuspended: 0,
      });
      expect(await status(w)).toBe('ACTIVE');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'moves to Grace at 7 days and Suspended at 30 when on, recorded as VisaStack, previewed first',
    async () => {
      const base = new Date();
      const invoice = await adminInvoice(w, 'INV-OWED', new Date(base.getTime() - 7 * DAY));
      expect(await preview(w, base)).toEqual({
        toGrace: 1,
        toSuspended: 0,
      });
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      const graced = await runBillingCycle(db, scope(), { now: base });
      expect(graced).toMatchObject({ overdueHandlingEnabled: true, movedToGrace: 1 });
      expect(await status(w)).toBe('GRACE');
      expect((await runBillingCycle(db, scope(), { now: base })).movedToGrace).toBe(0);

      const later = new Date(base.getTime() + 23 * DAY);
      expect((await runBillingCycle(db, scope(), { now: later })).movedToSuspended).toBe(1);
      expect(await status(w)).toBe('SUSPENDED');
      const [suspended, grace] = await historyOf(w);
      expect(suspended).toMatchObject({
        fromStatus: 'GRACE',
        toStatus: 'SUSPENDED',
        actorAccountId: null,
        cause: 'NONPAYMENT',
        reason: `system: overdue 30 days (${invoice.invoiceRef})`,
      });
      expect(grace).toMatchObject({ toStatus: 'GRACE', cause: 'NONPAYMENT' });
      const notes = await notices(db, 'BILLING_STATUS_CHANGED');
      expect(notes).toHaveLength(8);
      const suspendedNotice = notes.find((n) =>
        (n.payload as { subject: string }).subject.includes('Suspended'),
      )?.payload;
      expect(suspendedNotice).toMatchObject({
        subject: 'Your Agency Is Suspended',
        heading: 'Your agency is suspended',
        deepLinkPath: `/app/agency/${w.organizationId}/plan/invoices`,
      });
      expect((suspendedNotice as { summary: string }).summary).toMatch(/^Acme [^:]+: invoice /);
      expect(
        notes.find((n) => (n.payload as { subject: string }).subject.includes('Grace'))?.payload,
      ).toMatchObject({ subject: 'Your Agency Is in Grace', heading: 'Your agency is in Grace' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'goes straight to Suspended when already past it when switched on',
    async () => {
      await adminInvoice(w, 'INV-OLD', new Date(Date.now() - 40 * DAY));
      expect(await preview(w)).toEqual({ toGrace: 0, toSuspended: 1 });
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      expect((await runBillingCycle(db, scope())).movedToSuspended).toBe(1);
      expect(await historyOf(w)).toHaveLength(2);
      expect((await historyOf(w))[0]).toMatchObject({
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'returns to Active in the same transaction as a full payment, not after a partial one',
    async () => {
      const first = await adminInvoice(w, 'INV-ONE', new Date(Date.now() - 40 * DAY));
      const second = await adminInvoice(w, 'INV-TWO', new Date(Date.now() - 35 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('SUSPENDED');

      await pay(w, first.id, 2000);
      expect(await status(w)).toBe('SUSPENDED');
      await pay(w, first.id, 3000);
      // Another invoice is still overdue.
      expect(await status(w)).toBe('SUSPENDED');

      // Paying the last one online (provider-confirmed) ends the suspension at once.
      const paid = await db.transaction(async (tx) =>
        applyInvoiceCollection(tx, {
          invoiceId: second.id,
          amountMinorUnits: 5000,
          currency: 'BDT',
          kind: 'ONLINE',
          sourceId: randomUUID(),
          provider: 'sslcommerz',
          providerTransactionId: `val-${randomUUID()}`,
          reference: 'gateway',
          collectedDate: new Date(),
          recordedByAccountId: null,
        }),
      );
      expect(isOk(paid) && paid.value.reactivated).toBe(true);
      expect(await status(w)).toBe('ACTIVE');
      expect((await historyOf(w))[0]).toMatchObject({
        fromStatus: 'SUSPENDED',
        toStatus: 'ACTIVE',
        actorAccountId: null,
        cause: 'NONPAYMENT',
        reason: 'system: paid',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'returns to Active through an admin recording, and a failure after it undoes both',
    async () => {
      const owed = await adminInvoice(w, 'INV-ROLLBACK', new Date(Date.now() - 10 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('GRACE');

      await expect(
        db.transaction(async (tx) => {
          const applied = await applyInvoiceCollection(tx, {
            invoiceId: owed.id,
            amountMinorUnits: 5000,
            currency: 'BDT',
            kind: 'ADMIN_RECORDED',
            sourceId: randomUUID(),
            reference: 'bank',
            collectedDate: new Date(),
            recordedByAccountId: w.owner.accountId,
          });
          expect(isOk(applied) && applied.value.reactivated).toBe(true);
          throw new Error('the caller failed after recording');
        }),
      ).rejects.toThrow('the caller failed');
      expect(await status(w)).toBe('GRACE');
      expect((await invoicesOf(w))[0]?.status).toBe('OPEN');

      await pay(w, owed.id, 5000);
      expect(await status(w)).toBe('ACTIVE');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'never lifts a suspension a person set, even after a VisaStack Grace, and never escalates a person Grace',
    async () => {
      const owed = await adminInvoice(w, 'INV-MANUAL', new Date(Date.now() - 10 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('GRACE');
      await setByHand(w, 'SUSPENDED');
      await pay(w, owed.id, 5000);
      expect(await status(w)).toBe('SUSPENDED');
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('SUSPENDED');

      // A Grace a person set stays Grace however late the invoice gets.
      await setByHand(w, 'ACTIVE');
      await setByHand(w, 'GRACE');
      await adminInvoice(w, 'INV-MANUAL-2', new Date(Date.now() - 2 * DAY));
      await runBillingCycle(db, scope(), { now: new Date(Date.now() + 60 * DAY) });
      expect(await status(w)).toBe('GRACE');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves an Active a person set while an invoice was overdue, and returns to Active when an invoice is voided',
    async () => {
      const owed = await adminInvoice(w, 'INV-RESTORED', new Date(Date.now() - 40 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('SUSPENDED');
      await setByHand(w, 'ACTIVE');
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('ACTIVE');

      // A later invoice that falls overdue after the person's change counts again.
      await db
        .update(schema.invoices)
        .set({ dueDate: new Date(Date.now() + DAY) })
        .where(eq(schema.invoices.id, owed.id));
      await runBillingCycle(db, scope(), { now: new Date(Date.now() + 9 * DAY) });
      expect(await status(w)).toBe('GRACE');

      // Switched off, and the invoice voided: VisaStack's Grace ends.
      await setRules(db, { overdueHandlingEnabled: false });
      await voidInvoice(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        invoiceId: owed.id,
        reason: 'issued in error',
      });
      const back = await runBillingCycle(db, scope());
      expect(back.returnedToActive).toBe(1);
      expect((await historyOf(w))[0]).toMatchObject({
        toStatus: 'ACTIVE',
        reason: 'system: no overdue invoices',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps every traveller record and the agency's granted case read exactly as before a suspension",
    async () => {
      const travellerId = await account(db, 'traveller-overdue@example.com');
      const [applicant] = await db
        .insert(schema.applicants)
        .values({ ownerAccountId: travellerId, displayName: 'Synthetic Traveller' })
        .returning();
      if (!applicant) throw new Error('applicant');
      await db
        .insert(schema.documents)
        .values({ applicantId: applicant.id, originalName: 'passport.pdf' });
      await db.insert(schema.missions).values({ applicantId: applicant.id, title: 'Visit Japan' });
      await db.insert(schema.grants).values({
        applicantId: applicant.id,
        recipientOrganizationId: w.organizationId,
        actions: ['VIEW_METADATA', 'PREVIEW'],
        purpose: 'visa_application',
        status: 'ACTIVE',
        acceptedAt: new Date(),
      });
      const snapshot = async () => {
        const documents = await listDocuments(db, travellerId, applicant.id);
        const missions = await listMissions(db, travellerId, applicant.id);
        const read = await requireAccess(
          db,
          accountPrincipal(w.orgOwnerId),
          'VIEW_METADATA',
          { applicantId: applicant.id },
          { purpose: EACH_GRANT, actingFor: { organizationId: w.organizationId } },
        );
        return {
          documents: isOk(documents) ? documents.value.map((d) => d.id) : 'refused',
          missions: isOk(missions) ? missions.value.map((m) => m.id) : 'refused',
          agencyRead: isOk(read),
        };
      };
      const before = await snapshot();
      expect(before.agencyRead).toBe(true);
      await adminInvoice(w, 'INV-VISIBLE', new Date(Date.now() - 40 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('SUSPENDED');
      expect(await snapshot()).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('billing rules', () => {
  let db: Db;
  let w: World;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'rules');
  });

  async function ownerScope() {
    const minted = await staffPrincipal(
      db,
      { accountId: w.owner.accountId, email: w.owner.email, bootstrapEmails: [] },
      'BILLING_SETTINGS_MANAGE',
    );
    if (!isOk(minted)) throw new Error('scope');
    return minted.value;
  }

  it('starts with the standard rules: due after 7 days, automatic handling off', async () => {
    expect(await settingsOf(w)).toMatchObject({
      available: true,
      dueDays: 7,
      overdueHandlingEnabled: false,
      graceAfterDays: null,
      suspendAfterDays: null,
    });
  });

  it('is the platform owner alone, with a fresh sign-in check, validated and audited', async () => {
    for (const role of ['SECURITY_ADMIN', 'COMPLIANCE_ADMIN', 'SUPPORT_ADMIN', 'QUALITY_ADMIN']) {
      const email = `${role.toLowerCase()}@platform.example.com`;
      const id = await account(db, email);
      await grantPlatformRole(db, {
        actor: { ...w.actor, bootstrapEmails: [w.owner.email] },
        targetAccountId: id,
        role: role as 'SECURITY_ADMIN',
        reason: 'seed',
        stepUpSatisfied: true,
      });
      expect(
        await canPerformPlatformAction(
          db,
          { accountId: id, email, bootstrapEmails: [] },
          'BILLING_SETTINGS_MANAGE',
        ),
      ).toBe(false);
    }
    const staff = await ownerScope();
    const rules = {
      dueDays: 10,
      overdueHandlingEnabled: true,
      graceAfterDays: 7,
      suspendAfterDays: 30,
    };
    const noStepUp = await updateBillingSettings(db, staff, { ...rules, stepUpSatisfied: false });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
    for (const bad of [
      { ...rules, dueDays: 0 },
      { ...rules, graceAfterDays: 30, suspendAfterDays: 30 },
      { ...rules, graceAfterDays: null, suspendAfterDays: null },
      { ...rules, overdueHandlingEnabled: false, graceAfterDays: 7, suspendAfterDays: null },
    ]) {
      const refused = await updateBillingSettings(db, staff, { ...bad, stepUpSatisfied: true });
      expect(isErr(refused) && refused.error.code).toBe('invalid');
    }
    const forged = { ...staff } as typeof staff;
    expect(
      isErr(await updateBillingSettings(db, forged, { ...rules, stepUpSatisfied: true })),
    ).toBe(true);
    const saved = await updateBillingSettings(db, staff, { ...rules, stepUpSatisfied: true });
    expect(isOk(saved) && saved.value.changed).toBe(true);
    expect(await settingsOf(w)).toMatchObject({
      ...rules,
      updatedByAccountId: w.owner.accountId,
    });
    const again = await updateBillingSettings(db, staff, { ...rules, stepUpSatisfied: true });
    expect(isOk(again) && again.value.changed).toBe(false);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'BILLING_SETTINGS_UPDATED'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({ after: rules });
  });

  it('bills new periods with the saved due days', async () => {
    await setRules(db, { invoicingStartsAt: new Date(Date.now() - 400 * DAY) });
    const staff = await ownerScope();
    await updateBillingSettings(db, staff, {
      dueDays: 14,
      overdueHandlingEnabled: false,
      graceAfterDays: null,
      suspendAfterDays: null,
      stepUpSatisfied: true,
    });
    const started = new Date(Date.now() - DAY);
    await subscribe(w, started);
    await runBillingCycle(db, scope());
    expect((await invoicesOf(w))[0]?.dueDate.getTime()).toBe(billingDay(new Date(), 14).getTime());
  });
});

describe('before migration 0103', () => {
  it(
    'keeps every existing billing action working while the run and the rules report not available',
    async () => {
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      const at = journal.entries.findIndex((e) => e.tag === '0103_billing_cycle');
      const prior = journal.entries.slice(0, at);
      const folder = mkdtempSync(join(tmpdir(), 'visastack-before-0103-'));
      mkdirSync(join(folder, 'meta'), { recursive: true });
      writeFileSync(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: prior }),
      );
      for (const entry of prior) {
        copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      }
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folder });
      const db = asDb(client);

      // Every old path: open, move, list history, invoice, pay in full, void.
      const w = await world(db, 'before');
      await setByHand(w, 'GRACE');
      const history = await historyOf(w);
      expect(history.map((h) => [h.toStatus, h.cause, h.actorAccountId])).toEqual([
        ['GRACE', 'MANUAL', w.owner.accountId],
        ['ACTIVE', 'MANUAL', w.owner.accountId],
      ]);
      const invoice = await adminInvoice(w, 'INV-BEFORE', new Date(Date.now() - 40 * DAY));
      const paid = await pay(w, invoice.id, 5000);
      expect(paid.status).toBe('PAID');
      expect(await status(w)).toBe('GRACE');
      const other = await adminInvoice(w, 'INV-BEFORE-2', new Date(Date.now() - 20 * DAY));
      expect(
        isOk(
          await voidInvoice(db, {
            actor: w.actor,
            stepUpSatisfied: true,
            invoiceId: other.id,
            reason: 'issued in error',
          }),
        ),
      ).toBe(true);
      await subscribe(w, new Date(Date.now() - DAY));

      expect(await runBillingCycle(db, scope())).toMatchObject({
        available: false,
        invoicesCreated: 0,
      });
      expect(await settingsOf(w)).toMatchObject({ available: false, dueDays: 7 });
      expect(await preview(w)).toEqual({ toGrace: 0, toSuspended: 0 });
      const minted = await staffPrincipal(
        db,
        { accountId: w.owner.accountId, email: w.owner.email, bootstrapEmails: [] },
        'BILLING_SETTINGS_MANAGE',
      );
      if (!isOk(minted)) throw new Error('scope');
      const refused = await updateBillingSettings(db, minted.value, {
        dueDays: 7,
        overdueHandlingEnabled: false,
        graceAfterDays: null,
        suspendAfterDays: null,
        stepUpSatisfied: true,
      });
      expect(isErr(refused) && refused.error.message).toBe(BILLING_SETTINGS_UNAVAILABLE);
      expect(await invoicesOf(w)).toHaveLength(2);

      // Then the migration runs, statement by statement, and the next run bills.
      const statements = readFileSync(
        join(migrationsFolder, '0103_billing_cycle.sql'),
        'utf8',
      ).split('--> statement-breakpoint');
      for (const statement of statements) await client.exec(statement);
      expect((await historyOf(w)).map((h) => h.cause)).toEqual(['MANUAL', 'MANUAL']);
      // Billing rules start now: the period that began yesterday is not billed.
      expect(await runBillingCycle(db, scope())).toMatchObject({
        available: true,
        invoicesCreated: 0,
      });
    },
    TEST_TIMEOUT_MS * 2,
  );
});

describe('who reads billing status', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webSrc = path.resolve(here, '../../../apps/web/src');

  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'node_modules' && name !== '.next') found.push(...sourceFiles(full));
      } else if (
        /\.tsx?$/.test(name) &&
        !/\.test\.tsx?$/.test(name) &&
        !/test-support/.test(name)
      ) {
        found.push(full);
      }
    }
    return found;
  }

  it('is only billing, entitlement enforcement, the billing run and the recording function: no read of traveller records looks at it', () => {
    const readers = [...sourceFiles(here), ...sourceFiles(webSrc)]
      .filter((file) =>
        /billingAccounts|billing_accounts|isBillingSuspended/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => path.relative(path.resolve(here, '../../..'), file))
      .sort();
    expect(readers).toEqual([
      'packages/services/src/billing-cycle.ts',
      'packages/services/src/billing-standing.ts',
      'packages/services/src/billing.ts',
      'packages/services/src/entitlement-enforcement.ts',
      'packages/services/src/index.ts',
      'packages/services/src/invoice-ledger.ts',
    ]);
    // Automatic reactivation lives only inside the one recording function's module.
    const restorers = sourceFiles(here)
      .filter((file) => !file.endsWith('billing-cycle.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('restoreBillingAfterPayment'))
      .map((file) => path.basename(file));
    expect(restorers).toEqual(['invoice-ledger.ts']);
  });
});

describe('round 2: due days, overdue days, overlaps, budgets and notices', () => {
  let db: Db;
  let w: World;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'round2');
    await setRules(db, { invoicingStartsAt: new Date(Date.now() - 400 * DAY) });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'never makes an invoice that is born overdue: paid back to Active, the late invoice keeps it Active',
    async () => {
      const started = new Date(Date.now() - 50 * DAY);
      await subscribe(w, started);
      // The first period's invoice, made on time 50 days ago, is long overdue now.
      await runBillingCycle(db, scope(), { now: new Date(started.getTime() + 1000) });
      const [first] = await invoicesOf(w);
      if (!first) throw new Error('first invoice');
      // Suspended on the last day of the first period (22 days overdue, Suspended at 20).
      await setRules(db, { graceAfterDays: 7, suspendAfterDays: 20, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope(), { now: new Date(started.getTime() + 29 * DAY) });
      expect(await status(w)).toBe('SUSPENDED');
      // Suspended agencies are not billed, so the second period (begun 20 days ago) waits.
      await runBillingCycle(db, scope());
      expect(await invoicesOf(w)).toHaveLength(1);
      await pay(w, first.id, 500_000);
      expect(await status(w)).toBe('ACTIVE');

      // The next run makes the second period's invoice late: due 7 days from today, not from
      // the period start, so neither that run nor the one after moves the agency.
      await runBillingCycle(db, scope());
      const second = (await invoicesOf(w)).find((i) => i.id !== first.id);
      if (!second) throw new Error('second invoice');
      expect(second.periodStart.getTime()).toBe(started.getTime() + 30 * DAY);
      expect(second.dueDate.getTime()).toBe(billingDay(new Date(), 7).getTime());
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('ACTIVE');
    },
    TEST_TIMEOUT_MS,
  );

  it('shows the same due day in the notice as on the pages (stored as UTC midnight)', async () => {
    await subscribe(w, new Date(Date.now() - DAY));
    await runBillingCycle(db, scope());
    const [invoice] = await invoicesOf(w);
    if (!invoice) throw new Error('invoice');
    expect(invoice.dueDate.toISOString()).toMatch(/T00:00:00\.000Z$/);
    // Pages show due dates as UTC days; the notice names the Bangladesh day: the same day.
    expect(titleDate(invoice.dueDate, 'UTC')).toBe(titleDate(invoice.dueDate, 'Asia/Dhaka'));
    const notice = (await notices(db, 'INVOICE_ISSUED'))[0]?.payload as { summary: string };
    expect(notice.summary).toContain(titleDate(invoice.dueDate, 'UTC'));
  });

  it(
    'refuses a hand-made invoice whose midnight-to-midnight period overlaps one the run made at another time of day',
    async () => {
      const started = new Date(Date.now() - DAY);
      started.setUTCHours(15, 42, 0, 0);
      await subscribe(w, started);
      await runBillingCycle(db, scope());
      const [billed] = await invoicesOf(w);
      if (!billed) throw new Error('run invoice');
      // What the admin form sends: whole UTC days around the same period.
      const day = (at: Date) =>
        new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
      const overlapping = await createInvoice(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        organizationId: w.organizationId,
        planId: w.planId,
        periodStart: day(billed.periodStart),
        periodEnd: day(billed.periodEnd),
        invoiceRef: 'INV-ADMIN-OVERLAP',
        invoicedAmountMinorUnits: 500_000,
        currency: 'BDT',
        dueDate: day(billed.dueDate),
      });
      expect(isErr(overlapping) && overlapping.error.code).toBe('invalid');
      // The next period, starting the day the run's period ends, is fine.
      const next = await createInvoice(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        organizationId: w.organizationId,
        planId: w.planId,
        periodStart: billed.periodEnd,
        periodEnd: new Date(billed.periodEnd.getTime() + 30 * DAY),
        invoiceRef: 'INV-ADMIN-NEXT',
        invoicedAmountMinorUnits: 500_000,
        currency: 'BDT',
        dueDate: new Date(billed.periodEnd.getTime() + 7 * DAY),
      });
      expect(isOk(next)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'counts overdue from the Bangladesh day after the due day, also with Grace at 1, and for reactivation',
    async () => {
      await setRules(db, { graceAfterDays: 1, suspendAfterDays: 30, overdueHandlingEnabled: true });
      const today = billingDay(new Date());
      const dueToday = await adminInvoice(w, 'INV-DUE-TODAY', today);
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('ACTIVE');
      // The next Bangladesh day it is overdue, and Grace at 1 moves it.
      const tomorrow = new Date(today.getTime() + DAY + 6 * 60 * 60 * 1000);
      await runBillingCycle(db, scope(), { now: tomorrow });
      expect(await status(w)).toBe('GRACE');
      // Paying an invoice that is due today does not count as clearing an overdue one, and one
      // that is due today does not stop a return to Active.
      await pay(w, dueToday.id, 5000);
      expect(await status(w)).toBe('ACTIVE');
      await setByHand(w, 'GRACE');
      await setByHand(w, 'ACTIVE');
      const old = await adminInvoice(w, 'INV-OLD-R2', new Date(today.getTime() - 40 * DAY));
      const dueTodayAgain = await createInvoice(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        organizationId: w.organizationId,
        planId: w.planId,
        periodStart: new Date(today.getTime() - 100 * DAY),
        periodEnd: new Date(today.getTime() - 99 * DAY),
        invoiceRef: 'INV-TODAY-R2',
        invoicedAmountMinorUnits: 5000,
        currency: 'BDT',
        dueDate: today,
      });
      expect(isOk(dueTodayAgain)).toBe(true);
      await db
        .update(schema.billingStatusHistory)
        .set({ createdAt: new Date(Date.now() - 300 * DAY) });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('SUSPENDED');
      await pay(w, old.id, 5000);
      expect(await status(w)).toBe('ACTIVE');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'returns agencies to Active first, with its own share of the work limit',
    async () => {
      // One agency VisaStack suspended whose invoice was then voided, and two agencies to bill.
      const owed = await adminInvoice(w, 'INV-VOIDED-R2', new Date(Date.now() - 40 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      await runBillingCycle(db, scope());
      expect(await status(w)).toBe('SUSPENDED');
      await setRules(db, { overdueHandlingEnabled: false });
      await voidInvoice(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        invoiceId: owed.id,
        reason: 'issued in error',
      });
      for (const tag of ['bill-a', 'bill-b']) {
        await subscribe(await world(db, tag, w), new Date(Date.now() - DAY));
      }
      const run = await runBillingCycle(db, scope(), { limit: 1 });
      expect(run).toMatchObject({ returnedToActive: 1, invoicesCreated: 1, stoppedEarly: true });
      expect(await status(w)).toBe('ACTIVE');
    },
    TEST_TIMEOUT_MS,
  );

  it('changes a status by hand only from the status it really has, even two changes at once', async () => {
    const results = await Promise.all(
      (['CLOSED', 'GRACE'] as const).map((toStatus) =>
        transitionBillingStatus(db, {
          actor: w.actor,
          stepUpSatisfied: true,
          organizationId: w.organizationId,
          toStatus,
          reason: `at once to ${toStatus}`,
        }),
      ),
    );
    const history = [...(await historyOf(w))].reverse();
    // Every row starts from the status the row before it left the account in.
    for (let n = 1; n < history.length; n++) {
      expect(history[n]?.fromStatus).toBe(history[n - 1]?.toStatus);
    }
    expect((await status(w)) === history.at(-1)?.toStatus).toBe(true);
    expect(results.filter((r) => isOk(r)).length).toBe(history.length - 1);
  });

  it('says "due today" only on the due day and "was due on" after it', async () => {
    expect(reminderWords(0, 'INV-1', '9 Nov 2026')).toMatchObject({
      subject: 'Invoice Due Today',
      timing: 'today',
    });
    expect(reminderWords(-1, 'INV-1', '9 Nov 2026')).toMatchObject({
      subject: 'Invoice Overdue',
      summary: 'Invoice INV-1 was due on 9 Nov 2026 and is still unpaid.',
      timing: 'overdue',
    });
    const due = billingDay(new Date(Date.now() + 20 * DAY));
    const invoice = await adminInvoice(w, 'INV-DAY-AFTER', due);
    await runBillingCycle(db, scope(), { now: new Date(due.getTime() + DAY + 3600_000) });
    const sent = (await notices(db, 'INVOICE_REMINDER')).filter((n) => n.resourceId === invoice.id);
    expect(sent.length).toBe(4);
    for (const row of sent) {
      expect(row.idempotencyKey.endsWith(':due_0')).toBe(true);
      expect(row.payload).toMatchObject({ subject: 'Invoice Overdue', timing: 'overdue' });
    }
  });

  it('names the agency first, and gives the 3-day and 7-day overdue reminders their own words (S30)', () => {
    const name = { agencyName: 'Dhaka Visa Desk' };
    expect(reminderWords(3, 'INV-1', '9 Nov 2026', name)).toEqual({
      subject: 'Invoice Due Soon',
      summary: 'Dhaka Visa Desk: invoice INV-1 is due on 9 Nov 2026.',
      timing: 'upcoming',
    });
    const three = reminderWords(-3, 'INV-1', '9 Nov 2026', { ...name, stage: 'overdue_3' });
    const seven = reminderWords(-7, 'INV-1', '9 Nov 2026', { ...name, stage: 'overdue_7' });
    expect(three).toEqual({
      subject: 'Invoice Overdue',
      summary: 'Dhaka Visa Desk: invoice INV-1 was due on 9 Nov 2026 and is still unpaid.',
      timing: 'overdue',
    });
    expect(seven).toEqual({
      subject: 'Invoice Still Overdue',
      summary:
        'Dhaka Visa Desk: invoice INV-1 was due on 9 Nov 2026 and is still unpaid 7 days after its due date.',
      timing: 'overdue',
      heading: 'An invoice is still past its due date',
    });
    // With automatic handling on, the 7-day reminder says what happens next, calmly.
    const next = reminderWords(-7, 'INV-1', '9 Nov 2026', {
      ...name,
      stage: 'overdue_7',
      suspendsOn: '23 Nov 2026',
    });
    expect(next.summary).toBe(
      'Dhaka Visa Desk: invoice INV-1 was due on 9 Nov 2026 and is still unpaid 7 days after its due date. If it is still unpaid on 23 Nov 2026, adding cases, team members and files will pause until it is paid. Nothing is deleted or hidden.',
    );
    for (const words of [three, seven, next]) expect(words.summary).not.toMatch(/BDT|\d,\d{3}/);
  });

  it('names the day the run would use: the oldest counted overdue invoice, not the one reminded about (S30)', () => {
    const policy = { graceAfterDays: 7, suspendAfterDays: 14 };
    const now = new Date('2026-10-28T06:00:00Z');
    const a = { invoiceId: 'a', invoiceRef: 'INV-A', dueDate: new Date('2026-10-16T00:00:00Z') };
    const b = { invoiceId: 'b', invoiceRef: 'INV-B', dueDate: new Date('2026-10-21T00:00:00Z') };
    const standing: BillingStanding = {
      status: 'GRACE',
      cause: 'NONPAYMENT',
      changedAt: new Date('2026-10-23T00:00:00Z'),
      overdue: [a, b],
    };
    // A is 12 days overdue and B 7: the run suspends on A's day 14, 30 Oct, not B's (4 Nov).
    expect(automaticSuspensionDay(standing, policy, b, now)).toEqual(
      new Date('2026-10-30T00:00:00Z'),
    );
    expect(automaticSuspensionDay(standing, policy, b, now)).toEqual(
      automaticSuspensionDay(standing, policy, a, now),
    );
    // A person's change after A fell overdue covers A: only B counts then.
    const extended: BillingStanding = {
      ...standing,
      status: 'ACTIVE',
      cause: 'MANUAL',
      changedAt: new Date('2026-10-19T00:00:00Z'),
    };
    expect(automaticSuspensionDay(extended, policy, b, now)).toEqual(
      new Date('2026-11-04T00:00:00Z'),
    );
  });

  it('uses the real day count in the 7-day reminder (S30)', () => {
    const ten = reminderWords(-10, 'INV-1', '9 Nov 2026', { stage: 'overdue_7' });
    expect(ten.summary).toBe(
      'Invoice INV-1 was due on 9 Nov 2026 and is still unpaid 10 days after its due date.',
    );
  });

  it('warns about a pause only when the run itself would make it (S30)', () => {
    const policy = { graceAfterDays: 7, suspendAfterDays: 14 };
    const due = new Date('2026-10-20T00:00:00Z');
    const now = new Date('2026-10-28T06:00:00Z');
    const standing = (overrides: Partial<BillingStanding>): BillingStanding => ({
      status: 'GRACE',
      cause: 'NONPAYMENT',
      changedAt: new Date('2026-10-27T00:00:00Z'),
      overdue: [],
      ...overrides,
    });
    // Moved to Grace by VisaStack: Suspended follows on day 14.
    expect(automaticSuspensionDay(standing({}), policy, { dueDate: due }, now)).toEqual(
      new Date('2026-11-03T00:00:00Z'),
    );
    // Active, never changed by a person: counted too.
    expect(
      automaticSuspensionDay(
        standing({ status: 'ACTIVE', changedAt: null }),
        policy,
        { dueDate: due },
        now,
      ),
    ).not.toBeNull();
    // A person extended the agency after this invoice was already overdue: no automatic move.
    expect(
      automaticSuspensionDay(
        standing({
          status: 'ACTIVE',
          cause: 'MANUAL',
          changedAt: new Date('2026-10-25T00:00:00Z'),
        }),
        policy,
        { dueDate: due },
        now,
      ),
    ).toBeNull();
    // Already Suspended, or put in Grace by a person: nothing more will happen automatically.
    expect(
      automaticSuspensionDay(standing({ status: 'SUSPENDED' }), policy, { dueDate: due }, now),
    ).toBeNull();
    expect(
      automaticSuspensionDay(standing({ cause: 'MANUAL' }), policy, { dueDate: due }, now),
    ).toBeNull();
    // Rules off, no billing account, or the day already passed.
    expect(automaticSuspensionDay(standing({}), null, { dueDate: due }, now)).toBeNull();
    expect(automaticSuspensionDay(null, policy, { dueDate: due }, now)).toBeNull();
    expect(
      automaticSuspensionDay(
        standing({}),
        policy,
        { dueDate: due },
        new Date('2026-11-04T06:00:00Z'),
      ),
    ).toBeNull();
  });

  it('counts a reminder only when it was written, and names an agency nobody can be told about once', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await db
      .update(schema.memberships)
      .set({ active: false })
      .where(eq(schema.memberships.organizationId, w.organizationId));
    await adminInvoice(w, 'INV-NOBODY', new Date(Date.now() + 2 * DAY));
    await adminInvoice(w, 'INV-NOBODY-2', new Date(Date.now() + 2 * DAY + 2 * DAY));
    const run = await runBillingCycle(db, scope());
    expect(run).toMatchObject({ remindersQueued: 0, withoutContacts: 1 });
    const lines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('no_billing_contact'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(w.organizationId);
  });

  it('logs each failure once with its step and the organization, and no amount', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await subscribe(w, new Date(Date.now() - DAY));
    await db.execute(sql`drop table notifications cascade`);
    const run = await runBillingCycle(db, scope());
    expect(run).toMatchObject({ invoicesCreated: 0, failed: 1 });
    const lines = logged.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"step":"invoice"');
    expect(lines[0]).toContain(w.organizationId);
    expect(lines[0]).not.toMatch(/500000|5000\b/);
    expect(await invoicesOf(w)).toHaveLength(0);
  });

  it(
    'hides an in-app billing notice from someone who is no longer an owner or admin',
    async () => {
      await subscribe(w, new Date(Date.now() - DAY));
      await runBillingCycle(db, scope());
      const email: EmailPort = { send: async () => ({ providerMessageId: randomUUID() }) };
      await runNotificationWorker(db, email, 'https://app.example.test');
      const issued = async (accountId: string) =>
        (await listNotificationsForAccount(db, accountId)).filter(
          (n) => n.eventType === 'INVOICE_ISSUED',
        );
      expect(await issued(w.orgAdminId)).toHaveLength(1);
      const unreadBefore = (await loadWorkspaceToolbarState(db, w.orgAdminId)).unread;
      await db
        .update(schema.memberships)
        .set({ role: 'CASE_MANAGER' })
        .where(eq(schema.memberships.accountId, w.orgAdminId));
      expect(await issued(w.orgAdminId)).toHaveLength(0);
      expect((await loadWorkspaceToolbarState(db, w.orgAdminId)).unread).toBe(unreadBefore - 1);
      expect(await issued(w.orgOwnerId)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it('keeps the preview and the rules for the platform owner: a forged scope gets nothing', async () => {
    const real = await ownerScopeOf(w);
    const forged = { ...real } as typeof real;
    expect(isErr(await previewOverdueHandling(db, forged, POLICY))).toBe(true);
    expect(isErr(await getBillingSettings(db, forged))).toBe(true);
    expect(isOk(await previewOverdueHandling(db, real, POLICY))).toBe(true);
  });

  it('takes locks in one order: invoice, then billing account, then the audit chain', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const body = (file: string, start: string, end: string) => {
      const text = readFileSync(join(here, file), 'utf8');
      const from = text.indexOf(start);
      const to = text.indexOf(end, from + start.length);
      expect(from, `${file}: ${start}`).toBeGreaterThan(-1);
      return text.slice(from, to === -1 ? undefined : to);
    };
    // The payment path: the account lock comes before the first write that appends audit.
    const collection = body(
      'invoice-ledger.ts',
      'export async function applyInvoiceCollection',
      'async function findExisting',
    );
    const replayEnd = collection.indexOf("if (invoice.status === 'VOID')");
    const lockAt = collection.indexOf('lockRestorableAccount(tx');
    expect(lockAt).toBeGreaterThan(replayEnd);
    for (const write of [
      'appendAuditEvent(',
      'issueReceiptForPayment(tx, { payment,',
      'recordProductEvent(',
    ]) {
      expect(collection.indexOf(write, replayEnd), write).toBeGreaterThan(lockAt);
    }
    expect(collection.indexOf(".for('update')")).toBeLessThan(lockAt);
    // A change by hand: the account row is locked before its audit record.
    const manual = body(
      'billing.ts',
      'export async function transitionBillingStatus',
      'export async function',
    );
    expect(manual.indexOf(".for('update')")).toBeGreaterThan(-1);
    expect(manual.indexOf(".for('update')")).toBeLessThan(manual.indexOf('appendAuditEvent('));
    // The run: the account is locked before the change (which appends audit) is written.
    const run = body('billing-cycle.ts', 'const statusStep = async', '// 1. Returns to Active');
    expect(run.indexOf('lockBillingAccount(tx')).toBeGreaterThan(-1);
    expect(run.indexOf('lockBillingAccount(tx')).toBeLessThan(
      run.indexOf('applyOverdueStatusChange('),
    );
    // A payment decides from the status it read under the lock, never from an unlocked read.
    const restorable = body(
      'invoice-ledger.ts',
      'async function lockRestorableAccount',
      'async function restoreBillingAfterPayment',
    );
    expect(restorable.indexOf('lockBillingAccount(tx')).toBeGreaterThan(-1);
    expect(restorable.indexOf('lockBillingAccount(tx')).toBeLessThan(
      restorable.indexOf('locked.status'),
    );
    // Nothing is read before that lock: the lock is the function's first database call.
    const beforeLock = restorable.slice(0, restorable.indexOf('lockBillingAccount(tx'));
    expect(beforeLock.slice(beforeLock.indexOf('{') + 1).trim()).toBe('const locked = await');
    expect(readFileSync(join(here, 'invoice-ledger.ts'), 'utf8')).not.toContain(
      'billingAccountStatus',
    );
    // Invoice creation, by hand and by the run, is serialised per agency: the account is locked
    // before the overlap check and the insert, inside the same transaction.
    const byHand = body('billing.ts', 'async function insertInvoice', 'export interface');
    const byRun = body(
      'billing-cycle.ts',
      'async function createCycleInvoice',
      'interface ReminderWords',
    );
    for (const [name, text] of [
      ['createInvoice', byHand],
      ['createCycleInvoice', byRun],
    ] as const) {
      const lock = text.indexOf('lockBillingAccount(tx');
      expect(lock, name).toBeGreaterThan(text.indexOf('db.transaction('));
      expect(lock, name).toBeLessThan(text.indexOf('invoicePeriodOverlaps('));
      expect(lock, name).toBeLessThan(text.indexOf('.insert('));
      expect(lock, name).toBeLessThan(text.indexOf('appendAuditEvent('));
    }
    // Nothing else locks a billing account.
    const lockers = readdirSync(here)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test'))
      .filter((f) => readFileSync(join(here, f), 'utf8').includes('lockBillingAccount('))
      .sort();
    expect(lockers).toEqual([
      'billing-cycle.ts',
      'billing-standing.ts',
      'billing.ts',
      'invoice-ledger.ts',
    ]);
  });

  it(
    'leaves agencies nobody can be told about out of the reminders, so they never use up the work limit',
    async () => {
      const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // Two agencies without an active owner or admin, with invoices due first...
      for (const tag of ['silent-a', 'silent-b']) {
        const silent = await world(db, tag, w);
        await adminInvoice(silent, `INV-${tag}`, new Date(Date.now() + DAY));
        await db
          .update(schema.memberships)
          .set({ active: false })
          .where(eq(schema.memberships.organizationId, silent.organizationId));
      }
      // ...and one that can be told, due later.
      const reachable = await adminInvoice(w, 'INV-REACHABLE', new Date(Date.now() + 2 * DAY));
      const run = await runBillingCycle(db, scope(), { limit: 1 });
      expect(run).toMatchObject({ remindersQueued: 1, withoutContacts: 2 });
      const sent = (await notices(db, 'INVOICE_REMINDER')).map((n) => n.resourceId);
      expect(new Set(sent)).toEqual(new Set([reachable.id]));
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes('no_billing_contact')),
      ).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'still makes the invoice for a period that began today for an agency it suspends in the same run',
    async () => {
      // Long overdue, so this run suspends the agency; its new period begins today.
      await adminInvoice(w, 'INV-LONG-OVERDUE', new Date(Date.now() - 40 * DAY));
      await setRules(db, { ...POLICY, overdueHandlingEnabled: true });
      const started = new Date(Date.now() - 60 * 60 * 1000);
      await subscribe(w, started);
      const run = await runBillingCycle(db, scope());
      expect(run).toMatchObject({ invoicesCreated: 1, movedToSuspended: 1 });
      expect(await status(w)).toBe('SUSPENDED');
      const fresh = (await invoicesOf(w)).find(
        (i) => i.periodStart.getTime() === started.getTime(),
      );
      expect(fresh?.status).toBe('OPEN');
    },
    TEST_TIMEOUT_MS,
  );
});
