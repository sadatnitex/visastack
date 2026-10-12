import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createClientInvitation, revokeClientInvitation } from './client-invitations';
import type { Db } from './db';
import {
  acceptOrganizationInvitation,
  addMemberByEmail,
  createOrganizationInvitation,
  revokeOrganizationInvitation,
} from './invitations';
import { type NotificationPayload, runNotificationWorker } from './notifications';
import { createOrganization } from './organizations';
import type { KeyManagementPort, SendEmailInput } from './ports';

// Test-only wrapped-key registry, separate from the database under test. No external email.
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

describe('invitation delivery before registration', () => {
  const client = new PGlite();
  let db: Db;
  let owner: string;
  let org: string;
  const sent: SendEmailInput[] = [];
  const emailPort = {
    async send(input: SendEmailInput) {
      sent.push(input);
      return { providerMessageId: randomUUID() };
    },
  };
  const input = (email = `${randomUUID()}@example.test`) => ({
    actorAccountId: owner,
    organizationId: org,
    role: 'REVIEWER' as const,
    email,
    encryption,
  });
  const run = () =>
    runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });
  beforeAll(async () => {
    const handle = drizzle(client, { schema });
    await migrate(handle, {
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    db = handle as unknown as Db;
    const account = await provisionAccount(db, { email: 'owner@example.test' });
    if (!account.ok) throw new Error('Account setup failed');
    owner = account.value.id;
    const organization = await createOrganization(db, {
      actorAccountId: owner,
      name: 'Synthetic Agency',
    });
    if (!organization.ok) throw new Error('Agency setup failed');
    org = organization.value.id;
  });
  beforeEach(async () => {
    sent.length = 0;
    await db.delete(schema.notifications);
  });
  afterAll(async () => {
    await client.close();
    keys.clear();
  });

  it('queues and sends a team invitation without an account, storing no plaintext token, then checks recipient and single use', async () => {
    const details = input();
    const invite = await addMemberByEmail(db, details);
    if (!invite.ok || invite.value.kind !== 'invited') throw new Error('Expected invitation');
    const stored = await db.select().from(schema.notifications);
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(invite.value.rawToken);
    expect((await run()).sent).toBe(1);
    expect(sent[0]?.to).toBe(details.email);
    expect(sent[0]?.body).toContain(`/invitation?kind=team&token=${invite.value.rawToken}`);
    const wrong = await acceptOrganizationInvitation(db, {
      actorAccountId: owner,
      actorEmail: 'owner@example.test',
      rawToken: invite.value.rawToken,
    });
    expect(wrong.ok).toBe(false);
    const recipient = await provisionAccount(db, { email: details.email });
    if (!recipient.ok) throw new Error('Recipient setup failed');
    const acceptance = {
      actorAccountId: recipient.value.id,
      actorEmail: details.email,
      rawToken: invite.value.rawToken,
    };
    expect((await acceptOrganizationInvitation(db, acceptance)).ok).toBe(true);
    expect((await acceptOrganizationInvitation(db, acceptance)).ok).toBe(false);
  });

  it('sends client instructions without looking up or creating the invited account', async () => {
    const email = `${randomUUID()}@example.test`;
    const invite = await createClientInvitation(db, {
      actorAccountId: owner,
      organizationId: org,
      caseOwnerAccountId: owner,
      displayName: 'Synthetic traveller',
      contactDestination: email,
      encryption,
    });
    if (!invite.ok) throw new Error('Expected client invitation');
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.email, email)),
    ).toHaveLength(0);
    expect((await run()).sent).toBe(1);
    expect(sent[0]?.to).toBe(email);
    expect(sent[0]?.body).toContain(`/invitation?kind=client&token=${invite.value.rawToken}`);
    expect(sent[0]?.body).toContain('confirm sharing');
  });

  it('drops queued revoked, expired and superseded team links at dispatch', async () => {
    const details = input();
    const stale = await createOrganizationInvitation(db, details);
    const replacement = await createOrganizationInvitation(db, details);
    const expired = await createOrganizationInvitation(db, input());
    if (!stale.ok || !replacement.ok || !expired.ok) throw new Error('Expected invitations');
    await revokeOrganizationInvitation(db, {
      actorAccountId: owner,
      organizationId: org,
      invitationId: replacement.value.invitation.id,
    });
    await db
      .update(schema.organizationInvitations)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.organizationInvitations.id, expired.value.invitation.id));
    expect((await run()).failed).toBe(3);
    expect(sent).toHaveLength(0);
  });

  it('drops revoked client email and never sends email to a phone number', async () => {
    const details = {
      actorAccountId: owner,
      organizationId: org,
      caseOwnerAccountId: owner,
      displayName: 'Synthetic traveller',
      encryption,
    };
    const invite = await createClientInvitation(db, {
      ...details,
      contactDestination: `${randomUUID()}@example.test`,
    });
    if (!invite.ok) throw new Error('Expected invitation');
    await revokeClientInvitation(db, {
      actorAccountId: owner,
      organizationId: org,
      invitationId: invite.value.invitation.id,
    });
    expect(
      (await createClientInvitation(db, { ...details, contactDestination: '+1555010100' })).ok,
    ).toBe(true);
    expect((await run()).failed).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('refuses ciphertext swapped between invitations and does not expose secrets in failure details', async () => {
    await createOrganizationInvitation(db, input());
    await createOrganizationInvitation(db, input());
    const rows = await db.select().from(schema.notifications);
    const first = rows[0];
    const second = rows[1];
    if (!first || !second) throw new Error('Missing queue');
    const payload = second.payload as NotificationPayload;
    await db
      .update(schema.notifications)
      .set({
        payload: {
          ...(first.payload as NotificationPayload),
          sealedInvitationLink: payload.sealedInvitationLink,
        },
      })
      .where(eq(schema.notifications.id, first.id));
    const result = await run();
    expect(result.sent).toBe(1);
    expect(result.retrying).toBe(1);
    const failures = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, first.id));
    expect(failures[0]?.lastError).not.toContain('cipher');
  });

  it('notifies an existing member through email and in-app channels', async () => {
    const details = input();
    await provisionAccount(db, { email: details.email });
    const result = await addMemberByEmail(db, details);
    expect(result.ok && result.value.kind).toBe('added');
    expect(await db.select().from(schema.notifications)).toHaveLength(2);
    expect((await run()).sent).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(details.email);
  });
});
