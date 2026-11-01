import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { listEvidenceRequestsForApplicant } from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createOrganization } from './organizations';

/**
 * WP-SB3: the evidence page reads ten requests at a time. With `options` the read is limited in
 * the database, in the page's own order (waiting first, then the soonest due date, none last,
 * then newest), with counts over every request; without options it is unchanged.
 */
describe('listEvidenceRequestsForApplicant with a page size (WP-SB3)', () => {
  let db: Db;
  let ownerId: string;
  let strangerId: string;
  let applicantId: string;
  let otherApplicantId: string;

  beforeAll(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    const owner = await provisionAccount(db, { email: 'sb3-evidence-owner@example.test' });
    const stranger = await provisionAccount(db, { email: 'sb3-evidence-stranger@example.test' });
    const agent = await provisionAccount(db, { email: 'sb3-evidence-agent@example.test' });
    if (!isOk(owner) || !isOk(stranger) || !isOk(agent)) throw new Error('provision');
    ownerId = owner.value.id;
    strangerId = stranger.value.id;
    for (const id of [ownerId, strangerId]) {
      await setConsent(db, {
        actorAccountId: id,
        accountId: id,
        type: 'CORE_PROCESSING',
        granted: true,
      });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Owner',
    });
    const other = await createApplicant(db, {
      actorAccountId: strangerId,
      ownerAccountId: strangerId,
      displayName: 'Someone Else',
    });
    if (!isOk(applicant) || !isOk(other)) throw new Error('applicant');
    applicantId = applicant.value.id;
    otherApplicantId = other.value.id;
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const base = Date.UTC(2026, 9, 1);
    const day = 24 * 60 * 60 * 1000;
    // 30 requests: every third waits on the person, half of those with a due date.
    const rows = Array.from({ length: 30 }, (_, index) => ({
      organizationId: org.value.id,
      applicantId,
      kind: 'DOCUMENT' as const,
      docType: 'passport',
      message: `Request ${index}`,
      status:
        index % 3 === 0
          ? index % 2 === 0
            ? ('OPEN' as const)
            : ('NEEDS_REPLACEMENT' as const)
          : ('ACCEPTED' as const),
      dueDate: index % 6 === 0 ? new Date(base + (30 - index) * day) : null,
      createdAt: new Date(base + index * 60_000),
    }));
    await db.insert(schema.evidenceRequests).values(rows);
    await db.insert(schema.evidenceRequests).values({
      organizationId: org.value.id,
      applicantId: otherApplicantId,
      kind: 'DOCUMENT',
      docType: 'passport',
      message: 'Not this person',
      status: 'OPEN',
    });
  });

  it('keeps the call without options unchanged: every request, newest first', async () => {
    const all = await listEvidenceRequestsForApplicant(db, ownerId, applicantId);
    if (!isOk(all)) throw new Error('read');
    expect(all.value).toHaveLength(30);
    expect(all.value[0]?.message).toBe('Request 29');
    expect(all.value.every((request) => request.applicantId === applicantId)).toBe(true);
  });

  it('reads one page in the page order, with counts over every request', async () => {
    const page = await listEvidenceRequestsForApplicant(db, ownerId, applicantId, { limit: 10 });
    if (!isOk(page)) throw new Error('read');
    expect(page.value.items).toHaveLength(10);
    expect(page.value.more).toBe(true);
    expect(page.value.counts).toEqual({ total: 30, awaiting: 10 });
    const messages = page.value.items.map((request) => request.message);
    // Waiting with a due date (soonest first), then waiting without one (newest first).
    expect(messages).toEqual([
      'Request 24',
      'Request 18',
      'Request 12',
      'Request 6',
      'Request 0',
      'Request 27',
      'Request 21',
      'Request 15',
      'Request 9',
      'Request 3',
    ]);
  });

  it('says when nothing more exists and clamps the page size', async () => {
    const all = await listEvidenceRequestsForApplicant(db, ownerId, applicantId, { limit: 500 });
    const one = await listEvidenceRequestsForApplicant(db, ownerId, applicantId, { limit: -3 });
    if (!isOk(all) || !isOk(one)) throw new Error('read');
    expect(all.value.items).toHaveLength(30);
    expect(all.value.more).toBe(false);
    expect(one.value.items).toHaveLength(1);
    expect(one.value.more).toBe(true);
  });

  it('refuses anyone but the owner, with or without a page size', async () => {
    expect(isErr(await listEvidenceRequestsForApplicant(db, strangerId, applicantId))).toBe(true);
    expect(
      isErr(await listEvidenceRequestsForApplicant(db, strangerId, applicantId, { limit: 10 })),
    ).toBe(true);
  });
});
