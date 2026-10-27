import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A copy of the shipped migrations with the journal cut after `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'vs-migrations-'));
  folders.push(folder);
  cpSync(migrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (cut < 0) throw new Error(`no migration ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe('migration 0097: agency invoices, claims and receipts (ADR 0020, S12)', () => {
  it(
    'numbers existing collections per agency without gaps, is safe to run again, and holds the rules',
    async () => {
      const client = new PGlite();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: migrationsUpTo('0096_payment_attempts') });

      const one = async (query: string) =>
        ((await client.query<{ id: string }>(query)).rows[0] as { id: string }).id;
      const plan = await one(`select id from plans where key = 'agency_starter'`);
      const orgA = await one(`insert into organizations (name) values ('Agency A') returning id`);
      const orgB = await one(`insert into organizations (name) values ('Agency B') returning id`);
      const invoice = (org: string, ref: string, amount = 100000) =>
        one(
          `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref,
            invoiced_amount_minor_units, currency, due_date)
           values ('${org}', '${plan}', now(), now() + interval '30 days', '${ref}', ${amount}, 'BDT', now())
           returning id`,
        );
      const invoiceA1 = await invoice(orgA, 'INV-S12-A1');
      const invoiceA2 = await invoice(orgA, 'INV-S12-A2');
      const invoiceB1 = await invoice(orgB, 'INV-S12-B1');
      const ledger = (invoiceId: string, amount: number, provider?: string) =>
        one(
          `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, provider, provider_transaction_id)
           values ('${invoiceId}', ${amount}, 'BDT', 'ADMIN_RECORDED', 'wire', now(), ${
             provider ? `'${provider}', '${invoiceId}:${amount}'` : 'null, null'
           }) returning id`,
        );
      const paymentA1 = await ledger(invoiceA1, 1000);
      await ledger(invoiceA1, 2000, 'opening_balance');
      const paymentA2 = await ledger(invoiceA2, 3000);
      const paymentB1 = await ledger(invoiceB1, 4000);

      await migrate(db, { migrationsFolder });

      const receipts = async () =>
        (
          await client.query<{
            organization_id: string;
            invoice_payment_id: string;
            receipt_number: number;
            amount_minor_units: number;
            currency: string;
          }>(
            'select organization_id, invoice_payment_id, receipt_number, amount_minor_units, currency from payment_receipts order by organization_id, receipt_number',
          )
        ).rows;
      const opened = await receipts();
      // The opening-balance row is not a recording and gets no receipt.
      expect(opened).toHaveLength(3);
      const forOrg = (org: string) =>
        opened.filter((r) => r.organization_id === org).map((r) => r.receipt_number);
      expect(forOrg(orgA)).toEqual([1, 2]);
      expect(forOrg(orgB)).toEqual([1]);
      expect(opened.find((r) => r.invoice_payment_id === paymentA1)?.receipt_number).toBe(1);
      expect(opened.find((r) => r.invoice_payment_id === paymentA2)?.receipt_number).toBe(2);
      expect(opened.find((r) => r.invoice_payment_id === paymentB1)).toMatchObject({
        amount_minor_units: 4000,
        currency: 'BDT',
      });
      const counter = async (org: string) =>
        (
          await client.query<{ last_number: number }>(
            `select last_number from payment_receipt_counters where organization_id = '${org}'`,
          )
        ).rows[0]?.last_number;
      expect(await counter(orgA)).toBe(2);
      expect(await counter(orgB)).toBe(1);

      // Re-running every statement changes nothing (production applies them one at a time).
      const sql = readFileSync(join(migrationsFolder, '0097_agency_invoices_receipts.sql'), 'utf8');
      const rerun = async () => {
        for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);
      };
      await rerun();
      expect(await receipts()).toHaveLength(3);

      // A collection recorded between the deploy and the migration is numbered next, once.
      const late = await ledger(invoiceA2, 500);
      await rerun();
      await rerun();
      const after = await receipts();
      expect(after).toHaveLength(4);
      expect(after.find((r) => r.invoice_payment_id === late)?.receipt_number).toBe(3);
      expect(await counter(orgA)).toBe(3);

      // Receipts are append-only and tied to one ledger row each.
      await expect(
        client.query('update payment_receipts set currency = $1', ['USD']),
      ).rejects.toThrow(/append-only/);
      await expect(client.query('delete from payment_receipts')).rejects.toThrow(/append-only/);
      await expect(client.query('truncate payment_receipts')).rejects.toThrow(/append-only/);
      await expect(
        client.query(
          `insert into payment_receipts (organization_id, invoice_id, invoice_payment_id, receipt_number, amount_minor_units, currency)
           values ('${orgA}', '${invoiceA1}', '${paymentA1}', 9, 1000, 'BDT')`,
        ),
      ).rejects.toThrow();
      // A number is never reused inside one agency.
      const extra = await ledger(invoiceA1, 10);
      await expect(
        client.query(
          `insert into payment_receipts (organization_id, invoice_id, invoice_payment_id, receipt_number, amount_minor_units, currency)
           values ('${orgA}', '${invoiceA1}', '${extra}', 1, 10, 'BDT')`,
        ),
      ).rejects.toThrow();

      // Claims: positive amount, a reference, one waiting claim per invoice.
      const account = await one(
        `insert into accounts (email) values ('s12-migration@example.test') returning id`,
      );
      const claim = (invoiceId: string, extraColumn = '', amount = 1000, reference = 'TRX-1') =>
        client.query<{ id: string }>(
          `insert into manual_payment_claims (invoice_id, organization_id, submitted_by_account_id, method, reference, amount_minor_units, currency, paid_on${
            extraColumn ? `, ${extraColumn.split('=')[0]}` : ''
          })
           values ('${invoiceId}', '${orgA}', '${account}', 'BANK_TRANSFER', '${reference}', ${amount}, 'BDT', now()${
             extraColumn ? `, ${extraColumn.split('=')[1]}` : ''
           }) returning id`,
        );
      await expect(claim(invoiceA1, '', 0)).rejects.toThrow();
      await expect(claim(invoiceA1, '', 1000, '   ')).rejects.toThrow();
      await expect(claim(invoiceA1, `note='${'x'.repeat(501)}'`)).rejects.toThrow();
      const waiting = (await claim(invoiceA1)).rows[0]?.id;
      await expect(claim(invoiceA1)).rejects.toThrow();
      // A decided state needs a decision time and a decider; a rejection needs a reason.
      await expect(
        client.query(
          `update manual_payment_claims set status = 'APPROVED' where id = '${waiting}'`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `update manual_payment_claims set status = 'REJECTED', decided_at = now(), decided_by_account_id = '${account}' where id = '${waiting}'`,
        ),
      ).rejects.toThrow();
      // While waiting, the reported money cannot be edited.
      await expect(
        client.query(
          `update manual_payment_claims set amount_minor_units = 1 where id = '${waiting}'`,
        ),
      ).rejects.toThrow(/cannot be edited/);
      await expect(
        client.query(
          `update manual_payment_claims set invoice_id = '${invoiceA2}' where id = '${waiting}'`,
        ),
      ).rejects.toThrow(/cannot be edited/);
      await client.query(
        `update manual_payment_claims set status = 'REJECTED', decided_at = now(), decided_by_account_id = '${account}', decision_reason = 'No such transfer' where id = '${waiting}'`,
      );
      // A decided claim is frozen, and no claim is ever deleted.
      await expect(
        client.query(
          `update manual_payment_claims set decision_reason = 'changed' where id = '${waiting}'`,
        ),
      ).rejects.toThrow(/decided claim cannot change/);
      await expect(client.query('delete from manual_payment_claims')).rejects.toThrow();
      // After a decision the invoice can take a new claim.
      const second = (await claim(invoiceA1)).rows[0]?.id as string;

      // The proof file: one per claim, scanned clean, a known type and size, never edited.
      const object = await one(
        `insert into storage_objects (bucket, object_key, size_bytes, content_hash) values ('CLEAN', 'billing-receipt-test-1', 10, 'h') returning id`,
      );
      const file = (
        claimId: string,
        storageObject: string,
        scan = 'CLEAN',
        type = 'application/pdf',
      ) =>
        client.query(
          `insert into billing_receipts (claim_id, organization_id, storage_object_id, content_type, size_bytes, content_sha256, scan_status)
           values ('${claimId}', '${orgA}', '${storageObject}', '${type}', 10, '${'a'.repeat(64)}', '${scan}')`,
        );
      await expect(file(second, object, 'PENDING')).rejects.toThrow();
      await expect(file(second, object, 'CLEAN', 'text/html')).rejects.toThrow();
      await file(second, object);
      const object2 = await one(
        `insert into storage_objects (bucket, object_key, size_bytes, content_hash) values ('CLEAN', 'billing-receipt-test-2', 10, 'h') returning id`,
      );
      await expect(file(second, object2)).rejects.toThrow();
      await expect(client.query('update billing_receipts set size_bytes = 11')).rejects.toThrow(
        /append-only/,
      );
      await expect(client.query('delete from billing_receipts')).rejects.toThrow(/append-only/);
      await expect(client.query('truncate billing_receipts')).rejects.toThrow(/append-only/);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
