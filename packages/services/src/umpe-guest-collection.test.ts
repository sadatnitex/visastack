import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agencyCollectionPrincipal, collectionLinkProof } from './access/collection-scope';
import {
  GuestCollectionSessionProof,
  guestCodeDeliveryProof,
  guestCollectionSessionProof,
} from './access/guest-collection';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { runNotificationWorker } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import type { KeyManagementPort, SendEmailInput } from './ports';
import {
  createCollectionLink,
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  issueCollectionRequest,
  openCollectionLink,
} from './umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from './umpe-collection-request-switch';
import {
  GUEST_SESSION_IDLE_MS,
  GUEST_SESSION_MAX_MS,
  endGuestSession,
  guestCodeStillDeliverable,
  readGuestDesk,
  saveGuestRetentionChoice,
  sendGuestCode,
  startGuestSession,
  verifyGuestCode,
} from './umpe-guest-collection';

/**
 * The guest desk of an agency document request (UMPE P8): a request-scoped session proved by a
 * one-time email code, never an account. Synthetic data only; every time is passed in, so nothing
 * here depends on the clock.
 */

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

const GUEST_EMAIL = 'guest@example.test';
const NET = 'net:00000000000000000000000000000001';
const CODE = '246810';

async function count(db: Db, table: string): Promise<number> {
  const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

function proofOf(raw: string | null): GuestCollectionSessionProof {
  const proof = guestCollectionSessionProof(raw);
  if (!proof) throw new Error('session proof');
  return proof;
}

describe('guest proof and the Document Collection Desk (UMPE P8)', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let t0: Date;
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const sent: SendEmailInput[] = [];
  const emailPort = {
    async send(message: SendEmailInput) {
      sent.push(message);
      return { providerMessageId: randomUUID() };
    },
  };
  const runWorker = () =>
    runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error('account');
    return result.value.id;
  }

  async function scope() {
    const minted = await agencyCollectionPrincipal(db, adminId, orgId);
    if (!minted.ok) throw new Error('scope');
    return minted.value;
  }

  /** An issued request with two of the agency's own items in one any-of group, and its raw link. */
  async function issuedLink(emailHint: string | null = GUEST_EMAIL, label = 'Passport') {
    const s = await scope();
    const created = await createCollectionRequest(db, s, {
      destination: 'GB',
      purpose: null,
      route: 'Synthetic Route',
      travelFrom: null,
      travelTo: null,
      dueAt: null,
      nationality: null,
      residence: null,
      applicationPlace: null,
      recipientNameHint: 'Synthetic Person',
      recipientEmailHint: emailHint,
      packTerms: null,
    });
    if (!created.ok) throw new Error(created.error.message);
    for (const item of [label, 'Bank Statement']) {
      const added = await editCollectionDraft(db, s, created.value.id, {
        type: 'add',
        label: item,
        necessity: item === label ? 'MANDATORY' : 'RECOMMENDED',
      });
      if (!added.ok) throw new Error(added.error.message);
    }
    const issued = await issueCollectionRequest(db, s, created.value.id);
    if (!issued.ok) throw new Error(issued.error.message);
    if (emailHint === null) return { requestId: created.value.id, ...issued.value.link };
    // Only an emailed link carries the address the agency entered for it.
    const emailed = await createCollectionLink(db, s, created.value.id, {
      email: { address: emailHint, encryption },
    });
    if (!emailed.ok) throw new Error(emailed.error.message);
    await runWorker();
    sent.length = 0;
    return { requestId: created.value.id, ...emailed.value.link };
  }

  async function open(rawToken: string, now = t0) {
    const link = collectionLinkProof(rawToken);
    if (!link) throw new Error('link proof');
    const started = await startGuestSession(db, link, null, now);
    if (!started?.rawSessionId) throw new Error('no session');
    return started.rawSessionId;
  }

  async function verified(rawToken: string, now = t0) {
    const raw = await open(rawToken, now);
    const code = await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      now,
    );
    if (!code.ok) throw new Error(`send ${JSON.stringify(code.error)}`);
    const result = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: CODE, networkSubject: NET },
      now,
    );
    if (!result.ok) throw new Error('verify');
    return { before: raw, after: result.value.rawSessionId };
  }

  beforeEach(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    sent.length = 0;
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    adminId = await account('admin@agency-one.example.test');
    const org = await createOrganization(db, {
      actorAccountId: adminId,
      name: 'Synthetic Agency One',
    });
    if (!isOk(org)) throw new Error('org');
    orgId = org.value.id;
    const reviewer = await account('reviewer@platform.example.test');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: orgId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
    t0 = new Date();
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  it('proves the guest by an emailed code and shows the exact checklist, creating no account or applicant', async () => {
    const link = await issuedLink();
    const accountsBefore = await count(db, 'accounts');
    const raw = await open(link.rawToken);
    expect(raw).not.toBe(link.rawToken);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const landing = await readGuestDesk(db, proofOf(raw), t0);
    expect(landing).toEqual({
      stage: 'landing',
      agency: { name: 'Synthetic Agency One', accentColor: null, hasLogo: false },
      guestAvailable: true,
      codePending: false,
    });

    const code = await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      t0,
    );
    expect(code.ok).toBe(true);
    expect((await readGuestDesk(db, proofOf(raw), t0))?.stage).toBe('landing');
    // Only a salted hash is stored, and the outbox holds only ciphertext.
    const stored = JSON.stringify(await db.select().from(schema.agencyCollectionGuestCodes));
    const queued = JSON.stringify(await db.select().from(schema.notifications));
    expect(stored).not.toContain(CODE);
    expect(queued).not.toContain(CODE);

    expect((await runWorker()).sent).toBe(1);
    const message = sent[0];
    expect(message?.to).toBe(GUEST_EMAIL);
    expect(message?.body).toContain(CODE);
    expect(message?.html).toContain(CODE);
    for (const secret of ['Synthetic Person', 'Synthetic Route', 'Passport', link.rawToken, raw]) {
      expect(`${message?.subject} ${message?.body}`).not.toContain(secret);
    }

    const wrong = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: '000000', networkSubject: NET },
      t0,
    );
    expect(!wrong.ok && 'code' in wrong.error && wrong.error.code).toBe('wrong');
    const right = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: '246 810', networkSubject: NET },
      t0,
    );
    if (!right.ok) throw new Error('verify');
    // Rotated: the id held before the proof no longer opens anything.
    expect(right.value.rawSessionId).not.toBe(raw);
    expect(await readGuestDesk(db, proofOf(raw), t0)).toBeNull();

    const desk = await readGuestDesk(db, proofOf(right.value.rawSessionId), t0);
    if (desk?.stage !== 'verified') throw new Error('not verified');
    expect(desk.intact).toBe(true);
    expect(desk.retentionDays).toBeNull();
    expect(desk.items.map((item) => [item.label, item.necessity, item.provenance])).toEqual([
      ['Passport', 'MANDATORY', 'AGENCY_ADDED'],
      ['Bank Statement', 'RECOMMENDED', 'AGENCY_ADDED'],
    ]);

    expect(await count(db, 'accounts')).toBe(accountsBefore);
    expect(await count(db, 'applicants')).toBe(0);
    expect(await count(db, 'missions')).toBe(0);
  });

  it('stores the retention choice on the pending submission, with no preselected value and only the offered periods', async () => {
    const link = await issuedLink();
    const { after } = await verified(link.rawToken);
    const [draft] = await db.select().from(schema.agencyCollectionGuestDrafts);
    expect(draft?.retentionDays).toBeNull();
    for (const bad of [0, 10, 365, '30', null]) {
      expect((await saveGuestRetentionChoice(db, proofOf(after), bad, t0)).ok).toBe(false);
    }
    expect((await saveGuestRetentionChoice(db, proofOf(after), 30, t0)).ok).toBe(true);
    const desk = await readGuestDesk(db, proofOf(after), t0);
    expect(desk?.stage === 'verified' && desk.retentionDays).toBe(30);
    // The database refuses any other period too.
    await expect(
      db
        .update(schema.agencyCollectionGuestDrafts)
        .set({ retentionDays: 45 })
        .where(eq(schema.agencyCollectionGuestDrafts.linkId, link.id)),
    ).rejects.toThrow();
  });

  it('an unverified session cannot save a choice or read the checklist', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    expect((await saveGuestRetentionChoice(db, proofOf(raw), 30, t0)).ok).toBe(false);
    expect((await readGuestDesk(db, proofOf(raw), t0))?.stage).toBe('landing');
  });

  it('refuses expired and replayed codes, and replaced ones', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    const send = (code: string, now: Date) =>
      sendGuestCode(
        db,
        proofOf(raw),
        { encryption, networkSubject: NET, generateCode: () => code },
        now,
      );
    await send('111111', t0);
    // Eleven minutes later the code has expired.
    const late = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: '111111', networkSubject: NET },
      at(11 * 60 * 1000),
    );
    expect(!late.ok && 'code' in late.error && late.error.code).toBe('expired');
    // A newer code replaces the older one.
    await send('222222', at(60_000));
    await send('333333', at(120_000));
    const replaced = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: '222222', networkSubject: NET },
      at(120_000),
    );
    expect(replaced.ok).toBe(false);
    const ok = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: '333333', networkSubject: NET },
      at(120_000),
    );
    if (!ok.ok) throw new Error('verify');
    // Replayed: the same code on another device's session is refused.
    const other = await open(link.rawToken, at(130_000));
    const replay = await verifyGuestCode(
      db,
      proofOf(other),
      { code: '333333', networkSubject: NET },
      at(130_000),
    );
    expect(replay.ok).toBe(false);
    expect((await readGuestDesk(db, proofOf(other), at(130_000)))?.stage).toBe('landing');
  });

  it('ends a code after five wrong tries', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      t0,
    );
    const refusals: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await verifyGuestCode(
        db,
        proofOf(raw),
        { code: `00000${i}`, networkSubject: NET },
        t0,
      );
      if (!result.ok && 'code' in result.error) refusals.push(result.error.code);
    }
    expect(refusals).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'expired']);
    const right = await verifyGuestCode(db, proofOf(raw), { code: CODE, networkSubject: NET }, t0);
    expect(right.ok).toBe(false);
    const [row] = await db.select().from(schema.agencyCollectionGuestCodes);
    expect(row?.attempts).toBe(5);
    expect(row?.consumedAt).not.toBeNull();
  });

  it('limits code sends per link', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    const results: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      const result = await sendGuestCode(
        db,
        proofOf(raw),
        { encryption, networkSubject: `net:${i}`, generateCode: () => CODE },
        t0,
      );
      results.push(result.ok);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("another link's session cannot read this request, and a code from one session does not prove another", async () => {
    const mine = await issuedLink(GUEST_EMAIL, 'Passport');
    const theirs = await issuedLink('other@example.test', 'Birth Certificate');
    const a = await verified(mine.rawToken);
    const b = await open(theirs.rawToken);
    const deskA = await readGuestDesk(db, proofOf(a.after), t0);
    expect(deskA?.stage === 'verified' && deskA.items.map((item) => item.label)).toEqual([
      'Passport',
      'Bank Statement',
    ]);
    expect((await readGuestDesk(db, proofOf(b), t0))?.stage).toBe('landing');
    // A session moved onto another link no longer matches that link's request and revision.
    await db
      .update(schema.agencyCollectionGuestSessions)
      .set({ linkId: theirs.id })
      .where(eq(schema.agencyCollectionGuestSessions.sessionHash, proofOf(a.after).sessionHash));
    expect(await readGuestDesk(db, proofOf(a.after), t0)).toBeNull();
    // A's code proves nothing for B.
    const cross = await verifyGuestCode(db, proofOf(b), { code: CODE, networkSubject: NET }, t0);
    expect(cross.ok).toBe(false);
  });

  it('a forwarded link alone shows only the neutral landing, even while the recipient is verified elsewhere', async () => {
    const link = await issuedLink();
    await verified(link.rawToken);
    const forwarded = await open(link.rawToken);
    const desk = await readGuestDesk(db, proofOf(forwarded), t0);
    expect(desk?.stage).toBe('landing');
    expect(JSON.stringify(desk)).not.toContain('Passport');
    expect(JSON.stringify(desk)).not.toContain(GUEST_EMAIL);
  });

  it('opening the link again on the same device keeps the session', async () => {
    const link = await issuedLink();
    const { after } = await verified(link.rawToken);
    const again = await startGuestSession(
      db,
      collectionLinkProof(link.rawToken) as never,
      proofOf(after),
      t0,
    );
    expect(again).toEqual({ rawSessionId: null });
    expect((await readGuestDesk(db, proofOf(after), t0))?.stage).toBe('verified');
  });

  it('revoking or reissuing ends the session at once', async () => {
    const revoked = await issuedLink();
    const r = await verified(revoked.rawToken);
    const ended = await endCollectionRequest(db, await scope(), revoked.requestId, 'REVOKED');
    expect(ended.ok).toBe(true);
    expect(await readGuestDesk(db, proofOf(r.after), t0)).toBeNull();

    const reissued = await issuedLink();
    const s = await verified(reissued.rawToken);
    const again = await issueCollectionRequest(db, await scope(), reissued.requestId);
    expect(again.ok).toBe(true);
    expect(await readGuestDesk(db, proofOf(s.after), t0)).toBeNull();
  });

  it('expires after 30 idle minutes and after 12 hours whatever happens; the guest can also leave', async () => {
    const link = await issuedLink();
    const { after } = await verified(link.rawToken);
    expect(await readGuestDesk(db, proofOf(after), at(GUEST_SESSION_IDLE_MS + 1))).toBeNull();

    const second = await verified(link.rawToken, at(60_000));
    // Kept busy every 20 minutes, it still ends at 12 hours.
    let alive = true;
    for (let ms = 20 * 60_000; ms < GUEST_SESSION_MAX_MS; ms += 20 * 60_000) {
      alive = alive && (await readGuestDesk(db, proofOf(second.after), at(ms))) !== null;
    }
    expect(alive).toBe(true);
    expect(
      await readGuestDesk(db, proofOf(second.after), at(GUEST_SESSION_MAX_MS + 60_000)),
    ).toBeNull();

    const third = await verified(link.rawToken, at(GUEST_SESSION_MAX_MS));
    const leaveAt = at(GUEST_SESSION_MAX_MS + 1_000);
    expect(await endGuestSession(db, proofOf(third.after), leaveAt)).toBe(true);
    expect(await readGuestDesk(db, proofOf(third.after), leaveAt)).toBeNull();
  }, 60_000);

  it('suppresses a queued code email at send time once the link is revoked', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    const code = await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      t0,
    );
    if (!code.ok || !('codeId' in code.value)) throw new Error('send');
    // Closed without cancelling the queued email, so only the send-time check stands in the way.
    await db
      .update(schema.agencyCollectionLinks)
      .set({ revokedAt: new Date() })
      .where(eq(schema.agencyCollectionLinks.id, link.id));
    expect((await runWorker()).sent).toBe(0);
    expect(sent).toEqual([]);
    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, code.value.codeId));
    expect(row?.status).toBe('FAILED');
  });

  it('cancels the email of a replaced code, and a forged delivery proof sends nothing', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    const first = await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => '111111' },
      t0,
    );
    await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      t0,
    );
    expect((await runWorker()).sent).toBe(1);
    expect(sent[0]?.body).toContain(CODE);
    if (!first.ok || !('codeId' in first.value)) throw new Error('send');
    const forged = guestCodeDeliveryProof(first.value.codeId, '999999');
    expect(forged && (await guestCodeStillDeliverable(db, forged))).toBe(false);
  });

  it('a link without an email address has no guest path', async () => {
    const link = await issuedLink(null);
    const raw = await open(link.rawToken);
    const desk = await readGuestDesk(db, proofOf(raw), t0);
    expect(desk?.stage === 'landing' && desk.guestAvailable).toBe(false);
    const send = await sendGuestCode(db, proofOf(raw), { encryption, networkSubject: NET }, t0);
    expect(send.ok).toBe(false);
    expect(await count(db, 'agency_collection_guest_codes')).toBe(0);
  });

  it('with the switch off nothing opens, including a session made earlier', async () => {
    const link = await issuedLink();
    const { after } = await verified(link.rawToken);
    const earlier = proofOf(after);
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, '');
    expect(guestCollectionSessionProof(after)).toBeNull();
    expect(await readGuestDesk(db, earlier, t0)).toBeNull();
    expect(await openCollectionLink(db, collectionLinkProof(link.rawToken) as never)).toBeNull();
  });

  it('a copied proof object is refused', async () => {
    const link = await issuedLink();
    const raw = await open(link.rawToken);
    const copy = { ...proofOf(raw) } as unknown as GuestCollectionSessionProof;
    expect(GuestCollectionSessionProof.isGenuine(copy)).toBe(false);
    expect(await readGuestDesk(db, copy, t0)).toBeNull();
  });
});
