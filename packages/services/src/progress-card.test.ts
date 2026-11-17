import { randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { setConsent } from './consent';
import type { Db } from './db';
import { type Cases, freshDb, twoCases } from './finished-case-freeze.test-support';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { PROGRESS_CARD_MADE, readCaseProgressCounts } from './progress-card';
import { acceptGrant, createGrant, revokeGrant } from './sharing';

/**
 * WP-PIC15: the progress card's one read. Counts only, the record's owner only, and one audit row
 * per card that holds no counts and no text.
 */
describe('readCaseProgressCounts', () => {
  let db: Db;
  let cases: Cases;

  const view = async (accountId: string, missionId: string) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { missionId },
      { purpose: EACH_GRANT },
    );
    if (!proof.ok) throw new Error(`view proof: ${proof.error.code}`);
    return proof.value;
  };
  const account = async (email: string) => {
    const made = await provisionAccount(db, { email });
    if (!isOk(made)) throw new Error(`provision ${email}`);
    return made.value.id;
  };
  const cardEvents = () =>
    db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, PROGRESS_CARD_MADE));

  beforeEach(async () => {
    db = await freshDb();
    cases = await twoCases(db, 'DOCUMENT');
    await setConsent(db, {
      actorAccountId: cases.accountId,
      accountId: cases.accountId,
      type: 'SHARING',
      granted: true,
    });
    await db
      .update(schema.missions)
      .set({ destination: 'Japan' })
      .where(eq(schema.missions.id, cases.openId));
  }, 60_000);

  it('gives the owner the counts, the saved place and whether the case is finished, and nothing else', async () => {
    const result = await readCaseProgressCounts(await view(cases.accountId, cases.openId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      missionId: cases.openId,
      satisfiedRequired: 1,
      requiredCount: 1,
      destination: 'Japan',
      finished: false,
    });
    // A submitted case still waits for a decision: it is not finished.
    const submitted = await readCaseProgressCounts(await view(cases.accountId, cases.finishedId));
    expect(submitted.ok && submitted.value.finished).toBe(false);
    await db
      .update(schema.missions)
      .set({ state: 'CLOSED' })
      .where(eq(schema.missions.id, cases.finishedId));
    const closed = await readCaseProgressCounts(await view(cases.accountId, cases.finishedId));
    expect(closed.ok && closed.value.finished).toBe(true);
  });

  it('writes one audit row per card with the case and the owner, and no counts or text', async () => {
    await readCaseProgressCounts(await view(cases.accountId, cases.openId));
    const rows = await cardEvents();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.actorAccountId).toBe(cases.accountId);
    expect(row?.applicantId).toBe(cases.applicantId);
    expect(row?.missionId).toBe(cases.openId);
    expect(row?.actorRole).toBe('applicant_owner');
    expect(row?.metadata ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/Japan|Open case|passport/i);
  });

  it('gives no card when its audit row cannot be written', async () => {
    const proof = await view(cases.accountId, cases.openId);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await db.execute(sql`ALTER TABLE audit_events RENAME COLUMN metadata TO metadata_gone`);
    try {
      const result = await readCaseProgressCounts(proof);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('not_found');
    } finally {
      await db.execute(sql`ALTER TABLE audit_events RENAME COLUMN metadata_gone TO metadata`);
      quiet.mockRestore();
    }
  });

  it('refuses an agency member with a live grant over the whole record, like a missing case', async () => {
    const agentId = await account('agent@acme.example.com');
    const org = await createOrganization(db, { actorAccountId: agentId, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account('reviewer@platform.example.com');
    await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: cases.accountId,
      applicantId: cases.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'visa-review',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: agentId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');

    const proof = await view(agentId, cases.openId);
    expect(proof.actor.kind).toBe('organization_member');
    const result = await readCaseProgressCounts(proof);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
    expect(await cardEvents()).toHaveLength(0);
  });

  it('refuses a family member or delegate the record is shared with, like a missing case', async () => {
    const relativeId = await account('relative@example.com');
    const grant = await createGrant(db, {
      actorAccountId: cases.accountId,
      applicantId: cases.applicantId,
      recipientAccountId: relativeId,
      actions: ['VIEW_METADATA'],
      purpose: 'family-help',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: relativeId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');

    const proof = await view(relativeId, cases.openId);
    expect(proof.actor.kind).toBe('individual_recipient');
    const result = await readCaseProgressCounts(proof);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
    expect(await cardEvents()).toHaveLength(0);
  });

  it('refuses a proof for the whole record, a copy of a proof and a case with no checklist', async () => {
    const whole = await requireAccess(
      db,
      accountPrincipal(cases.accountId),
      'VIEW_METADATA',
      { applicantId: cases.applicantId },
      { purpose: EACH_GRANT },
    );
    if (!whole.ok) throw new Error('whole');
    expect((await readCaseProgressCounts(whole.value)).ok).toBe(false);

    const genuine = await view(cases.accountId, cases.openId);
    const copy = { ...genuine } as typeof genuine;
    expect((await readCaseProgressCounts(copy)).ok).toBe(false);

    const bare = await createMission(db, {
      actorAccountId: cases.accountId,
      applicantId: cases.applicantId,
      title: 'No checklist',
    });
    if (!isOk(bare)) throw new Error('mission');
    expect((await readCaseProgressCounts(await view(cases.accountId, bare.value.id))).ok).toBe(
      false,
    );
    expect(await cardEvents()).toHaveLength(0);
  });
  /**
   * What the web route does: the access gate for this person and this case, then the owner-only
   * read. Every refusal becomes the same not-found there, so each case below must be refused at
   * one of the two steps and leave no audit row.
   */
  const routeAnswer = async (accountId: string, missionId: string) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { missionId },
      { purpose: 'self' },
    );
    if (!proof.ok) return 'not found';
    const read = await readCaseProgressCounts(proof.value);
    return read.ok ? 'card' : 'not found';
  };
  const sharedWithRelative = async (expiryAt?: Date) => {
    const relativeId = await account(`relative-${randomUUID()}@example.com`);
    const grant = await createGrant(db, {
      actorAccountId: cases.accountId,
      applicantId: cases.applicantId,
      recipientAccountId: relativeId,
      actions: ['VIEW_METADATA'],
      purpose: 'family-help',
      ...(expiryAt ? { expiryAt } : {}),
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: relativeId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    return { relativeId, grantId: grant.value.id };
  };

  it('gives the owner a card through the same steps the route takes', async () => {
    expect(await routeAnswer(cases.accountId, cases.openId)).toBe('card');
  });

  it("refuses another traveller asking for this traveller's case, like a missing case", async () => {
    const stranger = await twoCases(db, 'FIELD');
    // Control: each traveller gets a card for their own case.
    expect(await routeAnswer(stranger.accountId, stranger.openId)).toBe('card');
    expect(await cardEvents()).toHaveLength(1);
    expect(await routeAnswer(stranger.accountId, cases.openId)).toBe('not found');
    expect(await routeAnswer(cases.accountId, stranger.openId)).toBe('not found');
    // Only the control's card left a row: neither refusal wrote one.
    expect(await cardEvents()).toHaveLength(1);
  });

  /** Whether the share itself still lets this person view the case (the gate, not the card). */
  const shareStillOpens = async (accountId: string) =>
    (
      await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { missionId: cases.openId },
        { purpose: EACH_GRANT },
      )
    ).ok;

  it('refuses a person whose share was revoked, like a missing case', async () => {
    const { relativeId, grantId } = await sharedWithRelative();
    // Control: the live share does open the case, so the refusal below is the revocation's doing.
    expect(await shareStillOpens(relativeId)).toBe(true);
    const revoked = await revokeGrant(db, { actorAccountId: cases.accountId, grantId });
    if (!isOk(revoked)) throw new Error('revoke');
    expect(await shareStillOpens(relativeId)).toBe(false);
    expect(await routeAnswer(relativeId, cases.openId)).toBe('not found');
    expect(await cardEvents()).toHaveLength(0);
  });

  it('refuses a person whose share has expired, like a missing case', async () => {
    const { relativeId, grantId } = await sharedWithRelative(new Date(Date.now() + 60_000));
    expect(await shareStillOpens(relativeId)).toBe(true);
    await db
      .update(schema.grants)
      .set({ expiryAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.grants.id, grantId));
    expect(await shareStillOpens(relativeId)).toBe(false);
    expect(await routeAnswer(relativeId, cases.openId)).toBe('not found');
    expect(await cardEvents()).toHaveLength(0);
  });

  it('refuses a case that does not exist or has been deleted, like any other refusal', async () => {
    expect(await routeAnswer(cases.accountId, randomUUID())).toBe('not found');
    await db.execute(sql`DELETE FROM missions WHERE id = ${cases.openId}`);
    expect(await routeAnswer(cases.accountId, cases.openId)).toBe('not found');
    expect(await cardEvents()).toHaveLength(0);
  });
});
