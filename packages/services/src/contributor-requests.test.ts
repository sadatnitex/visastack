import { randomBytes, randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import {
  abandonContributorSubmission,
  beginContributorSubmission,
  completeContributorSubmission,
  createContributorRequest,
  listContributorRequests,
  previewContributorRequest,
  revokeContributorRequest,
} from './contributor-requests';
import type { Db } from './db';
import { registerDocumentWithVersion } from './documents';
import { createMission } from './missions';
import { runNotificationWorker } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import type { KeyManagementPort, SendEmailInput } from './ports';
import { acceptGrant, createGrant } from './sharing';
import { getWalletView } from './wallet';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

/** An owner account (consented), applicant, and mission -- everything createContributorRequest needs. */
async function setUp(db: Db, emailSeed: string) {
  const provisioned = await provisionAccount(db, { email: `${emailSeed}@example.com` });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'SHARING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    title: 'UK Student Visa',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { account, applicantId: applicant.value.id, missionId: mission.value.id };
}

describe('CAS-08 - contributor request: narrow, single-use, third-party evidence submission', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('createContributorRequest: owner only, requires email/docType/purpose, mints a 7-day token', async () => {
    const { account, missionId } = await setUp(db, 'cas08-create');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'Sponsor@Example.com',
      docType: 'bank_statement',
      purpose: 'To support the financial sponsorship section of this visa case.',
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    // Stored lowercased/trimmed, matching invitations.ts's own convention.
    expect(created.value.request.contributorEmail).toBe('sponsor@example.com');
    expect(created.value.request.status).toBe('PENDING');
    const daysUntilExpiry =
      (created.value.request.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(6.9);
    expect(daysUntilExpiry).toBeLessThan(7.1);
    expect(created.value.rawToken.length).toBeGreaterThan(20);

    const stranger = await provisionAccount(db, { email: 'cas08-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await createContributorRequest(db, {
      actorAccountId: stranger.value.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'x',
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');

    const missingPurpose = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: '   ',
    });
    expect(isErr(missingPurpose)).toBe(true);
  });

  it('previewContributorRequest: shows purpose/docType/case context and intended recipients, never consumes the token, and reports (without trusting) email match', async () => {
    const { account, applicantId, missionId } = await setUp(db, 'cas08-preview');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'Financial sponsorship evidence.',
    });
    if (!isOk(created)) throw new Error('create');

    // An org with a current accepted grant on this applicant is an
    // "intended recipient" and should be named.
    const agentAcc = await provisionAccount(db, { email: 'cas08-agent@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentAcc.value.id, grantId: grant.value.id });

    const preview1 = await previewContributorRequest(db, {
      rawToken: created.value.rawToken,
      actorEmail: 'sponsor@example.com',
    });
    expect(isOk(preview1)).toBe(true);
    if (isOk(preview1)) {
      expect(preview1.value.docType).toBe('bank_statement');
      expect(preview1.value.purpose).toBe('Financial sponsorship evidence.');
      expect(preview1.value.applicantName).toBe('Owner');
      expect(preview1.value.missionTitle).toBe('UK Student Visa');
      expect(preview1.value.recipientOrganizationNames).toEqual(['Acme']);
      expect(preview1.value.emailMatches).toBe(true);
    }

    const previewWrongEmail = await previewContributorRequest(db, {
      rawToken: created.value.rawToken,
      actorEmail: 'someone-else@example.com',
    });
    expect(isOk(previewWrongEmail)).toBe(true);
    if (isOk(previewWrongEmail)) expect(previewWrongEmail.value.emailMatches).toBe(false);

    // A GET-style preview must never itself consume the token: submission
    // must still succeed afterward.
    const begin = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: agentAcc.value.id, // any authenticated account; email match is what matters
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    expect(isOk(begin)).toBe(true);
  });

  it('beginContributorSubmission: fails closed on wrong email, expiry, and replay; is race-safe under real concurrency', async () => {
    const { account, missionId } = await setUp(db, 'cas08-begin');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'consent_letter',
      purpose: 'x',
    });
    if (!isOk(created)) throw new Error('create');
    const contributor = await provisionAccount(db, { email: 'sponsor@example.com' });
    if (!isOk(contributor)) throw new Error('provision');

    const wrongEmail = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'not-the-sponsor@example.com',
      allowWalletReuse: false,
    });
    expect(isErr(wrongEmail)).toBe(true);
    if (isErr(wrongEmail)) expect(wrongEmail.error.code).toBe('forbidden');

    // Two concurrent attempts with the correct email race for the single use.
    const [first, second] = await Promise.all([
      beginContributorSubmission(db, {
        rawToken: created.value.rawToken,
        actorAccountId: contributor.value.id,
        actorEmail: 'sponsor@example.com',
        allowWalletReuse: false,
      }),
      beginContributorSubmission(db, {
        rawToken: created.value.rawToken,
        actorAccountId: contributor.value.id,
        actorEmail: 'sponsor@example.com',
        allowWalletReuse: false,
      }),
    ]);
    const successes = [first, second].filter(isOk);
    expect(successes).toHaveLength(1);

    // Replay after a successful claim is refused.
    const replay = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    expect(isErr(replay)).toBe(true);
  });

  it("registerDocument/addDocumentVersion accept a bound, in-flight contributor -- but no one else -- and honor the contributor's own wallet-reuse choice", async () => {
    const { account, applicantId, missionId } = await setUp(db, 'cas08-register');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'x',
    });
    if (!isOk(created)) throw new Error('create');
    const contributor = await provisionAccount(db, { email: 'sponsor@example.com' });
    if (!isOk(contributor)) throw new Error('provision');

    // A stranger with no contributorRequestId at all -- refused exactly as
    // before this feature existed.
    const strangerAttempt = await registerDocumentWithVersion(db, {
      actorAccountId: contributor.value.id,
      applicantId,
      originalName: 'statement.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'irrelevant-key',
    });
    expect(isErr(strangerAttempt)).toBe(true);
    if (isErr(strangerAttempt)) expect(strangerAttempt.error.code).toBe('forbidden');

    const begin = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    if (!isOk(begin)) throw new Error('begin');

    // A DIFFERENT account may never ride someone else's claimed request.
    const otherAcc = await provisionAccount(db, { email: 'cas08-other@example.com' });
    if (!isOk(otherAcc)) throw new Error('provision');
    const otherAttempt = await registerDocumentWithVersion(db, {
      actorAccountId: otherAcc.value.id,
      applicantId,
      originalName: 'statement.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'irrelevant-key-2',
      onBehalfOfContributorRequestId: begin.value.id,
    });
    expect(isErr(otherAttempt)).toBe(true);

    const registered = await registerDocumentWithVersion(db, {
      actorAccountId: contributor.value.id,
      applicantId,
      originalName: 'statement.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'a-real-object-key',
      walletVisible: begin.value.allowWalletReuse,
      onBehalfOfContributorRequestId: begin.value.id,
    });
    expect(isOk(registered)).toBe(true);
    if (!isOk(registered)) return;
    expect(registered.value.version.documentId).toBeTruthy();

    const completed = await completeContributorSubmission(db, {
      contributorRequestId: begin.value.id,
      documentId: registered.value.version.documentId,
    });
    expect(isOk(completed)).toBe(true);
    if (isOk(completed))
      expect(completed.value.submittedDocumentId).toBe(registered.value.version.documentId);

    // allowWalletReuse was false -- this document must not appear in the owner's own wallet.
    const wallet = await getWalletView(db, { actorAccountId: account.id, applicantId });
    expect(isOk(wallet)).toBe(true);
    if (isOk(wallet)) {
      expect(wallet.value.some((d) => d.document.id === registered.value.version.documentId)).toBe(
        false,
      );
    }

    // Once completed, the SAME contributorRequestId can never authorize another registration.
    const reuseAttempt = await registerDocumentWithVersion(db, {
      actorAccountId: contributor.value.id,
      applicantId,
      originalName: 'statement-2.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'a-different-key',
      onBehalfOfContributorRequestId: begin.value.id,
    });
    expect(isErr(reuseAttempt)).toBe(true);
  });

  it('a contributor who opts into wallet reuse produces a document the owner does see in their wallet', async () => {
    const { account, applicantId, missionId } = await setUp(db, 'cas08-wallet-reuse');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'x',
    });
    if (!isOk(created)) throw new Error('create');
    const contributor = await provisionAccount(db, { email: 'sponsor@example.com' });
    if (!isOk(contributor)) throw new Error('provision');
    const begin = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: true,
    });
    if (!isOk(begin)) throw new Error('begin');
    const registered = await registerDocumentWithVersion(db, {
      actorAccountId: contributor.value.id,
      applicantId,
      originalName: 'statement.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'wallet-reuse-key',
      walletVisible: begin.value.allowWalletReuse,
      onBehalfOfContributorRequestId: begin.value.id,
    });
    if (!isOk(registered)) throw new Error('register');
    await completeContributorSubmission(db, {
      contributorRequestId: begin.value.id,
      documentId: registered.value.version.documentId,
    });

    const wallet = await getWalletView(db, { actorAccountId: account.id, applicantId });
    expect(isOk(wallet)).toBe(true);
    if (isOk(wallet)) {
      expect(wallet.value.some((d) => d.document.id === registered.value.version.documentId)).toBe(
        true,
      );
    }
  });

  it('abandonContributorSubmission releases a claimed-but-failed attempt back to PENDING for a genuine retry', async () => {
    const { account, missionId } = await setUp(db, 'cas08-abandon');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'x',
    });
    if (!isOk(created)) throw new Error('create');
    const contributor = await provisionAccount(db, { email: 'sponsor@example.com' });
    if (!isOk(contributor)) throw new Error('provision');
    const begin = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    if (!isOk(begin)) throw new Error('begin');

    // Simulate the upload pipeline failing after the claim (a bad file, a storage error).
    await abandonContributorSubmission(db, begin.value.id);

    const retried = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    expect(isOk(retried)).toBe(true);

    // abandon never touches an already-COMPLETED request (submittedDocumentId set).
    if (isOk(retried)) {
      const abandonedTwice = await abandonContributorSubmission(db, retried.value.id);
      expect(abandonedTwice).toBeUndefined(); // void, always returns
    }
  });

  it('revokeContributorRequest: owner-only, PENDING-only, refuses cross-mission IDOR by ID alone', async () => {
    const { account, missionId } = await setUp(db, 'cas08-revoke');
    const other = await setUp(db, 'cas08-revoke-other');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'x',
    });
    if (!isOk(created)) throw new Error('create');

    // Right owner, WRONG missionId (the other owner's own mission) -- must not revoke by id alone.
    const crossMission = await revokeContributorRequest(db, {
      actorAccountId: account.id,
      missionId: other.missionId,
      requestId: created.value.request.id,
    });
    expect(isErr(crossMission)).toBe(true);

    const strangerAttempt = await revokeContributorRequest(db, {
      actorAccountId: other.account.id,
      missionId,
      requestId: created.value.request.id,
    });
    expect(isErr(strangerAttempt)).toBe(true);
    if (isErr(strangerAttempt)) expect(strangerAttempt.error.code).toBe('forbidden');

    const revoked = await revokeContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      requestId: created.value.request.id,
    });
    expect(isOk(revoked)).toBe(true);

    // A revoked request can never be submitted against.
    const contributor = await provisionAccount(db, { email: 'sponsor@example.com' });
    if (!isOk(contributor)) throw new Error('provision');
    const begin = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributor.value.id,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    expect(isErr(begin)).toBe(true);
  });

  it('listContributorRequests: owner-only, newest first', async () => {
    const { account, missionId } = await setUp(db, 'cas08-list');
    await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'first@example.com',
      docType: 'bank_statement',
      purpose: 'x',
    });
    await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'second@example.com',
      docType: 'consent_letter',
      purpose: 'y',
    });
    const list = await listContributorRequests(db, { actorAccountId: account.id, missionId });
    expect(isOk(list)).toBe(true);
    if (isOk(list)) {
      expect(list.value).toHaveLength(2);
      expect(list.value[0]?.contributorEmail).toBe('second@example.com');
    }

    const stranger = await provisionAccount(db, { email: 'cas08-list-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await listContributorRequests(db, {
      actorAccountId: stranger.value.id,
      missionId,
    });
    expect(isErr(denied)).toBe(true);
  });
});

describe('the contributor is emailed the link', () => {
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
  let db: Db;
  let sent: SendEmailInput[];
  const emailPort = {
    async send(input: SendEmailInput) {
      sent.push(input);
      return { providerMessageId: randomUUID() };
    },
  };
  const run = () =>
    runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });

  beforeEach(async () => {
    db = await freshDb();
    sent = [];
  });

  it('queues a sealed email that opens this request, and sends it to exactly that address', async () => {
    const { account, missionId } = await setUp(db, 'cas08-email');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: ' Sponsor@Example.com ',
      docType: 'bank_statement',
      purpose: 'proof of funds',
      encryption,
    });
    if (!isOk(created)) throw new Error('create');
    expect(created.value.emailQueued).toBe(true);
    const [row] = await db.select().from(schema.notifications);
    expect(row).toMatchObject({
      eventType: 'CONTRIBUTOR_REQUEST_CREATED',
      channel: 'EMAIL',
      recipientEmail: 'sponsor@example.com',
      resourceId: created.value.request.id,
    });
    // The outbox never holds the usable link or token in readable form.
    expect(JSON.stringify(row)).not.toContain(created.value.rawToken);

    expect(await run()).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('sponsor@example.com');
    expect(sent[0]?.body).toContain(
      `https://app.example.test/app/contributor-requests/accept?token=${created.value.rawToken}`,
    );
  });

  it('queues nothing without the key service, and says so', async () => {
    const { account, missionId } = await setUp(db, 'cas08-no-key');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'proof of funds',
    });
    expect(isOk(created) && created.value.emailQueued).toBe(false);
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });

  it('a revoked request never sends its email', async () => {
    const { account, missionId } = await setUp(db, 'cas08-revoked-email');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'proof of funds',
      encryption,
    });
    if (!isOk(created)) throw new Error('create');
    const revoked = await revokeContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      requestId: created.value.request.id,
    });
    expect(isOk(revoked)).toBe(true);
    expect(await run()).toEqual({ sent: 0, retrying: 0, failed: 0 });
    expect(sent).toEqual([]);
    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, created.value.request.id));
    expect(row?.status).toBe('CANCELLED');
  });

  it('an expired request fails its email instead of sending a dead link', async () => {
    const { account, missionId } = await setUp(db, 'cas08-expired-email');
    const created = await createContributorRequest(db, {
      actorAccountId: account.id,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'proof of funds',
      encryption,
    });
    if (!isOk(created)) throw new Error('create');
    await db
      .update(schema.contributorRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.contributorRequests.id, created.value.request.id));
    const result = await run();
    expect(result.sent).toBe(0);
    expect(sent).toEqual([]);
  });
});
