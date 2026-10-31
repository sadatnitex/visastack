import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { personRefundGuardPresent } from './refunds';

/**
 * ADR 0025 T6: the platform readiness detail says "Refunds not ready yet", and a traveller's
 * refund is refused, until migration 0112 has run in full: the refund guard keeps a refund's payer
 * fixed (its body names the payer column) and the insert check that a refund names its invoice's
 * payer exists. A run that stopped between the two statements is not ready.
 */
describe('personRefundGuardPresent', () => {
  it('is true after 0112, and false for the guard as 0104 left it or without the insert check', async () => {
    const client = await createMigratedPglite();
    try {
      const db = drizzle(client, { schema }) as unknown as Db;
      expect(await personRefundGuardPresent(db)).toBe(true);
      const body = await client.query<{ prosrc: string }>(
        "select prosrc from pg_proc where proname = 'visastack_refund_requests_guard'",
      );
      const source = body.rows[0]?.prosrc ?? '';
      expect(source).toContain('payer_account_id');

      // 0112 stopped after replacing the guard, before adding the insert check.
      await client.exec('drop trigger refund_requests_payer_matches on refund_requests');
      expect(await personRefundGuardPresent(db)).toBe(false);

      // The guard as 0104 left it (no payer), with the insert check back: still not ready.
      const older = source.replace(
        /\s*OR NEW\."payer_account_id" IS DISTINCT FROM OLD\."payer_account_id"/,
        '',
      );
      expect(older).not.toContain('payer_account_id');
      await client.exec(
        `create or replace function visastack_refund_requests_guard() returns trigger language plpgsql as $guard$${older}$guard$`,
      );
      await client.exec(
        'create trigger refund_requests_payer_matches before insert on refund_requests for each row execute function visastack_refund_requests_payer_matches()',
      );
      expect(await personRefundGuardPresent(db)).toBe(false);
    } finally {
      await client.close();
    }
  }, 60_000);
});
