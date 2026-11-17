import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { setConsent } from './consent';
import type { Db } from './db';
import { type Cases, freshDb, twoCases } from './finished-case-freeze.test-support';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { PROGRESS_CARD_MADE, readCaseProgressCounts } from './progress-card';
import { acceptGrant, createGrant } from './sharing';

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
    const finished = await readCaseProgressCounts(await view(cases.accountId, cases.finishedId));
    expect(finished.ok && finished.value.finished).toBe(true);
  });

  it('writes one audit row per card with the case and the owner, and no counts or text', async () => {
    await readCaseProgressCounts(await view(cases.accountId, cases.openId));
    const rows = await cardEvents();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.actorAccountId).toBe(cases.accountId);
    expect(row?.applicantId).toBe(cases.applicantId);
    expect(row?.missionId).toBe(cases.openId);
    expect(row?.metadata ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/Japan|Open case|passport/i);
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
});
