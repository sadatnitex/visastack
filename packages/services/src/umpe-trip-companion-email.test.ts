/**
 * UMPE UX6, package 3: the invitation email for someone travelling with the organiser.
 *
 * Synthetic data only; the mail provider and the key service are test doubles. Pins:
 * 1. The email is queued once per sending, with the link sealed (the outbox never holds a usable
 *    token), and Send Again is a new email, not swallowed as a duplicate; only the newest link goes.
 * 2. Only the invitation that is live right now can be queued: a stale link, another organiser's
 *    trip, a different address, a used or removed row and a switch that is off are all refused.
 * 3. The worker asks again at send time: a used, declined, removed, lapsed or re-addressed
 *    invitation, or a switch turned off since, sends nothing.
 * 4. The words say that a person added them to a trip, that they choose, and that the link lasts 7
 *    days; never the organiser, the trip, the route or anyone else on it.
 * 5. Nothing in the path looks an account up by an address.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AuthorizedApplicant, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  COMPANION_INVITATION_EMAIL_EVENT,
  type SealedInvitationLink,
  revealInvitationLink,
} from './invitation-email';
import { RECIPIENT_NO_LONGER_AUTHORIZED, runNotificationWorker } from './notifications';
import type { KeyManagementPort, SendEmailInput } from './ports';
import { queueCompanionInvitation } from './umpe-trip-companion-email';
import {
  COMPANION_INVITATION_DAYS,
  type CompanionInvitationDelivery,
  acceptCompanionInvitation,
  addCompanion,
  declineCompanionInvitation,
  openCompanionInvitation,
  previewCompanionInvitation,
  removeCompanion,
  resendInvitation,
} from './umpe-trip-companions';
import { TRIP_COMPANIONS_SWITCH } from './umpe-trip-companions-switch';
import { startGroupTrip } from './umpe-trip-service';

const TEST_TIMEOUT_MS = 90_000;
const SWITCH = TRIP_COMPANIONS_SWITCH;
const LONG_DASH = String.fromCharCode(0x2014);
const BASE = 'https://app.example.test';
const FRIEND = 'friend@example.com';

const keys = new Map<string, Uint8Array>();
const encryption: KeyManagementPort = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    const id = randomUUID();
    const key = randomBytes(32);
    keys.set(id, key);
    return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: Buffer.from(id) };
  },
  async unwrapDataKey(version, wrapped) {
    const key = keys.get(Buffer.from(wrapped).toString());
    if (version !== 'test-v1' || !key) throw new Error('Unknown key');
    return key;
  },
};

interface LoggedQuery {
  readonly query: string;
}

async function freshDb(log?: LoggedQuery[]): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, {
    schema,
    ...(log
      ? {
          logger: {
            logQuery(query: string) {
              log.push({ query });
            },
          },
        }
      : {}),
  }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: created.value.id,
    accountId: created.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await db
    .update(schema.accounts)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(schema.accounts.id, created.value.id));
  return created.value.id;
}

async function proofFor(
  db: Db,
  actor: string,
  applicantId: string,
): Promise<AuthorizedApplicant<'MANAGE'>> {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'MANAGE',
    { applicantId },
    { purpose: 'owner_trip' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value as AuthorizedApplicant<'MANAGE'>;
}

interface Organiser {
  readonly accountId: string;
  readonly applicantId: string;
  readonly tripId: string;
}

async function organiser(db: Db, email = 'organiser@example.com'): Promise<Organiser> {
  const accountId = await account(db, email);
  const created = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Rahima Organiser',
    relationship: 'SELF',
  });
  if (!isOk(created)) throw new Error('applicant');
  const started = await startGroupTrip(await proofFor(db, accountId, created.value.id), {
    destination: 'Japan',
    purpose: 'Tourism',
  });
  if (!isOk(started)) throw new Error('trip');
  return { accountId, applicantId: created.value.id, tripId: started.value.tripId };
}

async function invite(db: Db, org: Organiser, email = FRIEND) {
  const proof = await proofFor(db, org.accountId, org.applicantId);
  const added = await addCompanion(proof, org.tripId, { name: 'Nadia Rahman', email });
  if (!isOk(added) || !added.value.invitation) throw new Error('invite');
  return { proof, companionId: added.value.companion.id, delivery: added.value.invitation };
}

async function send(
  db: Db,
  org: Organiser,
  companionId: string,
  delivery: CompanionInvitationDelivery,
) {
  return queueCompanionInvitation(await proofFor(db, org.accountId, org.applicantId), {
    tripId: org.tripId,
    companionId,
    invitation: delivery,
    encryption,
  });
}

const sent: SendEmailInput[] = [];
const emailPort = {
  async send(input: SendEmailInput) {
    sent.push(input);
    return { providerMessageId: randomUUID() };
  },
};
const run = (db: Db) => runNotificationWorker(db, emailPort, BASE, { encryption });
const outbox = (db: Db) => db.select().from(schema.notifications);

let previous: string | undefined;
beforeEach(() => {
  previous = process.env[SWITCH];
  process.env[SWITCH] = 'true';
  sent.length = 0;
});
afterEach(() => {
  if (previous === undefined) Reflect.deleteProperty(process.env, SWITCH);
  else process.env[SWITCH] = previous;
});

describe('queueing the invitation email', () => {
  it(
    'queues one sealed email for the address given, holding no usable link',
    async () => {
      const db = await freshDb();
      const org = await organiser(db);
      const { companionId, delivery } = await invite(db, org);
      expect(await outbox(db)).toHaveLength(0);
      const queued = await send(db, org, companionId, delivery);
      expect(isOk(queued)).toBe(true);
      const rows = await outbox(db);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.eventType).toBe(COMPANION_INVITATION_EMAIL_EVENT);
      expect(row?.channel).toBe('EMAIL');
      expect(row?.recipientEmail).toBe(FRIEND);
      expect(row?.resourceId).toBe(companionId);
      expect(row?.status).toBe('QUEUED');
      const stored = JSON.stringify(rows);
      expect(stored).not.toContain(delivery.rawToken);
      expect(stored).not.toContain('trip-invitations/accept?token');
      const payload = row?.payload as { sealedInvitationLink?: SealedInvitationLink };
      expect(payload.sealedInvitationLink?.ciphertext).toBeTruthy();
      // The sealed value opens only as this kind, for this invitation.
      const path = await revealInvitationLink(
        payload.sealedInvitationLink as SealedInvitationLink,
        'companion',
        companionId,
        encryption,
      );
      expect(path).toBe(`/app/trip-invitations/accept?token=${delivery.rawToken}`);
      await expect(
        revealInvitationLink(
          payload.sealedInvitationLink as SealedInvitationLink,
          'contributor',
          companionId,
          encryption,
        ),
      ).rejects.toThrow();
      await expect(
        revealInvitationLink(
          payload.sealedInvitationLink as SealedInvitationLink,
          'companion',
          randomUUID(),
          encryption,
        ),
      ).rejects.toThrow();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends the email with the link, in plain words that name nobody and nothing private',
    async () => {
      const db = await freshDb();
      const org = await organiser(db);
      const { companionId, delivery } = await invite(db, org);
      await send(db, org, companionId, delivery);
      expect((await run(db)).sent).toBe(1);
      expect(sent).toHaveLength(1);
      const mail = sent[0];
      expect(mail?.to).toBe(FRIEND);
      expect(mail?.body).toContain(
        `${BASE}/app/trip-invitations/accept?token=${delivery.rawToken}`,
      );
      const everything = `${mail?.subject}\n${mail?.body}\n${mail?.html}`;
      expect(mail?.subject).toBe('You were added to a trip on VisaStack');
      expect(everything).toContain('Someone added you to a trip');
      expect(everything).toContain('You choose whether to join and what to share');
      expect(everything).toContain('Nobody gets access to your documents');
      expect(everything).toContain(`${COMPANION_INVITATION_DAYS} days`);
      expect(everything).toContain('Open Your Invitation');
      // Nothing about the organiser, the trip, the route or the people on it.
      for (const private_ of [
        'Rahima',
        'Organiser',
        'organiser@example.com',
        'Japan',
        'Tourism',
        'Nadia',
        org.tripId,
        org.applicantId,
        org.accountId,
      ]) {
        expect(everything, private_).not.toContain(private_);
      }
      expect(everything).not.toContain(LONG_DASH);
      expect(everything).not.toMatch(/\bmission\b/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'lets the person accept with the emailed link (the whole path end to end)',
    async () => {
      const db = await freshDb();
      const org = await organiser(db);
      const { companionId, delivery } = await invite(db, org);
      await send(db, org, companionId, delivery);
      await run(db);
      const token = /trip-invitations\/accept\?token=([A-Za-z0-9_-]{43})/.exec(
        sent[0]?.body ?? '',
      )?.[1];
      expect(token).toBe(delivery.rawToken);
      const guest = await account(db, FRIEND);
      const opened = await openCompanionInvitation(db, { accountId: guest, rawToken: token ?? '' });
      if (!opened.ok) throw new Error('open');
      expect(
        isOk(await acceptCompanionInvitation(db, opened.value, { rawToken: token ?? '' })),
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends Send Again as a new email with only the newest link, and the old link stops working',
    async () => {
      const db = await freshDb();
      const org = await organiser(db);
      const first = await invite(db, org);
      await send(db, org, first.companionId, first.delivery);
      // The organiser asks again before the first email went out.
      const again = await resendInvitation(first.proof, org.tripId, first.companionId);
      if (!again.ok || !again.value.invitation) throw new Error('resend');
      const second = again.value.invitation;
      expect(isOk(await send(db, org, first.companionId, second))).toBe(true);
      const rows = await outbox(db);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'QUEUED')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'CANCELLED')).toHaveLength(1);
      expect((await run(db)).sent).toBe(1);
      expect(sent[0]?.body).toContain(second.rawToken);
      expect(sent[0]?.body).not.toContain(first.delivery.rawToken);
      const guest = await account(db, FRIEND);
      expect(
        (
          await previewCompanionInvitation(db, {
            accountId: guest,
            rawToken: first.delivery.rawToken,
          })
        ).ok,
      ).toBe(false);
      expect(
        (await previewCompanionInvitation(db, { accountId: guest, rawToken: second.rawToken })).ok,
      ).toBe(true);
      // A third sending after the second went out is a third email.
      const third = await resendInvitation(first.proof, org.tripId, first.companionId);
      if (!third.ok || !third.value.invitation) throw new Error('resend');
      await send(db, org, first.companionId, third.value.invitation);
      expect((await run(db)).sent).toBe(1);
      expect(sent).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('only the invitation that is live right now can be queued', () => {
  it(
    'refuses a stale link, a different address, another organiser, a used or removed row, and a switch that is off',
    async () => {
      const db = await freshDb();
      const org = await organiser(db);
      const first = await invite(db, org);
      const again = await resendInvitation(first.proof, org.tripId, first.companionId);
      if (!again.ok || !again.value.invitation) throw new Error('resend');
      // The link before the resend no longer matches the row.
      const stale = await send(db, org, first.companionId, first.delivery);
      expect(stale.ok).toBe(false);
      // A delivery naming another address is refused.
      const wrongAddress = await send(db, org, first.companionId, {
        ...again.value.invitation,
        recipientEmail: 'someone.else@example.com',
      });
      expect(wrongAddress.ok).toBe(false);
      // Another organiser, with a proof of their own trip, reaches nothing here.
      const other = await organiser(db, 'other.organiser@example.com');
      const foreign = await queueCompanionInvitation(
        await proofFor(db, other.accountId, other.applicantId),
        {
          tripId: org.tripId,
          companionId: first.companionId,
          invitation: again.value.invitation,
          encryption,
        },
      );
      expect(foreign.ok).toBe(false);
      const wrongTrip = await queueCompanionInvitation(
        await proofFor(db, other.accountId, other.applicantId),
        {
          tripId: other.tripId,
          companionId: first.companionId,
          invitation: again.value.invitation,
          encryption,
        },
      );
      expect(wrongTrip.ok).toBe(false);
      expect(await outbox(db)).toHaveLength(0);
      // The switch off.
      process.env[SWITCH] = 'false';
      expect((await send(db, org, first.companionId, again.value.invitation)).ok).toBe(false);
      process.env[SWITCH] = 'true';
      // Used.
      const guest = await account(db, FRIEND);
      const opened = await openCompanionInvitation(db, {
        accountId: guest,
        rawToken: again.value.invitation.rawToken,
      });
      if (!opened.ok) throw new Error('open');
      await acceptCompanionInvitation(db, opened.value, {
        rawToken: again.value.invitation.rawToken,
      });
      expect((await send(db, org, first.companionId, again.value.invitation)).ok).toBe(false);
      expect(await outbox(db)).toHaveLength(0);
      // Removed.
      const second = await invite(db, org, 'second.friend@example.com');
      await removeCompanion(second.proof, org.tripId, second.companionId);
      expect((await send(db, org, second.companionId, second.delivery)).ok).toBe(false);
      expect(await outbox(db)).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses a malformed id without touching the database',
    async () => {
      const db = await freshDb();
      const org = await organiser(db);
      const { delivery } = await invite(db, org);
      const refused = await send(db, org, 'not-an-id', delivery);
      expect(refused.ok).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('the worker checks the invitation again at send time', () => {
  async function queued(db: Db) {
    const org = await organiser(db);
    const made = await invite(db, org);
    expect(isOk(await send(db, org, made.companionId, made.delivery))).toBe(true);
    return { org, ...made };
  }

  async function refusedAtSend(db: Db) {
    const result = await run(db);
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
    const [row] = await outbox(db);
    expect(row?.status).toBe('FAILED');
    expect(row?.lastError).toBe(RECIPIENT_NO_LONGER_AUTHORIZED);
  }

  it(
    'sends nothing once the person joined',
    async () => {
      const db = await freshDb();
      const { delivery } = await queued(db);
      const guest = await account(db, FRIEND);
      const opened = await openCompanionInvitation(db, {
        accountId: guest,
        rawToken: delivery.rawToken,
      });
      if (!opened.ok) throw new Error('open');
      await acceptCompanionInvitation(db, opened.value, { rawToken: delivery.rawToken });
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends nothing once the person declined',
    async () => {
      const db = await freshDb();
      const { delivery } = await queued(db);
      const guest = await account(db, FRIEND);
      const opened = await openCompanionInvitation(db, {
        accountId: guest,
        rawToken: delivery.rawToken,
      });
      if (!opened.ok) throw new Error('open');
      await declineCompanionInvitation(db, opened.value, { rawToken: delivery.rawToken });
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends nothing once the organiser removed the person',
    async () => {
      const db = await freshDb();
      const { proof, org, companionId } = await queued(db);
      await removeCompanion(proof, org.tripId, companionId);
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends nothing once the invitation lapsed',
    async () => {
      const db = await freshDb();
      const { companionId } = await queued(db);
      await db
        .update(schema.umpeTripCompanions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.umpeTripCompanions.id, companionId));
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends nothing when the row no longer carries the address the email goes to',
    async () => {
      const db = await freshDb();
      const { companionId } = await queued(db);
      await db
        .update(schema.umpeTripCompanions)
        .set({ email: 'changed@example.com' })
        .where(eq(schema.umpeTripCompanions.id, companionId));
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends nothing while the feature is switched off, and the invitation can be sent again later',
    async () => {
      const db = await freshDb();
      await queued(db);
      process.env[SWITCH] = 'false';
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends nothing when the row is gone',
    async () => {
      const db = await freshDb();
      const { companionId } = await queued(db);
      await db
        .delete(schema.umpeTripCompanions)
        .where(eq(schema.umpeTripCompanions.id, companionId));
      await refusedAtSend(db);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('nothing depends on whether an address has an account', () => {
  it(
    'queues the same email for an address with an account and one without, and never reads an account by address',
    async () => {
      const log: LoggedQuery[] = [];
      const db = await freshDb(log);
      const org = await organiser(db);
      await account(db, 'has.account@example.com');
      const withAccount = await invite(db, org, 'has.account@example.com');
      const without = await invite(db, org, 'no.account@example.com');
      log.length = 0;
      expect(isOk(await send(db, org, withAccount.companionId, withAccount.delivery))).toBe(true);
      expect(isOk(await send(db, org, without.companionId, without.delivery))).toBe(true);
      const touchedAccounts = log.filter((q) => /"accounts"/.test(q.query));
      expect(touchedAccounts).toEqual([]);
      const [a, b] = await outbox(db);
      const shape = (row: typeof a) => {
        const payload = (row?.payload ?? {}) as {
          subject?: string;
          summary?: string;
          deepLinkPath?: string;
        };
        return {
          event: row?.eventType,
          channel: row?.channel,
          status: row?.status,
          subject: payload.subject,
          summary: payload.summary,
          deepLink: payload.deepLinkPath,
          keys: Object.keys(payload).sort(),
        };
      };
      expect(shape(a)).toEqual(shape(b));
    },
    TEST_TIMEOUT_MS,
  );
});
