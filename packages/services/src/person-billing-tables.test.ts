import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import {
  personInvoiceStatus,
  personInvoices,
  personPaymentAttemptStatus,
  personPaymentAttempts,
  personPaymentMode,
  personPaymentReceipts,
  personReceiptCounters,
  personRefundMethod,
  personRefundRequests,
  personRefundStatus,
  personSubscriptions,
} from './person-billing-tables';
import { personBillingPresent } from './traveller-billing';

// Listed here, not exported from the module: an exported list would let code touch every person
// table without naming one, which the access ratchet could not see.
const PERSON_BILLING_TABLES = [
  personSubscriptions,
  personInvoices,
  personPaymentAttempts,
  personRefundRequests,
  personPaymentReceipts,
  personReceiptCounters,
];

/**
 * ADR 0025: the person billing declarations are a second view of the real billing tables, so they
 * must match the migrated database exactly: every column, its nullability, its type and whether it
 * has a default, and no column left out. A migration that changes one of these tables fails here
 * until the declaration follows it.
 */

describe('the person billing declarations match the database (ADR 0025)', () => {
  it('declares every column of each table with its nullability and type, and nothing else', async () => {
    const client = await createMigratedPglite();
    try {
      expect(PERSON_BILLING_TABLES).toHaveLength(6);
      for (const table of PERSON_BILLING_TABLES) {
        const config = getTableConfig(table);
        const rows = await client.query<{
          column_name: string;
          is_nullable: string;
          data_type: string;
          udt_name: string;
          has_default: boolean;
        }>(
          `select column_name, is_nullable, data_type, udt_name, column_default is not null as has_default from information_schema.columns where table_schema = 'public' and table_name = '${config.name}'`,
        );
        expect(rows.rows.length, `${config.name} exists`).toBeGreaterThan(0);
        const actual = Object.fromEntries(
          rows.rows.map((c) => [
            c.column_name,
            {
              nullable: c.is_nullable === 'YES',
              type: c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type,
              // A default the code leaves to the database must exist there, and the reverse.
              hasDefault: c.has_default,
            },
          ]),
        );
        const declared = Object.fromEntries(
          config.columns.map((c) => {
            const enumName = (c as { enum?: { enumName?: string } }).enum?.enumName;
            const type = enumName ?? c.getSQLType();
            return [c.name, { nullable: !c.notNull, type, hasDefault: c.hasDefault }];
          }),
        );
        expect(declared, `${config.name} columns`).toEqual(actual);
      }
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('person billing waits for both of its migrations (ADR 0025)', () => {
  it('is present on a migrated database, and not where 0111 has not run', async () => {
    const migrated = await createMigratedPglite();
    const before0111 = await createMigratedPglite();
    try {
      expect(await personBillingPresent(drizzle(migrated, { schema }) as unknown as Db)).toBe(true);
      // What 0111 changed, undone: an assigning account is required on every subscription again.
      await before0111.query(
        'alter table subscriptions alter column assigned_by_account_id set not null',
      );
      expect(await personBillingPresent(drizzle(before0111, { schema }) as unknown as Db)).toBe(
        false,
      );
    } finally {
      await migrated.close();
      await before0111.close();
    }
  }, 60_000);
});

describe('the person billing enums equal schema.ts (ADR 0025)', () => {
  it('has the same name and values for each enum type', () => {
    const pairs = [
      [personInvoiceStatus, schema.invoiceStatus],
      [personPaymentAttemptStatus, schema.paymentAttemptStatus],
      [personPaymentMode, schema.paymentMode],
      [personRefundMethod, schema.refundMethod],
      [personRefundStatus, schema.refundStatus],
    ] as const;
    for (const [mine, theirs] of pairs) {
      expect(mine.enumName).toBe(theirs.enumName);
      expect([...mine.enumValues]).toEqual([...theirs.enumValues]);
    }
  });
});
