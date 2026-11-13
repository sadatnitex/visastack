import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { shareWithEmail } from './sharing';

/**
 * Sharing by email with invitations switched off (owner decision, 13 Nov 2026): the answer is the
 * same whether or not the email has an account, so a sharer cannot use the form to find out who
 * uses VisaStack. What happens behind it is unchanged (an account gets a pending grant; no account,
 * nothing is made), and the audit trail still tells the two apart, without the address.
 */

const NO_ACCOUNT = 'nobody-here@example.com';
const HAS_ACCOUNT = 'registered@example.com';

let db: Db;
let ownerId: string;
let applicantId: string;
let registeredId: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error(`provision ${email}`);
  return made.value.id;
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  ownerId = await account('owner@example.com');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  applicantId = applicant.value.id;
  registeredId = await account(HAS_ACCOUNT);
});

const share = (email: string, extra: Partial<Parameters<typeof shareWithEmail>[1]> = {}) =>
  shareWithEmail(db, {
    actorAccountId: ownerId,
    applicantId,
    email,
    actions: ['VIEW_METADATA'],
    purpose: 'Visa review',
    ...extra,
  });

const audit = async (eventType: string) =>
  (await db.select().from(schema.auditEvents)).filter((row) => row.eventType === eventType);

describe('sharing by email answers the same whether or not the email has an account', () => {
  it('gives the identical answer, in plain words, for both', async () => {
    const withAccount = await share(HAS_ACCOUNT);
    const withoutAccount = await share(NO_ACCOUNT);
    expect(withoutAccount).toStrictEqual(withAccount);
    expect(withAccount).toStrictEqual({
      ok: true,
      value: {
        message:
          'If this email has a VisaStack account, they can accept your share now; if not, ask them to create one, then share again.',
        messageKey: 'sharing.sharedIfAccount',
      },
    });
  });

  it('still makes the grant for an account, and nothing for an email without one', async () => {
    await share(HAS_ACCOUNT);
    await share(NO_ACCOUNT);
    const grants = await db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.applicantId, applicantId));
    expect(grants.map((g) => [g.recipientAccountId, g.status])).toEqual([
      [registeredId, 'PENDING_ACCEPTANCE'],
    ]);
  });

  it('keeps the two apart in the audit trail only, never with the address', async () => {
    await share(HAS_ACCOUNT);
    await share(NO_ACCOUNT);
    expect(await audit('GRANT_CREATED')).toHaveLength(1);
    const missing = await audit('GRANT_RECIPIENT_NOT_REGISTERED');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      actorAccountId: ownerId,
      // Names no traveller and records no allow or deny: it stays out of the traveller's Access
      // Log, Recent Activity and the denied-access signal.
      applicantId: null,
      result: null,
      reason: 'recipient_has_no_account',
      metadata: { actions: 1 },
    });
    // No email and no hash of it: nothing in the row but ids, words and a count.
    const row = JSON.stringify(missing[0]);
    expect(row).not.toContain(NO_ACCOUNT);
    expect(row).not.toContain('nobody-here');
    expect(Object.keys((missing[0]?.metadata ?? {}) as object)).toEqual(['actions']);
  });

  it('refuses identically for both when a check fails', async () => {
    const strangerId = await account('stranger@example.com');
    const cases: ReadonlyArray<Partial<Parameters<typeof shareWithEmail>[1]>> = [
      // Someone who does not own the traveller.
      { actorAccountId: strangerId },
      // No purpose, no permission, a past end date, a permission that needs a fresh sign-in.
      { purpose: '   ' },
      { actions: [] },
      { expiryAt: new Date(Date.now() - 1000) },
      { actions: ['DOWNLOAD_ORIGINAL'] },
    ];
    for (const extra of cases) {
      const withAccount = await share(HAS_ACCOUNT, extra);
      const withoutAccount = await share(NO_ACCOUNT, extra);
      expect(withAccount.ok, JSON.stringify(extra)).toBe(false);
      expect(withoutAccount, JSON.stringify(extra)).toStrictEqual(withAccount);
    }
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'SHARING',
      granted: false,
    });
    const withAccount = await share(HAS_ACCOUNT);
    expect(withAccount.ok).toBe(false);
    expect(await share(NO_ACCOUNT)).toStrictEqual(withAccount);
  });

  it('refuses an address that is not an email before looking anything up', async () => {
    for (const bad of ['alice@', 'bob', '']) {
      const answer = await share(bad);
      expect(answer.ok, bad).toBe(false);
      if (!answer.ok) expect(answer.error.message).toBe('Enter a valid recipient email.');
    }
    expect(await audit('GRANT_RECIPIENT_NOT_REGISTERED')).toHaveLength(0);
  });

  it('tells a person only that they cannot share with themselves', async () => {
    const own = await share('owner@example.com');
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.error.message).toBe('You cannot share with yourself.');
  });
});
