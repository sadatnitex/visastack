import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { personRefundGuardPresent } from './refunds';

/**
 * ADR 0025 T6: the platform readiness detail says "Refunds not ready yet" until migration 0112
 * has taught the refund guard about a person's own refunds. The probe reads only the guard
 * function's body: false while it never names the payer column, true once it does.
 */
describe('personRefundGuardPresent', () => {
  it('is false for the guard before 0112 and true once its body names the payer column', async () => {
    const client = await createMigratedPglite();
    try {
      const db = drizzle(client, { schema }) as unknown as Db;
      const body = await client.query<{ prosrc: string }>(
        "select prosrc from pg_proc where proname = 'visastack_refund_requests_guard'",
      );
      const source = body.rows[0]?.prosrc ?? '';
      expect(source.length).toBeGreaterThan(0);
      expect(source).not.toContain('payer_account_id');
      expect(await personRefundGuardPresent(db)).toBe(false);

      // Stand in for 0112: the same guard, its body now naming the payer column.
      await client.exec(
        `create or replace function visastack_refund_requests_guard() returns trigger language plpgsql as $guard$${source}
-- payer_account_id (stand-in for migration 0112)
$guard$`,
      );
      expect(await personRefundGuardPresent(db)).toBe(true);
    } finally {
      await client.close();
    }
  }, 60_000);
});
