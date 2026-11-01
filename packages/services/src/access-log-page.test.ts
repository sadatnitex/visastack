import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { appendAuditEvent, listAuditEventsForApplicant } from './audit';
import { setConsent } from './consent';
import type { Db } from './db';
import { encodeSeqCursor } from './paging';

/**
 * WP-SB3: the sharing page's Access Log loads older entries one page at a time. The cursor must
 * stay inside this owner's own log: a cursor for another record, or a malformed one, gives the
 * first page, and the owner check is the same as before.
 */
describe('listAuditEventsForApplicant with a page and cursor (WP-SB3)', () => {
  let db: Db;
  let ownerId: string;
  let otherOwnerId: string;
  let applicantId: string;
  let otherApplicantId: string;

  beforeAll(async () => {
    const client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    const owner = await provisionAccount(db, { email: 'sb3-log-owner@example.test' });
    const other = await provisionAccount(db, { email: 'sb3-log-other@example.test' });
    if (!isOk(owner) || !isOk(other)) throw new Error('provision');
    ownerId = owner.value.id;
    otherOwnerId = other.value.id;
    for (const id of [ownerId, otherOwnerId]) {
      await setConsent(db, {
        actorAccountId: id,
        accountId: id,
        type: 'CORE_PROCESSING',
        granted: true,
      });
    }
    const mine = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Mine',
    });
    const theirs = await createApplicant(db, {
      actorAccountId: otherOwnerId,
      ownerAccountId: otherOwnerId,
      displayName: 'Theirs',
    });
    if (!isOk(mine) || !isOk(theirs)) throw new Error('applicant');
    applicantId = mine.value.id;
    otherApplicantId = theirs.value.id;
    for (let index = 0; index < 120; index += 1) {
      await appendAuditEvent(db, {
        eventType: `SB3_EVENT_${index}`,
        actorAccountId: ownerId,
        action: 'VIEW_METADATA',
        result: 'ALLOWED',
        applicantId: index % 4 === 3 ? otherApplicantId : applicantId,
      });
    }
  });

  const mineOnly = (events: readonly { eventType: string }[]) =>
    events.every((event) => event.eventType.startsWith('SB3_EVENT_'));

  it('keeps the call with a number unchanged', async () => {
    const events = await listAuditEventsForApplicant(db, ownerId, applicantId, 300);
    const ownLog = events.filter((event) => event.eventType.startsWith('SB3_EVENT_'));
    expect(ownLog).toHaveLength(90);
    expect(Array.isArray(events)).toBe(true);
  });

  it('walks the whole log newest first, page by page, without gaps or repeats', async () => {
    const seen: number[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listAuditEventsForApplicant(db, ownerId, applicantId, {
        limit: 25,
        ...(before ? { before } : {}),
      });
      seen.push(...result.items.map((event) => event.seq));
      if (!result.nextCursor) break;
      before = result.nextCursor;
    }
    const all = await listAuditEventsForApplicant(db, ownerId, applicantId, 1000);
    expect(seen).toEqual(all.map((event) => event.seq));
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives the first page for a cursor made for another record, or a malformed one', async () => {
    const first = await listAuditEventsForApplicant(db, ownerId, applicantId, { limit: 10 });
    const foreign = encodeSeqCursor(
      first.items.at(-1)?.seq ?? 1,
      `applicant:${otherApplicantId}:access-log`,
    );
    for (const before of [foreign, 'not-a-cursor', '%%%', 'e30', '']) {
      const page = await listAuditEventsForApplicant(db, ownerId, applicantId, {
        limit: 10,
        before,
      });
      expect(page.items.map((event) => event.seq)).toEqual(first.items.map((event) => event.seq));
    }
    expect(mineOnly(first.items)).toBe(true);
  });

  it('never shows another record’s entries, even with that record’s own cursor', async () => {
    const theirs = await listAuditEventsForApplicant(db, otherOwnerId, otherApplicantId, {
      limit: 5,
    });
    expect(theirs.nextCursor).not.toBeNull();
    const mine = await listAuditEventsForApplicant(db, ownerId, applicantId, {
      limit: 100,
      before: theirs.nextCursor ?? '',
    });
    const all = await listAuditEventsForApplicant(db, ownerId, applicantId, 1000);
    expect(mine.items.map((event) => event.seq)).toEqual(
      all.slice(0, 100).map((event) => event.seq),
    );
  });

  it('refuses anyone but the owner, with or without a cursor', async () => {
    const page = await listAuditEventsForApplicant(db, otherOwnerId, applicantId, { limit: 10 });
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(await listAuditEventsForApplicant(db, otherOwnerId, applicantId)).toEqual([]);
  });
});
