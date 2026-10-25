import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { type Result, isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import { beginContributorSubmission, createContributorRequest } from '../contributor-requests';
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
import { SUPPORT_ACCESS_PURPOSE, createSupportGrant } from '../support-access';
import { accountPrincipal, staffPrincipal, systemPrincipal } from './principal';
import { EACH_GRANT, requireAccess } from './require-access';

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
      originalName: 'statement.pdf',
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
      { purpose: 'self', stepUpSatisfied: true },
    );
    expect(isOk(withStepUp)).toBe(true);
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
    const expired = await requireAccess(
      db,
      accountPrincipal(live.agentId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'visa-review', now: farFuture },
    );
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
    expect(
      isOk(
        await requireAccess(
          db,
          sponsor,
          'PROPOSE_EDIT',
          { applicantId },
          { purpose: 'x', contributorRequestId },
        ),
      ),
    ).toBe(true);

    // Never a view, never without the request, never another case, never someone else's document.
    expect(
      errorCode(
        await requireAccess(
          db,
          sponsor,
          'PREVIEW',
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
  });
});
