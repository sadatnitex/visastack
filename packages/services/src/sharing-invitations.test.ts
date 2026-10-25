import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocument } from './documents';
import { runNotificationWorker } from './notifications';
import type { KeyManagementPort } from './ports';
import {
  acceptSharingInvitation,
  createSharingInvitation,
  previewSharingInvitation,
  revokeSharingInvitation,
} from './sharing-invitations';

describe('personal sharing before registration', () => {
  let client: PGlite;
  let db: Db;
  let owner: string;
  let applicantId: string;
  const key = randomBytes(32);
  const encryption: KeyManagementPort = {
    currentKeyVersion: () => 'fixture-v1',
    generateDataKey: async () => ({
      keyVersion: 'fixture-v1',
      plaintextDataKey: key,
      wrappedDataKey: new Uint8Array([1]),
    }),
    unwrapDataKey: async () => key,
  };
  async function consent(id: string, granted = true) {
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const)
      await setConsent(db, { actorAccountId: id, accountId: id, type, granted });
  }
  async function recipient(email: string) {
    const account = await provisionAccount(db, { email });
    if (!account.ok) throw new Error('Fixture failed');
    await consent(account.value.id);
    return account.value.id;
  }
  const input = () => ({
    actorAccountId: owner,
    applicantId,
    email: `${randomUUID()}@example.test`,
    actions: ['VIEW_METADATA', 'PREVIEW'] as const,
    purpose: 'Synthetic review',
    encryption,
  });
  beforeAll(async () => {
    client = await createMigratedPglite();
    const handle = drizzle(client, { schema });
    db = handle as unknown as Db;
    const account = await provisionAccount(db, { email: 'sharing-owner@example.test' });
    if (!account.ok) throw new Error('Fixture failed');
    owner = account.value.id;
    await consent(owner);
    const person = await createApplicant(db, {
      actorAccountId: owner,
      ownerAccountId: owner,
      displayName: 'Synthetic Traveller',
    });
    if (!person.ok) throw new Error('Fixture failed');
    applicantId = person.value.id;
  });
  afterAll(async () => {
    await client.close();
  });

  it('stores only a token hash and encrypted outbox link, sends without an account and activates only once for the exact recipient', async () => {
    const request = input();
    const created = await createSharingInvitation(db, request);
    if (!created.ok) throw new Error('Invitation failed');
    const stored = await db
      .select()
      .from(schema.sharingInvitations)
      .where(eq(schema.sharingInvitations.id, created.value.invitation.id));
    const outbox = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, created.value.invitation.id));
    expect(JSON.stringify([...stored, ...outbox])).not.toContain(created.value.rawToken);
    expect(await db.select().from(schema.grants)).toHaveLength(0);
    const sent: { to: string; body: string }[] = [];
    await runNotificationWorker(
      db,
      {
        send: async (message) => {
          sent.push(message);
          return { providerMessageId: randomUUID() };
        },
      },
      'https://app.example.test',
      { encryption },
    );
    expect(
      sent.some(
        (mail) =>
          mail.to === request.email &&
          mail.body.includes(`kind=sharing&token=${created.value.rawToken}`),
      ),
    ).toBe(true);
    const wrong = await recipient(`wrong-${randomUUID()}@example.test`);
    expect(
      (
        await acceptSharingInvitation(db, {
          actorAccountId: wrong,
          rawToken: created.value.rawToken,
        })
      ).ok,
    ).toBe(false);
    const target = await recipient(request.email);
    const accepted = await acceptSharingInvitation(db, {
      actorAccountId: target,
      rawToken: created.value.rawToken,
    });
    expect(accepted.ok).toBe(true);
    expect(
      (
        await acceptSharingInvitation(db, {
          actorAccountId: target,
          rawToken: created.value.rawToken,
        })
      ).ok,
    ).toBe(false);
    const grant = (await db.select().from(schema.grants))[0];
    expect(grant?.recipientAccountId).toBe(target);
    expect(grant?.status).toBe('ACTIVE');
  });

  it('preserves the category snapshot taken before registration and does not silently include a later document', async () => {
    const first = await registerDocument(db, {
      actorAccountId: owner,
      applicantId,
      originalName: 'first.txt',
    });
    if (!first.ok) throw new Error('Fixture failed');
    await db
      .update(schema.documents)
      .set({ docType: 'PASSPORT' })
      .where(eq(schema.documents.id, first.value.id));
    const request = { ...input(), categories: ['universal'] };
    const created = await createSharingInvitation(db, request);
    if (!created.ok) throw new Error(created.error.message);
    const later = await registerDocument(db, {
      actorAccountId: owner,
      applicantId,
      originalName: 'later.txt',
    });
    if (!later.ok) throw new Error('Fixture failed');
    await db
      .update(schema.documents)
      .set({ docType: 'PASSPORT' })
      .where(eq(schema.documents.id, later.value.id));
    const target = await recipient(request.email);
    const accepted = await acceptSharingInvitation(db, {
      actorAccountId: target,
      rawToken: created.value.rawToken,
    });
    if (!accepted.ok) throw new Error(accepted.error.message);
    const grant = (
      await db.select().from(schema.grants).where(eq(schema.grants.id, accepted.value))
    )[0];
    expect(grant?.documentScopeSnapshot).toContain(first.value.id);
    expect(grant?.documentScopeSnapshot).not.toContain(later.value.id);
  });

  it('refuses revoked/expired links and suppresses their queued delivery', async () => {
    const created = await createSharingInvitation(db, input());
    if (!created.ok) throw new Error('Invitation failed');
    expect((await revokeSharingInvitation(db, owner, created.value.invitation.id)).ok).toBe(true);
    const target = await recipient(created.value.invitation.email);
    expect(
      (
        await previewSharingInvitation(db, {
          actorAccountId: target,
          rawToken: created.value.rawToken,
        })
      ).ok,
    ).toBe(false);
    const sent: string[] = [];
    await runNotificationWorker(
      db,
      {
        send: async ({ to }) => {
          sent.push(to);
          return {};
        },
      },
      'https://app.example.test',
      { encryption },
    );
    expect(sent).not.toContain(created.value.invitation.email);
    const expired = await createSharingInvitation(db, input());
    if (!expired.ok) throw new Error('Invitation failed');
    await db
      .update(schema.sharingInvitations)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.sharingInvitations.id, expired.value.invitation.id));
    const other = await recipient(expired.value.invitation.email);
    expect(
      (
        await acceptSharingInvitation(db, {
          actorAccountId: other,
          rawToken: expired.value.rawToken,
        })
      ).ok,
    ).toBe(false);
  });

  it('rechecks consent and rolls back a claimed invitation when the owner withdraws it', async () => {
    const created = await createSharingInvitation(db, input());
    if (!created.ok) throw new Error('Invitation failed');
    const target = await recipient(created.value.invitation.email);
    await consent(target, false);
    expect(
      (
        await acceptSharingInvitation(db, {
          actorAccountId: target,
          rawToken: created.value.rawToken,
        })
      ).ok,
    ).toBe(false);
    await consent(target);
    await consent(owner, false);
    expect(
      (
        await acceptSharingInvitation(db, {
          actorAccountId: target,
          rawToken: created.value.rawToken,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await db
          .select()
          .from(schema.sharingInvitations)
          .where(eq(schema.sharingInvitations.id, created.value.invitation.id))
      )[0]?.status,
    ).toBe('PENDING');
    await consent(owner);
  });

  it('refuses self-invitations, a foreign applicant, excessive expiry and unconfirmed sensitive permissions', async () => {
    expect(
      (await createSharingInvitation(db, { ...input(), email: 'sharing-owner@example.test' })).ok,
    ).toBe(false);
    const outsider = await recipient(`outsider-${randomUUID()}@example.test`);
    expect((await createSharingInvitation(db, { ...input(), actorAccountId: outsider })).ok).toBe(
      false,
    );
    expect(
      (
        await createSharingInvitation(db, {
          ...input(),
          expiryAt: new Date(Date.now() + 91 * 86400000),
        })
      ).ok,
    ).toBe(false);
    expect(
      (await createSharingInvitation(db, { ...input(), actions: ['DOWNLOAD_ORIGINAL'] })).ok,
    ).toBe(false);
    const created = await createSharingInvitation(db, input());
    if (!created.ok) throw new Error('Invitation failed');
    expect((await revokeSharingInvitation(db, outsider, created.value.invitation.id)).ok).toBe(
      false,
    );
  });
});
