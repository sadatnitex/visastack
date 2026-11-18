import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { EACH_GRANT, type RequireAccessOptions, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import {
  PROFILE_VALUE_ACCESS,
  PROFILE_VALUE_REVEALS_PER_HOUR,
  openOwnProfileValue,
} from './profile-value-access';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { acceptGrant, createGrant } from './sharing';

/**
 * ESS1 review: the audited one-value reveal. A shared viewer is refused and named by account in
 * the DENIED row; the owner's reveals are bounded per hour, with one rate_limited row and no row
 * per extra call. Real database, synthetic values.
 */

function port(keyVersion = 'test-v1'): KeyManagementPort {
  const dataKey = Buffer.alloc(32, 5);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return {
        keyVersion,
        plaintextDataKey: Buffer.from(dataKey),
        wrappedDataKey: randomBytes(32),
      };
    },
    async unwrapDataKey() {
      return dataKey;
    },
  };
}

describe('openOwnProfileValue', () => {
  let db: Db;
  let owner: string;
  let applicantId: string;
  let factId: string;
  const keys = port();

  async function account(email: string): Promise<string> {
    const made = await provisionAccount(db, { email });
    if (!isOk(made)) throw new Error('provision failed');
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    return made.value.id;
  }

  const events = () =>
    db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, PROFILE_VALUE_ACCESS));

  async function proofFor(accountId: string, purpose: RequireAccessOptions['purpose']) {
    const gate = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      {
        applicantId,
      },
      { purpose },
    );
    if (!gate.ok) throw new Error('no proof');
    return gate.value;
  }

  beforeEach(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    resetProtectedFieldKeyCacheForTests();
    owner = await account('ess1-svc-owner@example.com');
    const applicant = await createApplicant(db, {
      actorAccountId: owner,
      ownerAccountId: owner,
      displayName: 'Made-up Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    const saved = await editFact(db, {
      actorAccountId: owner,
      applicantId,
      fieldKey: 'passport_number',
      value: 'X1234567',
      encryption: keys,
    });
    if (!isOk(saved)) throw new Error('seed');
    factId = saved.value.version.factId;
  });

  it('refuses a person the record is shared with, naming them by account in the DENIED row', async () => {
    const relative = await account('ess1-svc-relative@example.com');
    await setConsent(db, {
      actorAccountId: owner,
      accountId: owner,
      type: 'SHARING',
      granted: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: owner,
      applicantId,
      recipientAccountId: relative,
      actions: ['VIEW_METADATA'],
      purpose: 'family-help',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: relative, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    const proof = await proofFor(relative, EACH_GRANT);
    expect(proof.actor.kind).toBe('individual_recipient');
    const result = await openOwnProfileValue(proof, { factId, encryption: keys });
    expect(result.ok).toBe(false);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      result: 'DENIED',
      reason: 'not_owner',
      actorAccountId: relative,
      actorRole: 'individual_recipient',
    });
    expect(JSON.stringify(rows)).not.toContain('X1234567');
  });

  it('names the owner by role, not account, in an ALLOWED row', async () => {
    const result = await openOwnProfileValue(await proofFor(owner, 'profile_view'), {
      factId,
      encryption: keys,
    });
    expect(result.ok).toBe(true);
    const [row] = await events();
    expect(row).toMatchObject({
      result: 'ALLOWED',
      actorAccountId: null,
      actorRole: 'applicant_owner',
    });
  });

  it('bounds the owner to 120 reveals an hour: then one rate_limited row, nothing opened, no row per call', async () => {
    const proof = await proofFor(owner, 'profile_view');
    for (let i = 0; i < PROFILE_VALUE_REVEALS_PER_HOUR.limit; i++) {
      expect((await openOwnProfileValue(proof, { factId, encryption: keys })).ok).toBe(true);
    }
    const extra = [
      await openOwnProfileValue(proof, { factId, encryption: keys }),
      await openOwnProfileValue(proof, { factId, encryption: keys }),
      await openOwnProfileValue(proof, { factId, encryption: keys }),
    ];
    for (const result of extra) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('rate_limited');
    }
    const denied = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, PROFILE_VALUE_ACCESS),
          eq(schema.auditEvents.result, 'DENIED'),
        ),
      );
    expect(denied.map((row) => row.reason)).toEqual(['rate_limited']);
    expect(await events()).toHaveLength(PROFILE_VALUE_REVEALS_PER_HOUR.limit + 1);
  }, 120_000);
});
