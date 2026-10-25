import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { type Result, isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import {
  beginContributorSubmission,
  completeContributorSubmission,
  createContributorRequest,
} from '../contributor-requests';
import type { Db } from '../db';
import { registerDocument } from '../documents';
import type { ServiceError } from '../errors';
import { createMission } from '../missions';
import {
  addMembership,
  createOrganization,
  reviewOrganization,
  setMembershipActive,
  suspendOrganization,
} from '../organizations';
import { acceptGrant, createGrant, pauseGrant } from '../sharing';
import { issueStepUpAssurance } from '../step-up';
import { SUPPORT_ACCESS_PURPOSE, createSupportGrant } from '../support-access';
import { StaffScope, accountPrincipal, staffPrincipal, systemPrincipal } from './principal';
import {
  AuthorizedApplicant,
  EACH_GRANT,
  isRestrictedDocumentType,
  requireAccess,
} from './require-access';
import { StepUpProof, verifyStepUp } from './step-up-proof';

const STEP_UP_SECRET = 'test-step-up-secret';

function stepUpFor(accountId: string, action: string, resourceId: string): StepUpProof {
  const token = issueStepUpAssurance(STEP_UP_SECRET, { accountId, action, resourceId });
  const proof = verifyStepUp(STEP_UP_SECRET, token, {
    accountId,
    action: action as never,
    resourceId,
  });
  if (!proof) throw new Error('step-up proof');
  return proof;
}

afterEach(() => {
  vi.useRealTimers();
});

const migrationsFolder = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error(`provision ${email}`);
  return result.value.id;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewerId = await account(db, `reviewer-${organizationId}@platform.example.com`);
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewerId,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

function errorCode<T>(result: Result<T, ServiceError>): string | undefined {
  return isErr(result) ? result.error.code : undefined;
}

describe('requireAccess - central applicant authorization gate', () => {
  let db: Db;
  let ownerId: string;
  let applicantId: string;
  let missionId: string;
  let documentId: string;

  beforeEach(async () => {
    db = await freshDb();
    ownerId = await account(db, 'owner@example.com');
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Owner',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    const mission = await createMission(db, { actorAccountId: ownerId, applicantId, title: 'M' });
    if (!isOk(mission)) throw new Error('mission');
    missionId = mission.value.id;
    const document = await registerDocument(db, {
      actorAccountId: ownerId,
      applicantId,
      originalName: 'certificate.pdf',
      // An everyday document: an unclassified or identity one needs a step-up to preview.
      docType: 'EMPLOYMENT_CERTIFICATE',
    });
    if (!isOk(document)) throw new Error('document');
    documentId = document.value.id;
  });

  async function orgWithGrant(input: {
    readonly actions: readonly ('VIEW_METADATA' | 'PREVIEW' | 'MANAGE')[];
    readonly purpose?: string;
    readonly accept?: boolean;
  }): Promise<{ agentId: string; organizationId: string; grantId: string }> {
    const agentId = await account(db, `agent-${randomUUID()}@acme.example.com`);
    const org = await createOrganization(db, { actorAccountId: agentId, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: input.actions,
      purpose: input.purpose ?? 'visa-review',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    if (input.accept !== false) {
      const accepted = await acceptGrant(db, { actorAccountId: agentId, grantId: grant.value.id });
      if (!isOk(accepted)) throw new Error('accept');
    }
    return { agentId, organizationId: org.value.id, grantId: grant.value.id };
  }

  it('allows the owner on the applicant, a case and a document, and carries the context', async () => {
    const owner = accountPrincipal(ownerId);
    for (const ref of [{ applicantId }, { missionId }, { documentId }]) {
      const result = await requireAccess(db, owner, 'MANAGE', ref, { purpose: 'self' });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.applicant.id).toBe(applicantId);
      expect(result.value.actor).toEqual({ kind: 'applicant_owner', applicantId });
      expect(result.value.action).toBe('MANAGE');
      expect(result.value.tx).toBe(db);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
    const doc = await requireAccess(db, owner, 'PREVIEW', { documentId }, { purpose: 'self' });
    if (!isOk(doc)) throw new Error('doc');
    expect(doc.value.resource.kind).toBe('document');
  });

  it('still applies step-up to the owner for DOWNLOAD_ORIGINAL', async () => {
    const owner = accountPrincipal(ownerId);
    const without = await requireAccess(
      db,
      owner,
      'DOWNLOAD_ORIGINAL',
      { documentId },
      { purpose: 'self' },
    );
    expect(errorCode(without)).toBe('step_up_required');
    const withStepUp = await requireAccess(
      db,
      owner,
      'DOWNLOAD_ORIGINAL',
      { documentId },
      { purpose: 'self', stepUp: stepUpFor(ownerId, 'DOWNLOAD_ORIGINAL', documentId) },
    );
    expect(isOk(withStepUp)).toBe(true);
  });

  it('accepts a step-up only for the same account, action and record, and never a copy', async () => {
    const owner = accountPrincipal(ownerId);
    const download = (stepUp: StepUpProof) =>
      requireAccess(db, owner, 'DOWNLOAD_ORIGINAL', { documentId }, { purpose: 'self', stepUp });
    const otherId = await account(db, 'other-step-up@example.com');
    for (const wrong of [
      stepUpFor(otherId, 'DOWNLOAD_ORIGINAL', documentId),
      stepUpFor(ownerId, 'SHARE', documentId),
      stepUpFor(ownerId, 'DOWNLOAD_ORIGINAL', applicantId),
    ]) {
      expect(errorCode(await download(wrong))).toBe('step_up_required');
    }
    const genuine = stepUpFor(ownerId, 'DOWNLOAD_ORIGINAL', documentId);
    const copy = { ...genuine } as unknown as StepUpProof;
    expect(StepUpProof.isGenuine(copy)).toBe(false);
    expect(errorCode(await download(copy))).toBe('step_up_required');
    // A token signed with another secret, or an empty secret, never becomes a proof.
    const token = issueStepUpAssurance('another-secret', {
      accountId: ownerId,
      action: 'DOWNLOAD_ORIGINAL',
      resourceId: documentId,
    });
    const expected = {
      accountId: ownerId,
      action: 'DOWNLOAD_ORIGINAL' as const,
      resourceId: documentId,
    };
    expect(verifyStepUp(STEP_UP_SECRET, token, expected)).toBeUndefined();
    expect(verifyStepUp('', token, expected)).toBeUndefined();
  });

  it('asks for a step-up before previewing an identity, tax or bank document', async () => {
    expect(isRestrictedDocumentType('PASSPORT')).toBe(true);
    expect(isRestrictedDocumentType('BANK_STATEMENT')).toBe(true);
    expect(isRestrictedDocumentType('EMPLOYMENT_CERTIFICATE')).toBe(false);
    for (const medical of [
      'MEDICAL_REPORT',
      'VACCINATION_CERTIFICATE',
      'MENTAL_HEALTH_CERTIFICATE',
      'PRESCRIPTION',
      'APPROVED_MEDICAL_CENTRE_RESULT',
      'OTHER_MEDICAL_DOCUMENT',
    ]) {
      expect(isRestrictedDocumentType(medical), medical).toBe(true);
    }
    // Not known yet, so it could be a passport: restricted until classified.
    expect(isRestrictedDocumentType(null)).toBe(true);
    expect(isRestrictedDocumentType('SOMETHING_NOBODY_KNOWS')).toBe(true);
    for (const identity of [
      'OTHER_IDENTITY_DOCUMENT',
      'BIRTH_CERTIFICATE',
      'REFUGEE_DOCUMENT',
      'JOINT_ACCOUNT_STATEMENT',
    ]) {
      expect(isRestrictedDocumentType(identity), identity).toBe(true);
    }
    const passport = await registerDocument(db, {
      actorAccountId: ownerId,
      applicantId,
      originalName: 'passport.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(passport)) throw new Error('passport');
    const owner = accountPrincipal(ownerId);
    const ref = { documentId: passport.value.id };
    expect(errorCode(await requireAccess(db, owner, 'PREVIEW', ref, { purpose: 'self' }))).toBe(
      'step_up_required',
    );
    const confirmed = await requireAccess(db, owner, 'PREVIEW', ref, {
      purpose: 'self',
      stepUp: stepUpFor(ownerId, 'PREVIEW', passport.value.id),
    });
    expect(isOk(confirmed)).toBe(true);
    // An ordinary document still previews without one.
    expect(
      isOk(await requireAccess(db, owner, 'PREVIEW', { documentId }, { purpose: 'self' })),
    ).toBe(true);
  });

  it('forbids a stranger', async () => {
    const strangerId = await account(db, 'stranger@example.com');
    const stranger = accountPrincipal(strangerId);
    for (const ref of [{ applicantId }, { missionId }, { documentId }]) {
      const result = await requireAccess(db, stranger, 'VIEW_METADATA', ref, { purpose: 'x' });
      expect(errorCode(result)).toBe('forbidden');
    }
    const eachGrant = await requireAccess(
      db,
      stranger,
      'VIEW_METADATA',
      { applicantId },
      { purpose: EACH_GRANT },
    );
    expect(errorCode(eachGrant)).toBe('forbidden');
  });

  it('returns not_found for unknown or malformed ids and invalid for an ambiguous reference', async () => {
    const owner = accountPrincipal(ownerId);
    for (const ref of [
      { applicantId: randomUUID() },
      { missionId: randomUUID() },
      { documentId: randomUUID() },
      { documentId: 'not-a-uuid' },
    ]) {
      const result = await requireAccess(db, owner, 'VIEW_METADATA', ref, { purpose: 'self' });
      expect(errorCode(result)).toBe('not_found');
    }
    const ambiguous = await requireAccess(
      db,
      owner,
      'VIEW_METADATA',
      { applicantId, missionId } as unknown as { applicantId: string },
      { purpose: 'self' },
    );
    expect(errorCode(ambiguous)).toBe('invalid');
  });

  it('allows an organization member with an accepted grant only for the granted action', async () => {
    const { agentId, organizationId } = await orgWithGrant({
      actions: ['VIEW_METADATA', 'PREVIEW'],
    });
    const agent = accountPrincipal(agentId);
    const allowed = await requireAccess(
      db,
      agent,
      'PREVIEW',
      { documentId },
      { purpose: 'visa-review' },
    );
    expect(isOk(allowed)).toBe(true);
    if (isOk(allowed)) {
      expect(allowed.value.actor.kind).toBe('organization_member');
    }
    const notGranted = await requireAccess(
      db,
      agent,
      'MANAGE',
      { missionId },
      { purpose: 'visa-review' },
    );
    expect(errorCode(notGranted)).toBe('forbidden');

    // A second, non-admin member of the same organization is covered by the
    // organization's grant too; once deactivated, they are not.
    const reviewerId = await account(db, 'reviewer@acme.example.com');
    const added = await addMembership(db, {
      actorAccountId: agentId,
      organizationId,
      accountId: reviewerId,
      role: 'REVIEWER',
    });
    if (!isOk(added)) throw new Error('membership');
    const reviewer = accountPrincipal(reviewerId);
    const member = await requireAccess(
      db,
      reviewer,
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'visa-review' },
    );
    expect(isOk(member)).toBe(true);
    const deactivated = await setMembershipActive(db, {
      actorAccountId: agentId,
      organizationId,
      membershipId: added.value.id,
      active: false,
    });
    if (!isOk(deactivated)) throw new Error(`deactivate: ${deactivated.error.message}`);
    const afterRemoval = await requireAccess(
      db,
      reviewer,
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'visa-review' },
    );
    expect(errorCode(afterRemoval)).toBe('forbidden');
  });

  it('denies every member once the organization is suspended (SHR-02)', async () => {
    const { agentId, organizationId } = await orgWithGrant({ actions: ['VIEW_METADATA'] });
    const agent = accountPrincipal(agentId);
    expect(
      isOk(
        await requireAccess(
          db,
          agent,
          'VIEW_METADATA',
          { applicantId },
          { purpose: 'visa-review' },
        ),
      ),
    ).toBe(true);
    const reviewerId = await account(db, 'suspender@platform.example.com');
    const suspended = await suspendOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId,
      stepUpSatisfied: true,
    });
    if (!isOk(suspended)) throw new Error('suspend');
    const after = await requireAccess(
      db,
      agent,
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'visa-review' },
    );
    expect(errorCode(after)).toBe('forbidden');
    if (isErr(after)) expect(after.error.message).toContain('organization_not_active');
  });

  it('denies a grant that is not accepted, paused, or expired', async () => {
    const pending = await orgWithGrant({ actions: ['VIEW_METADATA'], accept: false });
    expect(
      errorCode(
        await requireAccess(
          db,
          accountPrincipal(pending.agentId),
          'VIEW_METADATA',
          { applicantId },
          { purpose: 'visa-review' },
        ),
      ),
    ).toBe('forbidden');

    const paused = await orgWithGrant({ actions: ['VIEW_METADATA'] });
    const pausedPrincipal = accountPrincipal(paused.agentId);
    expect(
      isOk(
        await requireAccess(
          db,
          pausedPrincipal,
          'VIEW_METADATA',
          { applicantId },
          { purpose: 'visa-review' },
        ),
      ),
    ).toBe(true);
    const pausedResult = await pauseGrant(db, { actorAccountId: ownerId, grantId: paused.grantId });
    if (!isOk(pausedResult)) throw new Error('pause');
    expect(
      errorCode(
        await requireAccess(
          db,
          pausedPrincipal,
          'VIEW_METADATA',
          { applicantId },
          { purpose: 'visa-review' },
        ),
      ),
    ).toBe('forbidden');

    const live = await orgWithGrant({ actions: ['VIEW_METADATA'] });
    const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    // The gate always uses the real clock; only the clock itself can move it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(farFuture);
    const expired = await requireAccess(
      db,
      accountPrincipal(live.agentId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'visa-review' },
    );
    vi.useRealTimers();
    expect(errorCode(expired)).toBe('forbidden');
    if (isErr(expired)) expect(expired.error.message).toContain('grant_expired');
  });

  it('denies a purpose mismatch unless each grant is judged on its own purpose', async () => {
    const { agentId } = await orgWithGrant({ actions: ['VIEW_METADATA'], purpose: 'visa-review' });
    const agent = accountPrincipal(agentId);
    const mismatch = await requireAccess(
      db,
      agent,
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'marketing' },
    );
    expect(errorCode(mismatch)).toBe('forbidden');
    if (isErr(mismatch)) expect(mismatch.error.message).toContain('purpose_mismatch');
    const eachGrant = await requireAccess(
      db,
      agent,
      'VIEW_METADATA',
      { applicantId },
      { purpose: EACH_GRANT },
    );
    expect(isOk(eachGrant)).toBe(true);
    const eachGrantWrongAction = await requireAccess(
      db,
      agent,
      'MANAGE',
      { applicantId },
      { purpose: EACH_GRANT },
    );
    expect(errorCode(eachGrantWrongAction)).toBe('forbidden');
    // The literal text 'each-grant' is just another purpose, never the switch.
    const literal = await requireAccess(
      db,
      agent,
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'each-grant' },
    );
    expect(errorCode(literal)).toBe('forbidden');
  });

  it('allows a direct individual recipient with an accepted grant', async () => {
    const friendId = await account(db, 'friend@example.com');
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientAccountId: friendId,
      actions: ['PREVIEW'],
      purpose: 'family-help',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const friend = accountPrincipal(friendId);
    expect(
      errorCode(
        await requireAccess(db, friend, 'PREVIEW', { documentId }, { purpose: 'family-help' }),
      ),
    ).toBe('forbidden');
    const accepted = await acceptGrant(db, { actorAccountId: friendId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    const allowed = await requireAccess(
      db,
      friend,
      'PREVIEW',
      { documentId },
      { purpose: 'family-help' },
    );
    expect(isOk(allowed)).toBe(true);
    if (isOk(allowed))
      expect(allowed.value.actor).toEqual({ kind: 'individual_recipient', accountId: friendId });
    expect(
      errorCode(
        await requireAccess(
          db,
          friend,
          'DOWNLOAD_REDACTED',
          { documentId },
          { purpose: 'family-help' },
        ),
      ),
    ).toBe('forbidden');
  });

  it('allows an in-flight contributor only for contributor actions on its own request', async () => {
    const created = await createContributorRequest(db, {
      actorAccountId: ownerId,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'sponsor evidence',
    });
    if (!isOk(created)) throw new Error(`contributor request: ${created.error.message}`);
    const sponsorId = await account(db, 'sponsor@example.com');
    const sponsor = accountPrincipal(sponsorId);
    const contributorRequestId = created.value.request.id;

    // Not yet claimed: no access.
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'PROPOSE_EDIT',
          { missionId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');

    const begun = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: sponsorId,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    if (!isOk(begun)) throw new Error('begin');

    const allowed = await requireAccess(
      db,
      sponsor,
      'PROPOSE_EDIT',
      { missionId },
      { purpose: 'x', contributorRequestId },
    );
    expect(isOk(allowed)).toBe(true);
    if (isOk(allowed))
      expect(allowed.value.actor).toEqual({
        kind: 'contributor',
        accountId: sponsorId,
        contributorRequestId,
      });
    // A claimed request still ends when its link expires.
    const [{ expiresAt }] = (await db
      .select({ expiresAt: schema.contributorRequests.expiresAt })
      .from(schema.contributorRequests)
      .where(eq(schema.contributorRequests.id, contributorRequestId))) as [{ expiresAt: Date }];
    await db
      .update(schema.contributorRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.contributorRequests.id, contributorRequestId));
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'PROPOSE_EDIT',
          { missionId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');
    await db
      .update(schema.contributorRequests)
      .set({ expiresAt })
      .where(eq(schema.contributorRequests.id, contributorRequestId));
    // A case-scoped request never reaches the whole profile (policy law 5).
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'PROPOSE_EDIT',
          { applicantId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');

    // Never a view, never without the request, never another case, never someone else's document.
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'VIEW_METADATA',
          { missionId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');
    expect(
      errorCode(await requireAccess(db, sponsor, 'PROPOSE_EDIT', { missionId }, { purpose: 'x' })),
    ).toBe('forbidden');
    const otherMission = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Other',
    });
    if (!isOk(otherMission)) throw new Error('mission');
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'PROPOSE_EDIT',
          { missionId: otherMission.value.id },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'PROPOSE_EDIT',
          { documentId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');
    const stranger = accountPrincipal(await account(db, 'not-the-sponsor@example.com'));
    expect(
      errorCode(
        await requireAccess(
          db,
          stranger,
          'PROPOSE_EDIT',
          { missionId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe('forbidden');
  });

  it('allows support only with asSupport and an approved support grant', async () => {
    const operatorId = await account(db, 'support-operator@example.com');
    const approverId = await account(db, 'security-admin@example.com');
    const asSupport = accountPrincipal(operatorId, { asSupport: true });
    const plain = accountPrincipal(operatorId);

    expect(
      errorCode(
        await requireAccess(
          db,
          asSupport,
          'PREVIEW',
          { documentId },
          { purpose: SUPPORT_ACCESS_PURPOSE },
        ),
      ),
    ).toBe('forbidden');

    const grant = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['PREVIEW'],
      reason: 'Investigating ticket 4821',
      approvedByAccountId: approverId,
      durationMinutes: 30,
    });
    if (!isOk(grant)) throw new Error(`support grant: ${grant.error.message}`);

    expect(
      errorCode(
        await requireAccess(
          db,
          plain,
          'PREVIEW',
          { documentId },
          { purpose: SUPPORT_ACCESS_PURPOSE },
        ),
      ),
    ).toBe('forbidden');
    const allowed = await requireAccess(
      db,
      asSupport,
      'PREVIEW',
      { documentId },
      { purpose: SUPPORT_ACCESS_PURPOSE },
    );
    expect(isOk(allowed)).toBe(true);
    if (isOk(allowed))
      expect(allowed.value.actor).toEqual({ kind: 'support_admin', accountId: operatorId });
    expect(
      errorCode(
        await requireAccess(
          db,
          asSupport,
          'MANAGE',
          { documentId },
          { purpose: SUPPORT_ACCESS_PURPOSE },
        ),
      ),
    ).toBe('forbidden');
    // asSupport never borrows ownership: the owner acting as support has no support grant.
    expect(
      errorCode(
        await requireAccess(
          db,
          accountPrincipal(ownerId, { asSupport: true }),
          'PREVIEW',
          { documentId },
          { purpose: SUPPORT_ACCESS_PURPOSE },
        ),
      ),
    ).toBe('forbidden');
  });

  it('refuses system and staff principals, and builds staff scope only from a live role check', async () => {
    const job = systemPrincipal('process-erasure');
    expect(job.kind).toBe('system');
    expect(
      errorCode(await requireAccess(db, job, 'VIEW_METADATA', { applicantId }, { purpose: 'job' })),
    ).toBe('forbidden');
    expect(() => systemPrincipal('not-a-job' as never)).toThrow(/unknown system job/);

    const staffId = await account(db, 'staff@example.com');
    const noRole = await staffPrincipal(
      db,
      { accountId: staffId, email: 'staff@example.com', bootstrapEmails: [] },
      'PACK_MANAGE',
    );
    expect(errorCode(noRole)).toBe('forbidden');
    const bootstrap = await staffPrincipal(
      db,
      { accountId: staffId, email: 'staff@example.com', bootstrapEmails: ['staff@example.com'] },
      'PACK_MANAGE',
    );
    expect(isOk(bootstrap)).toBe(true);
    if (!isOk(bootstrap)) return;
    expect(bootstrap.value.platformAction).toBe('PACK_MANAGE');
    expect(
      errorCode(
        await requireAccess(
          db,
          bootstrap.value,
          'VIEW_METADATA',
          { applicantId },
          { purpose: 'staff' },
        ),
      ),
    ).toBe('forbidden');
    expect(StaffScope.isGenuine(bootstrap.value)).toBe(true);
    expect(StaffScope.isGenuine({ ...bootstrap.value })).toBe(false);
  });

  it('binds a contributor document to the in-flight request, never to an earlier one', async () => {
    const sponsorId = await account(db, 'sponsor@example.com');
    const sponsor = accountPrincipal(sponsorId);
    async function claim(onMission: string) {
      const created = await createContributorRequest(db, {
        actorAccountId: ownerId,
        missionId: onMission,
        contributorEmail: 'sponsor@example.com',
        docType: 'bank_statement',
        purpose: 'sponsor evidence',
      });
      if (!isOk(created)) throw new Error(`request: ${created.error.message}`);
      const begun = await beginContributorSubmission(db, {
        rawToken: created.value.rawToken,
        actorAccountId: sponsorId,
        actorEmail: 'sponsor@example.com',
        allowWalletReuse: false,
      });
      if (!isOk(begun)) throw new Error('begin');
      return created.value.request.id;
    }
    async function submit(requestId: string, docType = 'bank_statement') {
      const doc = await registerDocument(db, {
        actorAccountId: sponsorId,
        applicantId,
        originalName: 'evidence.pdf',
        docType,
        source: 'CONTRIBUTOR',
        onBehalfOfContributorRequestId: requestId,
      });
      if (!isOk(doc)) throw new Error(`register: ${doc.error.message}`);
      return doc.value.id;
    }

    // Request 1 on the first case: handed over and completed.
    const first = await claim(missionId);
    const firstDoc = await submit(first);
    const completed = await completeContributorSubmission(db, {
      contributorRequestId: first,
      documentId: firstDoc,
    });
    if (!isOk(completed)) throw new Error('complete');

    // Request 2 on another case, now in flight.
    const otherMission = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'B',
    });
    if (!isOk(otherMission)) throw new Error('mission');
    const second = await claim(otherMission.value.id);
    const opts = { purpose: 'x', contributorRequestId: second };

    // The earlier request's document is out of reach through the new request.
    expect(
      errorCode(await requireAccess(db, sponsor, 'PROPOSE_EDIT', { documentId: firstDoc }, opts)),
    ).toBe('forbidden');
    // So is the first case itself.
    expect(errorCode(await requireAccess(db, sponsor, 'PROPOSE_EDIT', { missionId }, opts))).toBe(
      'forbidden',
    );

    // The document handed over under request 2 is reachable through it.
    const secondDoc = await submit(second);
    expect(
      isOk(await requireAccess(db, sponsor, 'PROPOSE_EDIT', { documentId: secondDoc }, opts)),
    ).toBe(true);
    // A document of a different type than was asked for is not.
    const wrongType = await submit(second, 'payslip');
    expect(
      errorCode(await requireAccess(db, sponsor, 'PROPOSE_EDIT', { documentId: wrongType }, opts)),
    ).toBe('forbidden');
  });

  it('judges organization access only on that organization grants, and refuses to guess between relationships', async () => {
    // A personal grant plus an unrelated organization membership.
    const { agentId, organizationId } = await orgWithGrant({ actions: ['MANAGE'] });
    const personal = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientAccountId: agentId,
      actions: ['PREVIEW'],
      purpose: 'visa-review',
    });
    if (!isOk(personal)) throw new Error(`grant: ${personal.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: agentId, grantId: personal.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    const agent = accountPrincipal(agentId);

    // PREVIEW comes only from the personal grant: reported as individual access.
    const preview = await requireAccess(
      db,
      agent,
      'PREVIEW',
      { documentId },
      { purpose: 'visa-review' },
    );
    expect(isOk(preview)).toBe(true);
    if (isOk(preview)) {
      expect(preview.value.actor).toEqual({ kind: 'individual_recipient', accountId: agentId });
    }
    // Acting for the organization, the personal grant does not count.
    expect(
      errorCode(
        await requireAccess(
          db,
          agent,
          'PREVIEW',
          { documentId },
          { purpose: 'visa-review', actingFor: { organizationId } },
        ),
      ),
    ).toBe('forbidden');
    // MANAGE comes only from the organization grant.
    const manage = await requireAccess(
      db,
      agent,
      'MANAGE',
      { applicantId },
      { purpose: 'visa-review' },
    );
    expect(isOk(manage)).toBe(true);
    if (isOk(manage)) expect(manage.value.actor.kind).toBe('organization_member');
    expect(
      errorCode(
        await requireAccess(
          db,
          agent,
          'MANAGE',
          { applicantId },
          { purpose: 'visa-review', actingFor: 'individual' },
        ),
      ),
    ).toBe('forbidden');

    // Both relationships allow MANAGE once a personal grant also has it: ambiguous.
    const both = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientAccountId: agentId,
      actions: ['MANAGE'],
      purpose: 'visa-review',
    });
    if (!isOk(both)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agentId, grantId: both.value.id });
    expect(
      errorCode(
        await requireAccess(db, agent, 'MANAGE', { applicantId }, { purpose: 'visa-review' }),
      ),
    ).toBe('invalid');
    const named = await requireAccess(
      db,
      agent,
      'MANAGE',
      { applicantId },
      { purpose: 'visa-review', actingFor: { organizationId } },
    );
    expect(isOk(named)).toBe(true);
    if (isOk(named)) expect(named.value.actor.kind).toBe('organization_member');
  });

  it('never treats an ordinary grant as support access', async () => {
    const operatorId = await account(db, 'support-friend@example.com');
    for (const purpose of ['family-help', SUPPORT_ACCESS_PURPOSE]) {
      const grant = await createGrant(db, {
        actorAccountId: ownerId,
        applicantId,
        recipientAccountId: operatorId,
        actions: ['PREVIEW'],
        purpose,
      });
      if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
      const accepted = await acceptGrant(db, {
        actorAccountId: operatorId,
        grantId: grant.value.id,
      });
      if (!isOk(accepted)) throw new Error('accept');
      expect(
        errorCode(
          await requireAccess(
            db,
            accountPrincipal(operatorId, { asSupport: true }),
            'PREVIEW',
            { documentId },
            { purpose },
          ),
        ),
      ).toBe('forbidden');
    }
  });

  it('checks previews and downloads one document at a time', async () => {
    const owner = accountPrincipal(ownerId);
    for (const ref of [{ applicantId }, { missionId }]) {
      for (const action of ['PREVIEW', 'DOWNLOAD_ORIGINAL', 'DOWNLOAD_REDACTED'] as const) {
        expect(errorCode(await requireAccess(db, owner, action, ref, { purpose: 'self' }))).toBe(
          'invalid',
        );
      }
    }
  });

  it('issues a proof whose records cannot be changed afterwards', async () => {
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'PREVIEW',
      { documentId },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('proof');
    const applicant = proof.value.applicant as { id: string };
    expect(() => {
      applicant.id = randomUUID();
    }).toThrow(TypeError);
    const resource = proof.value.resource;
    if (resource.kind !== 'document') throw new Error('kind');
    const document = resource.document as { applicantId: string };
    expect(() => {
      document.applicantId = randomUUID();
    }).toThrow(TypeError);
    expect(proof.value.applicant.id).toBe(applicantId);
  });

  it('lets a step-up lapse when its token runs out, and refuses ids in upper case', async () => {
    const owner = accountPrincipal(ownerId);
    const stepUp = stepUpFor(ownerId, 'DOWNLOAD_ORIGINAL', documentId);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    const late = await requireAccess(
      db,
      owner,
      'DOWNLOAD_ORIGINAL',
      { documentId },
      { purpose: 'self', stepUp },
    );
    vi.useRealTimers();
    expect(errorCode(late)).toBe('step_up_required');
    expect(
      errorCode(
        await requireAccess(
          db,
          accountPrincipal(ownerId.toUpperCase()),
          'VIEW_METADATA',
          {
            applicantId,
          },
          { purpose: 'self' },
        ),
      ),
    ).toBe('forbidden');
    expect(
      errorCode(
        await requireAccess(
          db,
          owner,
          'VIEW_METADATA',
          { applicantId: applicantId.toUpperCase() },
          {
            purpose: 'self',
          },
        ),
      ),
    ).toBe('not_found');
  });

  it('never lets an organization grant that names one person reach every member', async () => {
    const { agentId, organizationId, grantId } = await orgWithGrant({ actions: ['VIEW_METADATA'] });
    const colleagueId = await account(db, 'colleague@agency.example.com');
    const added = await addMembership(db, {
      actorAccountId: agentId,
      organizationId,
      accountId: colleagueId,
      role: 'REVIEWER',
    });
    expect(isOk(added)).toBe(true);
    const colleague = accountPrincipal(colleagueId);
    const before = await requireAccess(
      db,
      colleague,
      'VIEW_METADATA',
      { applicantId },
      {
        purpose: 'visa-review',
      },
    );
    expect(isOk(before)).toBe(true);
    // The database allows a row naming both; the gate then lets only that person through.
    await db
      .update(schema.grants)
      .set({ recipientAccountId: agentId })
      .where(eq(schema.grants.id, grantId));
    const after = await requireAccess(
      db,
      colleague,
      'VIEW_METADATA',
      { applicantId },
      {
        purpose: 'visa-review',
      },
    );
    expect(errorCode(after)).toBe('forbidden');
    const named = await requireAccess(
      db,
      accountPrincipal(agentId),
      'VIEW_METADATA',
      {
        applicantId,
      },
      { purpose: 'visa-review' },
    );
    expect(isOk(named)).toBe(true);
  });

  it('issues proofs nothing else can copy or construct', async () => {
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('proof');
    expect(AuthorizedApplicant.isGenuine(proof.value, 'MANAGE')).toBe(true);
    expect(AuthorizedApplicant.isGenuine(proof.value, 'PREVIEW')).toBe(false);
    expect(AuthorizedApplicant.isGenuine({ ...proof.value }, 'MANAGE')).toBe(false);
    const Ctor = AuthorizedApplicant as unknown as new (fields: unknown) => unknown;
    expect(() => new Ctor({ ...proof.value })).toThrow(/requireAccess/);
  });
});
