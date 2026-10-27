import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  RATE_LIMITS,
  createClientInvitation,
  createOrganization,
  provisionAccount,
  reviewOrganization,
  revokeClientInvitation,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashedSubject } from './client-address';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  address: '203.0.113.9',
  down: false,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': state.address }),
}));
vi.mock('./public-db', () => ({
  withPublicDb: async (work: (db: unknown) => unknown) => {
    if (state.down) throw new Error('database not configured');
    return work(state.db);
  },
}));
vi.mock('./storage', () => ({
  createStorage: () => ({
    getObject: async () => ({ bytes: new Uint8Array([137, 80, 78, 71]) }),
  }),
}));

const { loadClientInvitationPage, loadInvitationLogo } = await import('./invitation-preview');

const UNKNOWN = 'N'.repeat(43);
let db: Db;
let adminId: string;
let orgId: string;

async function newAccount(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error('provision failed');
  return made.value.id;
}

async function open(email: string) {
  const sent = await createClientInvitation(db, {
    actorAccountId: adminId,
    organizationId: orgId,
    caseOwnerAccountId: adminId,
    displayName: 'Jane Traveller',
    contactDestination: email,
  });
  if (!sent.ok) throw new Error('invite failed');
  return sent.value;
}

beforeAll(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  adminId = await newAccount('admin@agency.example');
  const org = await createOrganization(db, { actorAccountId: adminId, name: 'Acme Visas' });
  if (!org.ok) throw new Error('org failed');
  orgId = org.value.id;
  const reviewer = await newAccount('reviewer@platform.example');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId: orgId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!reviewed.ok) throw new Error('review failed');
  await db
    .update(schema.organizations)
    .set({ logoObjectKey: 'branding/org/logo-abc.png', logoContentType: 'image/png' })
    .where(eq(schema.organizations.id, orgId));
});

beforeEach(() => {
  state.down = false;
  // A fresh visitor each time, so one test's counting never reaches another's.
  state.address = `198.51.100.${Math.floor(Math.random() * 250) + 1}-${Math.random()}`;
});

describe('the public invitation page lookup', () => {
  it('opens a live invitation, and says "closed" in the same way for every other token', async () => {
    const live = await open('live@example.com');
    const opened = await loadClientInvitationPage(live.rawToken);
    expect(opened).toMatchObject({ state: 'open', view: { agencyName: 'Acme Visas' } });

    const expired = await open('expired@example.com');
    await db
      .update(schema.clientInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.clientInvitations.id, expired.invitation.id));
    const revoked = await open('revoked@example.com');
    await revokeClientInvitation(db, {
      actorAccountId: adminId,
      organizationId: orgId,
      invitationId: revoked.invitation.id,
    });
    const closed = await Promise.all(
      [UNKNOWN, expired.rawToken, revoked.rawToken].map((t) => loadClientInvitationPage(t)),
    );
    expect(closed).toEqual([{ state: 'closed' }, { state: 'closed' }, { state: 'closed' }]);
  });

  it('counts every look against the visitor address, then answers "busy" and reads nothing more', async () => {
    const live = await open('busy@example.com');
    const subject = hashedSubject('net', state.address);
    await db.insert(schema.rateLimitBuckets).values(
      [0, 1].map((step) => ({
        subjectId: subject,
        action: 'invitation.preview_ip',
        windowStart: new Date(
          (Math.floor(Date.now() / RATE_LIMITS.INVITATION_PREVIEW_IP.windowMs) + step) *
            RATE_LIMITS.INVITATION_PREVIEW_IP.windowMs,
        ),
        count: RATE_LIMITS.INVITATION_PREVIEW_IP.limit,
      })),
    );
    // Busy for a real token and for a made-up one alike: the limit says nothing about either.
    expect(await loadClientInvitationPage(live.rawToken)).toEqual({ state: 'busy' });
    expect(await loadClientInvitationPage(UNKNOWN)).toEqual({ state: 'busy' });
    // Another visitor is not affected.
    state.address = '192.0.2.77';
    expect((await loadClientInvitationPage(live.rawToken)).state).toBe('open');
  });

  it('stops after the allowed number of looks from one address', async () => {
    const limit = RATE_LIMITS.INVITATION_PREVIEW_IP.limit;
    let last = 'open';
    for (let i = 0; i < limit + 1; i += 1) {
      last = (await loadClientInvitationPage(UNKNOWN)).state;
    }
    expect(last).toBe('busy');
  }, 60_000);

  it('keeps only a short hash of the address, never the address', async () => {
    await loadClientInvitationPage(UNKNOWN);
    const rows = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.action, 'invitation.preview_ip'));
    const stored = rows.map((r) => r.subjectId);
    expect(stored).toContain(hashedSubject('net', state.address));
    for (const subject of stored) expect(subject).toMatch(/^net:[0-9a-f]{32}$/);
  });

  it('falls back (unavailable) rather than failing when the lookup cannot be made', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.down = true;
    expect(await loadClientInvitationPage(UNKNOWN)).toEqual({ state: 'unavailable' });
    log.mockRestore();
  });
});

describe('the public invitation logo lookup', () => {
  it('serves the picture for a live invitation from a reviewed agency, and nothing for the rest', async () => {
    const live = await open('logo@example.com');
    const found = await loadInvitationLogo(live.rawToken);
    expect(found).toMatchObject({ state: 'found', contentType: 'image/png' });
    expect(await loadInvitationLogo(UNKNOWN)).toEqual({ state: 'none' });
  });

  it('is limited per address, with its own counter', async () => {
    const live = await open('logo-busy@example.com');
    const subject = hashedSubject('net', state.address);
    await db.insert(schema.rateLimitBuckets).values(
      [0, 1].map((step) => ({
        subjectId: subject,
        action: 'invitation.logo_ip',
        windowStart: new Date(
          (Math.floor(Date.now() / RATE_LIMITS.INVITATION_LOGO_IP.windowMs) + step) *
            RATE_LIMITS.INVITATION_LOGO_IP.windowMs,
        ),
        count: RATE_LIMITS.INVITATION_LOGO_IP.limit,
      })),
    );
    expect(await loadInvitationLogo(live.rawToken)).toEqual({ state: 'busy' });
    // The page counter is separate, so the page itself still opens.
    expect((await loadClientInvitationPage(live.rawToken)).state).toBe('open');
  });
});
