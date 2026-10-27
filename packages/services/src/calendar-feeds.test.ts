import { createHash } from 'node:crypto';
import { type Result, isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import {
  generateCalendarFeedSecret,
  hashCalendarFeedSecret,
  isCalendarFeedSecretShape,
  requireCalendarFeedAccess,
  resolveCalendarFeedSecret,
} from './access/calendar-feed-secret';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import {
  CALENDAR_FEED_LINK_REPLACED_EVENT,
  CALENDAR_FEED_TURNED_OFF_EVENT,
  CALENDAR_FEED_TURNED_ON_EVENT,
  getCalendarFeedStatus,
  replaceCalendarFeedLink,
  turnOffCalendarFeed,
  turnOnCalendarFeed,
} from './calendar-feeds';
import { setConsent } from './consent';
import type { Db } from './db';
import type { ServiceError } from './errors';
import { acceptGrant, createGrant } from './sharing';

const HEAVY = 60_000;

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function person(email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error(`provision ${email}`);
  const ownerId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { ownerId, applicantId: applicant.value.id };
}

async function share(accountId: string, applicantId: string, purpose = 'self') {
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose },
  );
  if (!isOk(proof)) throw new Error('share proof');
  return proof.value;
}

async function view(accountId: string, applicantId: string, purpose = 'self') {
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose },
  );
  if (!isOk(proof)) throw new Error('view proof');
  return proof.value;
}

async function feedEvents() {
  return db
    .select()
    .from(schema.auditEvents)
    .where(like(schema.auditEvents.eventType, 'CALENDAR_FEED_%'));
}

describe('calendar link secrets', () => {
  it('are 256 random bits, checked for shape before any lookup, and kept only as a prefixed hash', () => {
    const a = generateCalendarFeedSecret();
    const b = generateCalendarFeedSecret();
    expect(a).not.toBe(b);
    expect(isCalendarFeedSecretShape(a)).toBe(true);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    for (const bad of ['', 'short', `${a}x`, `${a.slice(0, 42)}=`, `${a.slice(0, 42)}/`]) {
      expect(isCalendarFeedSecretShape(bad), bad).toBe(false);
    }
    const hash = hashCalendarFeedSecret(a);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(a);
    // Domain separated: never the plain SHA-256 another token store would keep.
    expect(hash).not.toBe(createHash('sha256').update(a).digest('hex'));
  });
});

describe('turning a calendar link on, replacing it and stopping it', () => {
  it(
    'returns the secret once, stores only its hash, and audits each change by kind only',
    async () => {
      const { ownerId, applicantId } = await person('feed-owner@example.com');
      expect(await getCalendarFeedStatus(await view(ownerId, applicantId))).toEqual({
        ok: true,
        value: { state: 'off' },
      });

      const on = await turnOnCalendarFeed(await share(ownerId, applicantId));
      if (!isOk(on)) throw new Error('turn on');
      const rows = await db.select().from(schema.calendarFeeds);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.secretHash).toBe(hashCalendarFeedSecret(on.value.secret));
      expect(JSON.stringify(rows)).not.toContain(on.value.secret);
      const status = await getCalendarFeedStatus(await view(ownerId, applicantId));
      expect(isOk(status) && status.value.state).toBe('on');

      // Turning it on again is refused: one link per traveller, replaced only on purpose.
      const again = await turnOnCalendarFeed(await share(ownerId, applicantId));
      expect(isErr(again) && again.error.code).toBe('stale');

      const replaced = await replaceCalendarFeedLink(await share(ownerId, applicantId));
      if (!isOk(replaced)) throw new Error('replace');
      expect(replaced.value.secret).not.toBe(on.value.secret);
      expect(await resolveCalendarFeedSecret(db, on.value.secret)).toBeNull();
      expect((await resolveCalendarFeedSecret(db, replaced.value.secret))?.applicantId).toBe(
        applicantId,
      );

      expect(isOk(await turnOffCalendarFeed(await share(ownerId, applicantId)))).toBe(true);
      expect(await resolveCalendarFeedSecret(db, replaced.value.secret)).toBeNull();
      expect(await db.select().from(schema.calendarFeeds)).toEqual([]);
      // Stopping a link that is already off changes nothing and writes nothing.
      expect(isOk(await turnOffCalendarFeed(await share(ownerId, applicantId)))).toBe(true);
      const noLink = await replaceCalendarFeedLink(await share(ownerId, applicantId));
      expect(isErr(noLink) && noLink.error.code).toBe('not_found');

      const events = await feedEvents();
      expect(events.map((e) => e.eventType)).toEqual([
        CALENDAR_FEED_TURNED_ON_EVENT,
        CALENDAR_FEED_LINK_REPLACED_EVENT,
        CALENDAR_FEED_TURNED_OFF_EVENT,
      ]);
      for (const event of events) {
        expect(event.actorAccountId).toBe(ownerId);
        expect(event.applicantId).toBe(applicantId);
        expect(event.resourceType).toBe('calendar_feed');
        expect(event.metadata ?? null).toBeNull();
        const written = JSON.stringify(event);
        expect(written).not.toContain(on.value.secret);
        expect(written).not.toContain(replaced.value.secret);
        expect(written).not.toContain(hashCalendarFeedSecret(on.value.secret));
      }
    },
    HEAVY,
  );

  it(
    'is the owner only: someone shared with, a copied proof and another person are all refused',
    async () => {
      const { ownerId, applicantId } = await person('feed-private@example.com');
      const other = await person('feed-other@example.com');
      // Another person cannot even get a proof for this traveller.
      const stranger = await requireAccess(
        db,
        accountPrincipal(other.ownerId),
        'MANAGE',
        { applicantId },
        { purpose: 'self' },
      );
      expect(isErr(stranger)).toBe(true);

      const grant = await createGrant(db, {
        actorAccountId: ownerId,
        applicantId,
        recipientAccountId: other.ownerId,
        actions: ['VIEW_METADATA', 'MANAGE'],
        purpose: 'family-help',
      });
      if (!isOk(grant)) throw new Error('grant');
      const accepted = await acceptGrant(db, {
        actorAccountId: other.ownerId,
        grantId: grant.value.id,
      });
      if (!isOk(accepted)) throw new Error('accept');
      const friendShare = await share(other.ownerId, applicantId, 'family-help');
      const friendView = await view(other.ownerId, applicantId, 'family-help');
      const friendResults: readonly Result<unknown, ServiceError>[] = [
        await turnOnCalendarFeed(friendShare),
        await replaceCalendarFeedLink(friendShare),
        await turnOffCalendarFeed(friendShare),
        await getCalendarFeedStatus(friendView),
      ];
      for (const refused of friendResults) {
        expect(!refused.ok && refused.error.code).toBe('forbidden');
      }

      const owner = await share(ownerId, applicantId);
      const copy = { ...owner } as unknown as typeof owner;
      const copied = await turnOnCalendarFeed(copy);
      expect(isErr(copied) && copied.error.code).toBe('forbidden');
      expect(await db.select().from(schema.calendarFeeds)).toEqual([]);
      expect(await feedEvents()).toEqual([]);
    },
    HEAVY,
  );

  it(
    'each traveller has their own link: one never resolves to another',
    async () => {
      const a = await person('feed-a@example.com');
      const b = await person('feed-b@example.com');
      const linkA = await turnOnCalendarFeed(await share(a.ownerId, a.applicantId));
      const linkB = await turnOnCalendarFeed(await share(b.ownerId, b.applicantId));
      if (!isOk(linkA) || !isOk(linkB)) throw new Error('links');
      const holderA = await resolveCalendarFeedSecret(db, linkA.value.secret);
      const holderB = await resolveCalendarFeedSecret(db, linkB.value.secret);
      if (!holderA || !holderB) throw new Error('holders');
      expect(holderA).toMatchObject({ applicantId: a.applicantId });
      expect(holderB).toMatchObject({ applicantId: b.applicantId });
      expect(Object.keys(holderA).sort()).toEqual(['applicantId', 'feedId']);
      // Each link reads as its own owner, for its own traveller only.
      const accessA = await requireCalendarFeedAccess(db, holderA);
      const accessB = await requireCalendarFeedAccess(db, holderB);
      expect(accessA?.applicant.id).toBe(a.applicantId);
      expect(accessA?.actor.kind).toBe('applicant_owner');
      expect(accessB?.applicant.id).toBe(b.applicantId);
      // A made-up or copied holder reads nothing.
      expect(await requireCalendarFeedAccess(db, { ...holderA })).toBeNull();
      expect(
        await requireCalendarFeedAccess(db, { feedId: holderA.feedId, applicantId: b.applicantId }),
      ).toBeNull();
      // Stopping one leaves the other alone.
      expect(isOk(await turnOffCalendarFeed(await share(a.ownerId, a.applicantId)))).toBe(true);
      expect(await resolveCalendarFeedSecret(db, linkA.value.secret)).toBeNull();
      expect(await resolveCalendarFeedSecret(db, linkB.value.secret)).not.toBeNull();
      // Unknown and malformed secrets resolve to nothing.
      expect(await resolveCalendarFeedSecret(db, generateCalendarFeedSecret())).toBeNull();
      expect(await resolveCalendarFeedSecret(db, "x' or '1'='1")).toBeNull();
    },
    HEAVY,
  );

  it(
    'before the table exists: status says unavailable, changes refuse, and links resolve to nothing',
    async () => {
      const { ownerId, applicantId } = await person('feed-early@example.com');
      const made = await turnOnCalendarFeed(await share(ownerId, applicantId));
      if (!isOk(made)) throw new Error('turn on');
      // A fresh handle, so no earlier "present" answer is remembered.
      const fresh = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
      db = fresh;
      const early = await person('feed-early-2@example.com');
      await db.execute(sql`drop table calendar_feeds`);
      expect(await getCalendarFeedStatus(await view(early.ownerId, early.applicantId))).toEqual({
        ok: true,
        value: { state: 'unavailable' },
      });
      const earlyResults: readonly Result<unknown, ServiceError>[] = [
        await turnOnCalendarFeed(await share(early.ownerId, early.applicantId)),
        await replaceCalendarFeedLink(await share(early.ownerId, early.applicantId)),
        await turnOffCalendarFeed(await share(early.ownerId, early.applicantId)),
      ];
      for (const refused of earlyResults) {
        expect(!refused.ok && refused.error.code).toBe('invalid');
      }
      expect(await resolveCalendarFeedSecret(db, made.value.secret)).toBeNull();
      const audit = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.applicantId, early.applicantId));
      expect(audit.some((e) => e.eventType.startsWith('CALENDAR_FEED_'))).toBe(false);
    },
    HEAVY,
  );
});
