import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { migrationsFolder } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import { createInvoice, recordInvoicePayment } from './billing';
import type { Db } from './db';
import { checkSeatEntitlement } from './entitlement-enforcement';
import { type ResolvedEntitlements, resolveEntitlements } from './entitlements';
import { createOrganization } from './organizations';
import { startOnlinePayment } from './payments';
import { FakePaymentPort } from './payments.test-support';
import { getUsageForOrganization, listPlans } from './plans';
import { listPlansForAdmin, savePlan } from './plans-admin';
import { entitlementsSchemaPresent } from './plans-schema';
import { grantPlatformRole } from './platform-roles';

/**
 * S29: the release runs before migration 0107 for a few minutes. This proves the new code works
 * on a database as production has it before 0107 (plans read, limits checked, new agencies made,
 * payments recorded), that plans simply cannot be changed yet, and that 0107 copies every plan's
 * rules so the resolver gives exactly the same limits after it as before it.
 */

const FILE = '0107_plans_entitlements';
const TIMEOUT = 240_000;
const DAY = 24 * 60 * 60 * 1000;

function folderBefore0107(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-s29-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

function randomLimit(): number | null {
  return Math.random() < 0.3 ? null : Math.floor(Math.random() * 400);
}

describe('before and after migration 0107 (S29)', () => {
  it(
    'works before 0107 and gives the same limits after it',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folderBefore0107() });
      const db = drizzle(client, { schema }) as unknown as Db;
      expect(await entitlementsSchemaPresent(db)).toBe(false);

      const ownerEmail = 'owner-pre@platform.example.com';
      const owner = await provisionAccount(db, { email: ownerEmail });
      if (!isOk(owner)) throw new Error('owner');
      const granted = await grantPlatformRole(db, {
        actor: { accountId: owner.value.id, email: ownerEmail, bootstrapEmails: [ownerEmail] },
        targetAccountId: owner.value.id,
        role: 'PLATFORM_OWNER',
        reason: 'seed',
        stepUpSatisfied: true,
      });
      if (!isOk(granted)) throw new Error('grant');
      const actor = { accountId: owner.value.id, email: ownerEmail, bootstrapEmails: [] };

      // A new agency is still made, on Founding Access (written with the old columns).
      const agencyOwner = await provisionAccount(db, { email: 'agency-pre@acme.example.com' });
      if (!isOk(agencyOwner)) throw new Error('agency owner');
      const founding = await createOrganization(db, {
        actorAccountId: agencyOwner.value.id,
        name: 'Acme Before',
      });
      if (!isOk(founding)) throw new Error('org');
      const foundingResolved = await resolveEntitlements(db, {
        organizationId: founding.value.id,
      });
      expect(foundingResolved.source).toBe('columns');
      expect(foundingResolved.gate).toBe('bypass');
      expect(isOk(await db.transaction((tx) => checkSeatEntitlement(tx, founding.value.id)))).toBe(
        true,
      );

      // Agencies on plans with random limits, put there as production did (SQL).
      const orgs: string[] = [];
      for (let n = 0; n < 5; n++) {
        const values = [randomLimit(), randomLimit(), randomLimit(), randomLimit(), randomLimit()];
        const sql = (v: number | null) => (v === null ? 'null' : String(v));
        const plan = await client.query<{ id: string }>(
          `insert into plans (key, name, seats_allowed, cases_per_period_allowed, concurrent_open_cases_allowed, storage_bytes_allowed, ai_allowance_units_allowed)
           values ('agency_pre_${n}', 'Pre ${n}', ${values.map(sql).join(', ')}) returning id`,
        );
        const org = await client.query<{ id: string }>(
          `insert into organizations (name, status) values ('Agency ${n}', 'ACTIVE') returning id`,
        );
        const orgId = org.rows[0]?.id ?? '';
        await client.query(
          `insert into subscriptions (organization_id, plan_id, assigned_by_account_id, reason) values ('${orgId}', '${plan.rows[0]?.id}', '${owner.value.id}', 'seed')`,
        );
        orgs.push(orgId);
      }
      const before = new Map<string, ResolvedEntitlements>();
      for (const orgId of orgs)
        before.set(orgId, await resolveEntitlements(db, { organizationId: orgId }));

      // Pages read plans and usage.
      expect((await listPlans(db)).length).toBeGreaterThan(3);
      const usage = await getUsageForOrganization(db, {
        actorAccountId: owner.value.id,
        actorEmail: ownerEmail,
        organizationId: orgs[0] ?? '',
      });
      expect(isOk(usage)).toBe(true);

      // A payment recorded by staff is counted (its ledger row is written without a mode).
      const starter = (await listPlans(db)).find((p) => p.key === 'agency_starter');
      const invoice = await createInvoice(db, {
        actor,
        stepUpSatisfied: true,
        organizationId: founding.value.id,
        planId: starter?.id ?? '',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * DAY),
        invoiceRef: 'INV-PRE-1',
        invoicedAmountMinorUnits: 5000,
        currency: 'BDT',
        dueDate: new Date(Date.now() + 7 * DAY),
      });
      if (!isOk(invoice)) throw new Error('invoice');
      const paid = await recordInvoicePayment(db, {
        actor,
        stepUpSatisfied: true,
        invoiceId: invoice.value.id,
        amountMinorUnits: 2000,
        collectedDate: new Date(),
        paymentReference: 'CASH-PRE',
        reason: 'cash',
      });
      expect(isOk(paid)).toBe(true);

      // Online payment and plan changes wait for 0107, refused calmly with a typed reason.
      const port = new FakePaymentPort();
      const started = await startOnlinePayment(db, port, {
        actorAccountId: agencyOwner.value.id,
        invoiceId: invoice.value.id,
        urlFor: () => 'https://app.example.test/pay',
      });
      expect(isErr(started)).toBe(true);
      expect(port.checkouts).toHaveLength(0);
      const scope = await staffPrincipal(db, actor, 'PLANS_MANAGE');
      if (!isOk(scope)) throw new Error('scope');
      const listed = await listPlansForAdmin(db, scope.value);
      expect(isOk(listed) && listed.value.available).toBe(false);
      const saved = await savePlan(db, scope.value, {
        draft: { name: 'Too Early', periodDays: 30, price: null, rules: {} },
        stepUpSatisfied: true,
      });
      expect(isErr(saved) && saved.error.reason).toBe('plans_unavailable');

      // 0107 runs, statement by statement.
      for (const statement of readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
        '--> statement-breakpoint',
      )) {
        await client.exec(statement);
      }
      const after = drizzle(client, { schema }) as unknown as Db;
      expect(await entitlementsSchemaPresent(after)).toBe(true);
      for (const orgId of orgs) {
        const resolved = await resolveEntitlements(after, { organizationId: orgId });
        expect(resolved.source).toBe('entitlements');
        expect(resolved.limits).toEqual(before.get(orgId)?.limits);
        expect(resolved.gate).toBe(before.get(orgId)?.gate);
      }
      expect((await resolveEntitlements(after, { organizationId: founding.value.id })).gate).toBe(
        'bypass',
      );
      const [row] = await after
        .select({ mode: schema.invoicePayments.mode })
        .from(schema.invoicePayments)
        .where(eq(schema.invoicePayments.reference, 'CASH-PRE'));
      expect(row?.mode).toBe('LIVE');
      await client.close();
    },
    TIMEOUT,
  );
});
