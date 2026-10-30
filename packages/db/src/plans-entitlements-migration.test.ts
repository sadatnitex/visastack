import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0107_plans_entitlements';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0107: the database as production has it today. */
function folderBefore0107(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0107-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

type Limits = {
  seats: number | null;
  cases: number | null;
  open: number | null;
  storage: number | null;
  ai: number | null;
};

/** A number or "no limit", at random, so the copy is checked on many shapes, not one. */
function randomLimit(): number | null {
  return Math.random() < 0.3 ? null : Math.floor(Math.random() * 5000);
}

async function seed(client: PGlite) {
  const one = async (text: string): Promise<string> => {
    const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
    if (!id) throw new Error(`no row from: ${text}`);
    return id;
  };
  const sql = (value: number | null) => (value === null ? 'null' : String(value));
  const random: Record<string, Limits> = {};
  for (let n = 0; n < 6; n++) {
    const limits: Limits = {
      seats: randomLimit(),
      cases: randomLimit(),
      open: randomLimit(),
      storage: randomLimit() === null ? null : 1_073_741_824 * (n + 1),
      ai: randomLimit(),
    };
    const key = `agency_random_${n}`;
    random[key] = limits;
    await client.query(
      `insert into plans (key, name, seats_allowed, cases_per_period_allowed, concurrent_open_cases_allowed, storage_bytes_allowed, ai_allowance_units_allowed, price_minor_units, currency)
       values ('${key}', 'Random ${n}', ${sql(limits.seats)}, ${sql(limits.cases)}, ${sql(limits.open)}, ${sql(limits.storage)}, ${sql(limits.ai)}, ${n % 2 === 0 ? `${(n + 1) * 1000}, ' bdt '` : 'null, null'})`,
    );
  }
  await client.query(
    `insert into plans (key, name, price_minor_units, currency) values ('agency_founding_access', 'VisaStack Founding Access', 0, 'USD')`,
  );
  const org = await one(
    `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
  );
  const plan = await one(`select id from plans where key = 'agency_starter'`);
  const invoice = await one(
    `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, collected_amount_minor_units, currency, due_date, status)
     values ('${org}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-S29', 9000, 9000, 'BDT', '2026-11-08T00:00:00Z', 'PAID') returning id`,
  );
  const attempt = await one(
    `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id, amount_minor_units, currency, status, recorded_at)
     values ('${invoice}', '${org}', 'sslcommerz', 'VSP${'b'.repeat(26)}', 4000, 'BDT', 'RECORDED', now()) returning id`,
  );
  const online = await one(
    `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, source_id, provider, provider_transaction_id, reference, collected_date)
     values ('${invoice}', 4000, 'BDT', 'ONLINE', '${attempt}', 'sslcommerz', 'VAL1', 'BANK-1', now()) returning id`,
  );
  const recorded = await one(
    `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id)
     values ('${invoice}', 5000, 'BDT', 'ADMIN_RECORDED', 'CASH-1', now(), gen_random_uuid()) returning id`,
  );
  const refundOf = async (entry: string, key: string): Promise<string> => {
    const request = await one(
      `insert into refund_requests (organization_id, invoice_id, invoice_payment_id, method, status, amount_minor_units, currency, idempotency_key, reason, requested_by_account_id, confirmed_at, reference)
       values ('${org}', '${invoice}', '${entry}', 'MANUAL', 'CONFIRMED', 100, 'BDT', '${crypto.randomUUID()}', 'Agency overpaid', gen_random_uuid(), now(), '${key}') returning id`,
    );
    return one(
      `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, source_id, reference, collected_date, recorded_by_account_id)
       values ('${invoice}', -100, 'BDT', 'REFUND', '${request}', '${key}', now(), gen_random_uuid()) returning id`,
    );
  };
  const onlineRefund = await refundOf(online, 'REF-ONLINE');
  const recordedRefund = await refundOf(recorded, 'REF-CASH');
  // A refund of held money names the online payment, not a ledger row: it takes that payment's mode.
  const held = await one(
    `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id, amount_minor_units, currency, status, reason_code)
     values ('${invoice}', '${org}', 'sslcommerz', 'VSP${'d'.repeat(26)}', 300, 'BDT', 'HELD_FOR_REVIEW', 'already_paid') returning id`,
  );
  const heldRequest = await one(
    `insert into refund_requests (organization_id, invoice_id, payment_attempt_id, method, status, amount_minor_units, currency, idempotency_key, reason, requested_by_account_id, confirmed_at, reference)
     values ('${org}', '${invoice}', '${held}', 'MANUAL', 'CONFIRMED', 100, 'BDT', '${crypto.randomUUID()}', 'Held money back', gen_random_uuid(), now(), 'REF-HELD') returning id`,
  );
  const heldRefund = await one(
    `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, source_id, reference, collected_date, recorded_by_account_id)
     values ('${invoice}', -100, 'BDT', 'REFUND', '${heldRequest}', 'REF-HELD', now(), gen_random_uuid()) returning id`,
  );
  return {
    org,
    invoice,
    attempt,
    online,
    recorded,
    onlineRefund,
    recordedRefund,
    heldRefund,
    random,
  };
}

describe('migration 0107: plans admin, entitlements and test payments', () => {
  it(
    'runs twice on a database as production has it and copies every plan rule and mode',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folderBefore0107() });
      const seeded = await seed(client);
      const before = await client.query<{ present: boolean }>(
        `select to_regclass('plan_entitlements') is not null as present`,
      );
      expect(before.rows[0]?.present).toBe(false);
      // The runbook's pre-checks on this database: every currency is ISO once trimmed and in
      // capitals, and the founding plan is free.
      const badCurrency = await client.query(
        `select key from plans where currency is not null and upper(btrim(currency)) !~ '^[A-Z]{3}$'`,
      );
      expect(badCurrency.rows).toEqual([]);

      // Statement by statement, twice: the second run changes nothing and raises nothing.
      for (let run = 0; run < 2; run++) {
        for (const statement of statements()) await client.exec(statement);
      }

      const plans = await client.query<{
        key: string;
        audience: string;
        bypass_limits: boolean;
        currency: string | null;
      }>('select key, audience, bypass_limits, currency from plans order by key');
      for (const row of plans.rows) {
        expect(row.audience).toBe(row.key === 'traveller_free' ? 'TRAVELLER' : 'AGENCY');
        expect(row.bypass_limits).toBe(row.key === 'agency_founding_access');
        if (row.currency !== null) expect(row.currency).toMatch(/^[A-Z]{3}$/);
      }

      // Backfill equality: every plan's entitlement rows say exactly what its columns say.
      const rows = await client.query<{
        key: string;
        seats: string | null;
        invitations: string | null;
        cases: string | null;
        open: string | null;
        storage: string | null;
        ai: string | null;
        seats_allowed: number | null;
        cases_per_period_allowed: number | null;
        concurrent_open_cases_allowed: number | null;
        storage_bytes_allowed: string | null;
        ai_allowance_units_allowed: number | null;
        n: number;
      }>(`select p.key, p.seats_allowed, p.cases_per_period_allowed, p.concurrent_open_cases_allowed,
            p.storage_bytes_allowed::text, p.ai_allowance_units_allowed,
            max(e.limit_value) filter (where e.key = 'seats')::text as seats,
            max(e.limit_value) filter (where e.key = 'invitations')::text as invitations,
            max(e.limit_value) filter (where e.key = 'cases_per_period')::text as cases,
            max(e.limit_value) filter (where e.key = 'open_cases')::text as open,
            max(e.limit_value) filter (where e.key = 'storage_bytes')::text as storage,
            max(e.limit_value) filter (where e.key = 'ai_allowance_units')::text as ai,
            count(*) filter (where e.key not like 'ai.%')::int as n
          from plans p join plan_entitlements e on e.plan_id = p.id group by p.id order by p.key`);
      const text = (value: number | string | null) => (value === null ? null : String(value));
      expect(rows.rows.length).toBe(plans.rows.length);
      for (const row of rows.rows) {
        expect(row.n).toBe(6);
        expect(row.seats).toBe(text(row.seats_allowed));
        expect(row.invitations).toBe(text(row.seats_allowed));
        expect(row.cases).toBe(text(row.cases_per_period_allowed));
        expect(row.open).toBe(text(row.concurrent_open_cases_allowed));
        expect(row.storage).toBe(text(row.storage_bytes_allowed));
        expect(row.ai).toBe(text(row.ai_allowance_units_allowed));
      }
      for (const [key, limits] of Object.entries(seeded.random)) {
        const row = rows.rows.find((r) => r.key === key);
        expect(row?.seats).toBe(text(limits.seats));
        expect(row?.storage).toBe(text(limits.storage));
      }
      const ai = await client.query<{ key: string; limit_value: string; per: string }>(
        `select e.key, e.limit_value::text, e.per from plan_entitlements e join plans p on p.id = e.plan_id
         where p.key = 'traveller_free' and e.key like 'ai.%' order by e.key`,
      );
      expect(ai.rows).toEqual([
        { key: 'ai.ai_app_original_files', limit_value: '30', per: 'DAY' },
        { key: 'ai.ai_app_suggestions', limit_value: '15', per: 'DAY' },
      ]);

      // One price row per plan, today's price, from long before any billing period.
      const prices = await client.query<{ n: number; matching: number }>(
        `select count(*)::int as n,
           count(*) filter (where pp.price_minor_units is not distinct from p.price_minor_units
             and pp.currency is not distinct from p.currency
             and pp.effective_from = '2000-01-01T00:00:00Z')::int as matching
         from plan_prices pp join plans p on p.id = pp.plan_id`,
      );
      expect(prices.rows[0]?.n).toBe(plans.rows.length);
      expect(prices.rows[0]?.matching).toBe(plans.rows.length);

      // Every online payment so far was a test; the ledger copies modes from where money came from.
      const modes = await client.query<{ id: string; mode: string }>(
        'select id, mode::text from invoice_payments',
      );
      const modeOf = (id: string) => modes.rows.find((r) => r.id === id)?.mode;
      expect(modeOf(seeded.online)).toBe('TEST');
      expect(modeOf(seeded.recorded)).toBe('LIVE');
      expect(modeOf(seeded.onlineRefund)).toBe('TEST');
      expect(modeOf(seeded.recordedRefund)).toBe('LIVE');
      expect(modeOf(seeded.heldRefund)).toBe('TEST');
      const attemptMode = await client.query<{ mode: string }>(
        `select mode::text from payment_attempts where id = '${seeded.attempt}'`,
      );
      expect(attemptMode.rows[0]?.mode).toBe('TEST');

      // The strict guards are back: no ledger row or price can change or go, and the ledger guard
      // has no trace of the one-time mode fill.
      const guard = await client.query<{ src: string }>(
        `select prosrc as src from pg_proc where proname = 'visastack_invoice_payments_append_only'`,
      );
      expect(guard.rows).toHaveLength(1);
      expect(guard.rows[0]?.src).not.toContain('mode');
      await expect(
        client.query(`update invoice_payments set reference = 'X' where id = '${seeded.recorded}'`),
      ).rejects.toThrow(/append-only/);
      await expect(
        client.query(`update invoice_payments set mode = 'TEST' where id = '${seeded.recorded}'`),
      ).rejects.toThrow();
      await expect(
        client.query(`delete from invoice_payments where id = '${seeded.recorded}'`),
      ).rejects.toThrow(/append-only/);
      await expect(client.query('update plan_prices set price_minor_units = 1')).rejects.toThrow(
        /append-only/,
      );
      await expect(client.query('delete from plan_prices')).rejects.toThrow(/append-only/);

      // The new rules refuse bad rows.
      await expect(
        client.query(
          `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id, mode)
           values ('${seeded.invoice}', 1, 'BDT', 'ADMIN_RECORDED', 'X', now(), gen_random_uuid(), 'TEST')`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id, amount_minor_units, currency)
           values ('${seeded.invoice}', '${seeded.org}', 'sslcommerz', 'VSP${'c'.repeat(26)}', 1, 'BDT')`,
        ),
      ).rejects.toThrow();
      const starter = `(select id from plans where key = 'agency_starter')`;
      await expect(
        client.query(
          `insert into plan_entitlements (plan_id, key, limit_value, per) values (${starter}, 'ai.x', 1, 'PERIOD')`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `insert into plan_entitlements (plan_id, key, limit_value, per) values (${starter}, 'Seats', 1, 'CONCURRENT')`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `insert into plan_entitlements (plan_id, key, included, limit_value, per) values (${starter}, 'ai.extra', false, 3, 'DAY')`,
        ),
      ).rejects.toThrow();
      await client.query(
        `insert into plan_entitlements (plan_id, key, included, per) values (${starter}, 'ai.extra', false, 'DAY')`,
      );
      await expect(
        client.query(
          `update plans set price_minor_units = 100 where key = 'agency_founding_access'`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(`update plans set bypass_limits = true where key = 'traveller_free'`),
      ).rejects.toThrow();
      await expect(
        client.query(`update plans set currency = 'usd' where key = 'agency_founding_access'`),
      ).rejects.toThrow();
      await client.close();
    },
    MIGRATION_TIMEOUT_MS,
  );
});
