import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * Migration 0112 (ADR 0025, T6): before any person refund can exist, a refund request keeps its
 * payer fixed for life (an agency's, or the person who paid for their own plan), as migration
 * 0104 keeps its money and source, and a new refund must name its invoice's payer.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0112_refund_payer_guard';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0112. */
function folderBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0112-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

async function one(client: PGlite, text: string): Promise<string> {
  const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
  if (!id) throw new Error(`no row from: ${text}`);
  return id;
}

/** An agency invoice and a person's own invoice, each paid, with a ledger entry to refund. */
async function seed(client: PGlite) {
  const org = await one(
    client,
    `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
  );
  const person = await one(
    client,
    `insert into accounts (email) values ('payer-${Math.random()}@example.test') returning id`,
  );
  const other = await one(
    client,
    `insert into accounts (email) values ('other-${Math.random()}@example.test') returning id`,
  );
  const agencyPlan = await one(client, `select id from plans where key = 'agency_starter'`);
  const travellerPlan = await one(
    client,
    `insert into plans (key, name, audience) values ('traveller_plus_0112', 'Traveller Plus', 'TRAVELLER') returning id`,
  );
  const invoice = (payer: string, ref: string) =>
    one(
      client,
      `insert into invoices (${payer === org ? 'organization_id' : 'payer_account_id'}, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, collected_amount_minor_units, currency, due_date, status)
       values ('${payer}', '${payer === org ? agencyPlan : travellerPlan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '${ref}', 5000, 5000, 'BDT', '2026-11-01T00:00:00Z', 'PAID') returning id`,
    );
  const agencyInvoice = await invoice(org, 'INV-0112-A');
  const personInvoice = await invoice(person, 'TP-0112-1');
  const entry = (invoiceId: string) =>
    one(
      client,
      `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id, mode)
       values ('${invoiceId}', 5000, 'BDT', 'ADMIN_RECORDED', 'PAY-${Math.random()}', now(), gen_random_uuid(), 'LIVE') returning id`,
    );
  return {
    org,
    person,
    other,
    agencyInvoice,
    personInvoice,
    agencyEntry: await entry(agencyInvoice),
    personEntry: await entry(personInvoice),
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

function refund(client: PGlite, fields: Record<string, string | null>) {
  const base: Record<string, string | null> = {
    method: 'PROVIDER',
    status: 'REQUESTED',
    amount_minor_units: '5000',
    currency: 'BDT',
    provider: 'sslcommerz',
    idempotency_key: crypto.randomUUID(),
    reason: 'Asked within 7 days',
    requested_by_account_id: crypto.randomUUID(),
    ...fields,
  };
  const names = Object.keys(base);
  const list = names
    .map((name) => (base[name] === null ? 'null' : `'${String(base[name])}'`))
    .join(', ');
  return client.query<{ id: string }>(
    `insert into refund_requests (${names.join(', ')}) values (${list}) returning id`,
  );
}

const forAgency = (s: Seeded) => ({
  organization_id: s.org,
  invoice_id: s.agencyInvoice,
  invoice_payment_id: s.agencyEntry,
});
const forPerson = (s: Seeded) => ({
  payer_account_id: s.person,
  invoice_id: s.personInvoice,
  invoice_payment_id: s.personEntry,
});

/** The columns an open refund may still change: its progress, never its money or its payer. */
const PROGRESS_COLUMNS = new Set([
  'id',
  'status',
  'provider_refund_id',
  'reference',
  'submitted_at',
  'confirmed_at',
  'failed_at',
  'cancelled_at',
  'failure_code',
  'last_provider_status',
  'last_checked_at',
  'attempts',
  'updated_at',
  // The gateway's refund time and when the request was closed: progress, like confirmed_at.
  'provider_refunded_at',
  'closed_at',
]);

describe('migration 0112: the refund guard keeps the payer (ADR 0025, T6)', () => {
  it(
    'runs twice, makes a new refund name its invoice’s payer, and keeps an open refund’s payer fixed',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        const s = await seed(client);
        // Before 0112 an open refund's payer could still be changed.
        const early = (await refund(client, forPerson(s))).rows[0]?.id;
        await client.query(
          `update refund_requests set payer_account_id = '${s.other}' where id = '${early}'`,
        );

        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }
        const triggers = await client.query<{ n: number }>(
          `select count(*)::int as n from pg_trigger where tgname = 'refund_requests_payer_matches'`,
        );
        expect(triggers.rows[0]?.n).toBe(1);

        // A new refund names exactly its invoice's payer: the agency, or the person.
        const agency = (await refund(client, forAgency(s))).rows[0]?.id;
        const person = (await refund(client, forPerson(s))).rows[0]?.id;
        expect(agency && person).toBeTruthy();
        await expect(
          refund(client, { ...forPerson(s), payer_account_id: s.other }),
        ).rejects.toThrow(/payer of its invoice/);
        await expect(
          refund(client, { ...forAgency(s), organization_id: null, payer_account_id: s.person }),
        ).rejects.toThrow(/payer of its invoice/);
        // One payer, never both and never none: the 0110 check still says so in its own words.
        await expect(refund(client, { ...forPerson(s), organization_id: s.org })).rejects.toThrow(
          /refund_requests_one_payer/,
        );
        await expect(refund(client, { ...forPerson(s), payer_account_id: null })).rejects.toThrow(
          /refund_requests_one_payer/,
        );

        // While it is open, its payer never moves, to another person or to an agency.
        await expect(
          client.query(
            `update refund_requests set payer_account_id = '${s.other}' where id = '${person}'`,
          ),
        ).rejects.toThrow(/cannot be edited/);
        await expect(
          client.query(
            `update refund_requests set payer_account_id = null, organization_id = '${s.org}' where id = '${person}'`,
          ),
        ).rejects.toThrow(/cannot be edited/);
        // The agency's is still fixed too, and progress still moves.
        await expect(
          client.query(
            `update refund_requests set organization_id = null, payer_account_id = '${s.person}' where id = '${agency}'`,
          ),
        ).rejects.toThrow(/cannot be edited/);
        await client.query(
          `update refund_requests set status = 'SUBMITTED', provider_refund_id = 'RR-0112-1' where id = '${person}'`,
        );
        await client.query(
          `update refund_requests set status = 'CONFIRMED', confirmed_at = now() where id = '${person}'`,
        );
        // A final refund still changes not at all, and none is ever deleted.
        await expect(
          client.query(`update refund_requests set reference = 'X' where id = '${person}'`),
        ).rejects.toThrow(/final refund/);
        await expect(
          client.query(`delete from refund_requests where id = '${agency}'`),
        ).rejects.toThrow();
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'leaves no refund column unclassified: each is kept fixed by the guard or is progress',
    async () => {
      const client = new PGlite();
      try {
        await migrate(drizzle(client), { migrationsFolder });
        const columns = await client.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_name = 'refund_requests' order by 1`,
        );
        const guard = await client.query<{ body: string }>(
          `select prosrc as body from pg_proc where proname = 'visastack_refund_requests_guard'`,
        );
        const body = guard.rows[0]?.body ?? '';
        const unclassified = columns.rows
          .map((row) => row.column_name)
          .filter((name) => !PROGRESS_COLUMNS.has(name) && !body.includes(`NEW."${name}"`));
        expect(
          unclassified,
          'add the column to the guard, or to PROGRESS_COLUMNS with a reason',
        ).toEqual([]);
        expect(body).toContain('NEW."payer_account_id" IS DISTINCT FROM OLD."payer_account_id"');
      } finally {
        await client.close();
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
