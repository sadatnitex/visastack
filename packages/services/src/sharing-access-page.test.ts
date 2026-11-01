import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { listAccessForApplicantDetailed } from './sharing';

/**
 * WP-SB3: the sharing page reads a few grants at a time. The optional `options` argument must
 * keep the owner check, return a stable order (holding access, waiting, ended; newest first),
 * count every grant, and leave the call without options exactly as it was.
 */
describe('listAccessForApplicantDetailed with a page size (WP-SB3)', () => {
  let db: Db;
  let ownerId: string;
  let strangerId: string;
  let applicantId: string;
  const recipients: string[] = [];

  beforeAll(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    const owner = await provisionAccount(db, { email: 'sb3-owner@example.test' });
    const stranger = await provisionAccount(db, { email: 'sb3-stranger@example.test' });
    if (!isOk(owner) || !isOk(stranger)) throw new Error('provision');
    ownerId = owner.value.id;
    strangerId = stranger.value.id;
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Owner',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    for (let index = 0; index < 4; index += 1) {
      const made = await provisionAccount(db, { email: `sb3-recipient-${index}@example.test` });
      if (!isOk(made)) throw new Error('recipient');
      recipients.push(made.value.id);
    }
    const day = 24 * 60 * 60 * 1000;
    const base = Date.UTC(2026, 9, 1);
    // 40 grants: every fourth holds access, the others wait, have ended, or ran past their date.
    const rows = Array.from({ length: 40 }, (_, index) => {
      const kind = index % 4;
      return {
        applicantId,
        recipientAccountId: recipients[index % recipients.length] ?? null,
        actions: ['VIEW_METADATA' as const],
        purpose: `Purpose ${index}`,
        status:
          kind === 0
            ? ('ACTIVE' as const)
            : kind === 1
              ? ('PENDING_ACCEPTANCE' as const)
              : kind === 2
                ? ('REVOKED' as const)
                : ('ACTIVE' as const),
        // The fourth kind is ACTIVE but its end date has passed: it no longer holds access.
        expiryAt: kind === 3 ? new Date(base - day) : null,
        createdAt: new Date(base + index * 60_000),
      };
    });
    await db.insert(schema.grants).values(rows);
  });

  it('keeps the call without options unchanged: every grant, each with its recipient', async () => {
    const all = await listAccessForApplicantDetailed(db, ownerId, applicantId);
    if (!isOk(all)) throw new Error('read');
    expect(Array.isArray(all.value)).toBe(true);
    expect(all.value).toHaveLength(40);
    expect(all.value.every((grant) => grant.recipient.kind === 'account')).toBe(true);
  });

  it('returns only the first grants, holding access first and newest first, with full counts', async () => {
    const page = await listAccessForApplicantDetailed(db, ownerId, applicantId, { limit: 5 });
    if (!isOk(page)) throw new Error('read');
    expect(page.value.items).toHaveLength(5);
    expect(page.value.counts).toEqual({ total: 40, active: 20, holdingAccess: 10 });
    expect(page.value.items.every((grant) => grant.status === 'ACTIVE' && !grant.expiryAt)).toBe(
      true,
    );
    const times = page.value.items.map((grant) => grant.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(page.value.items[0]?.purpose).toBe('Purpose 36');
    expect(page.value.items[0]?.recipient.label).toBe('sb3-recipient-0@example.test');
  });

  it('orders waiting grants after those holding access, and ended grants last', async () => {
    const page = await listAccessForApplicantDetailed(db, ownerId, applicantId, { limit: 40 });
    if (!isOk(page)) throw new Error('read');
    const ranks = page.value.items.map((grant) =>
      grant.status === 'REVOKED' || grant.expiryAt
        ? 2
        : grant.status === 'PENDING_ACCEPTANCE'
          ? 1
          : 0,
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks.filter((rank) => rank === 0)).toHaveLength(10);
    expect(ranks.at(-1)).toBe(2);
  });

  it('clamps the page size between 1 and 100', async () => {
    const tiny = await listAccessForApplicantDetailed(db, ownerId, applicantId, { limit: 0 });
    const huge = await listAccessForApplicantDetailed(db, ownerId, applicantId, { limit: 10_000 });
    const none = await listAccessForApplicantDetailed(db, ownerId, applicantId, {});
    if (!isOk(tiny) || !isOk(huge) || !isOk(none)) throw new Error('read');
    expect(tiny.value.items).toHaveLength(1);
    expect(huge.value.items).toHaveLength(40);
    expect(none.value.items).toHaveLength(40);
  });

  it('refuses anyone but the owner, with or without a page size', async () => {
    expect(isErr(await listAccessForApplicantDetailed(db, strangerId, applicantId))).toBe(true);
    expect(
      isErr(await listAccessForApplicantDetailed(db, strangerId, applicantId, { limit: 5 })),
    ).toBe(true);
    const recipient = recipients[0] ?? '';
    expect(
      isErr(await listAccessForApplicantDetailed(db, recipient, applicantId, { limit: 5 })),
    ).toBe(true);
  });
});
