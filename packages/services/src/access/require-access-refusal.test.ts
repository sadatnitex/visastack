import { randomUUID } from 'node:crypto';
import type { PermissionAction, Result } from '@visastack/core';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import { beginContributorSubmission, createContributorRequest } from '../contributor-requests';
import type { Db } from '../db';
import { registerDocument } from '../documents';
import type { ServiceError } from '../errors';
import { createMission } from '../missions';
import { createOrganization, reviewOrganization } from '../organizations';
import { acceptGrant, createGrant, revokeGrant } from '../sharing';
import { issueStepUpAssurance } from '../step-up';
import { accountPrincipal, staffPrincipal } from './principal';
import {
  type AccessRefusal,
  type ApplicantResourceRef,
  type AuthorizedApplicant,
  EACH_GRANT,
  type RequireAccessOptions,
  requireAccess,
} from './require-access';
import { verifyStepUp } from './step-up-proof';

/**
 * One answer for every refusal (owner decision, 13 Nov 2026).
 *
 * A signed-in caller who may not use a record gets exactly the same refusal (code, message and
 * shape) whether the id was made up, the record belongs to someone else, or the caller's own access
 * was revoked or has expired. The precise reason reaches only the `onRefused` hook, for audit and
 * logs. Both refusal paths also do the same database work, so the work done cannot tell them apart
 * either; that is proved from the query log, never from a clock.
 */

const MADE_UP = '7f1c2b4e-1111-4a2b-8c3d-000000000000';

interface QueryRecord {
  readonly sql: string;
}

/** A database handle over `client` that records every statement it sends, in order. */
function loggedDb(client: Awaited<ReturnType<typeof createMigratedPglite>>, log: QueryRecord[]) {
  return drizzle(client, {
    schema,
    logger: { logQuery: (sql: string) => log.push({ sql }) },
  }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error(`provision ${email}`);
  return result.value.id;
}

interface World {
  readonly db: Db;
  readonly log: QueryRecord[];
  readonly ownerId: string;
  readonly applicantId: string;
  readonly missionId: string;
  readonly documentId: string;
  readonly strangerId: string;
  readonly revokedId: string;
  readonly expiredId: string;
  readonly agencyMemberId: string;
  readonly agencyId: string;
}

async function buildWorld(): Promise<World> {
  const log: QueryRecord[] = [];
  const db = loggedDb(await createMigratedPglite(), log);
  const ownerId = await account(db, 'owner@example.com');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  const mission = await createMission(db, { actorAccountId: ownerId, applicantId, title: 'M' });
  if (!isOk(mission)) throw new Error('mission');
  const document = await registerDocument(db, {
    actorAccountId: ownerId,
    applicantId,
    originalName: 'certificate.pdf',
    docType: 'EMPLOYMENT_CERTIFICATE',
  });
  if (!isOk(document)) throw new Error('document');

  const strangerId = await account(db, 'stranger@example.com');

  // Someone whose access the owner revoked.
  const revokedId = await account(db, 'revoked@example.com');
  const revoked = await createGrant(db, {
    actorAccountId: ownerId,
    applicantId,
    recipientAccountId: revokedId,
    actions: ['VIEW_METADATA', 'MANAGE'],
    purpose: 'visa-review',
  });
  if (!isOk(revoked)) throw new Error('revoked grant');
  if (!isOk(await acceptGrant(db, { actorAccountId: revokedId, grantId: revoked.value.id }))) {
    throw new Error('accept revoked');
  }
  if (!isOk(await revokeGrant(db, { actorAccountId: ownerId, grantId: revoked.value.id }))) {
    throw new Error('revoke');
  }

  // Someone whose access ran out.
  const expiredId = await account(db, 'expired@example.com');
  const expired = await createGrant(db, {
    actorAccountId: ownerId,
    applicantId,
    recipientAccountId: expiredId,
    actions: ['VIEW_METADATA', 'MANAGE'],
    purpose: 'visa-review',
  });
  if (!isOk(expired)) throw new Error('expired grant');
  if (!isOk(await acceptGrant(db, { actorAccountId: expiredId, grantId: expired.value.id }))) {
    throw new Error('accept expired');
  }
  await db
    .update(schema.grants)
    .set({ expiryAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.grants.id, expired.value.id));

  // An active agency with no grant for this traveller.
  const agencyMemberId = await account(db, `agent-${randomUUID()}@acme.example.com`);
  const org = await createOrganization(db, { actorAccountId: agencyMemberId, name: 'Acme' });
  if (!isOk(org)) throw new Error('org');
  const reviewerId = await account(db, 'reviewer@platform.example.com');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewerId,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');

  return {
    db,
    log,
    ownerId,
    applicantId,
    missionId: mission.value.id,
    documentId: document.value.id,
    strangerId,
    revokedId,
    expiredId,
    agencyMemberId,
    agencyId: org.value.id,
  };
}

type Kind = 'applicantId' | 'missionId' | 'documentId';
const KINDS: readonly Kind[] = ['applicantId', 'missionId', 'documentId'];

function realRef(world: World, kind: Kind): ApplicantResourceRef {
  if (kind === 'applicantId') return { applicantId: world.applicantId };
  if (kind === 'missionId') return { missionId: world.missionId };
  return { documentId: world.documentId };
}

function madeUpRef(kind: Kind): ApplicantResourceRef {
  if (kind === 'applicantId') return { applicantId: MADE_UP };
  if (kind === 'missionId') return { missionId: MADE_UP };
  return { documentId: MADE_UP };
}

interface Case {
  readonly name: string;
  readonly account: (world: World) => string;
  readonly ref: (world: World, kind: Kind) => ApplicantResourceRef;
  readonly options: (world: World) => RequireAccessOptions;
  /** The reason the hook must report: the internal truth, never shown to the caller. */
  readonly reason: AccessRefusal['reason'];
  readonly recordExists: boolean;
}

const self: RequireAccessOptions = { purpose: 'self' };

const REFUSALS: readonly Case[] = [
  {
    name: 'a made-up id',
    account: (w) => w.strangerId,
    ref: (_w, kind) => madeUpRef(kind),
    options: () => self,
    reason: 'not_found',
    recordExists: false,
  },
  {
    name: 'a made-up id tried by the owner of another record',
    account: (w) => w.ownerId,
    ref: (_w, kind) => madeUpRef(kind),
    options: () => self,
    reason: 'not_found',
    recordExists: false,
  },
  {
    name: 'a real record of someone else',
    account: (w) => w.strangerId,
    ref: realRef,
    options: () => self,
    reason: 'default_deny',
    recordExists: true,
  },
  {
    name: 'a real record whose access was revoked',
    account: (w) => w.revokedId,
    ref: realRef,
    options: () => ({ purpose: EACH_GRANT }),
    reason: 'grant_revoked',
    recordExists: true,
  },
  {
    name: 'a real record whose access expired',
    account: (w) => w.expiredId,
    ref: realRef,
    options: () => ({ purpose: EACH_GRANT }),
    reason: 'grant_expired',
    recordExists: true,
  },
  {
    name: 'a real record tried by an unrelated agency',
    account: (w) => w.agencyMemberId,
    ref: realRef,
    options: (w) => ({ purpose: EACH_GRANT, actingFor: { organizationId: w.agencyId } }),
    reason: 'default_deny',
    recordExists: true,
  },
  {
    name: 'a made-up id tried by an unrelated agency',
    account: (w) => w.agencyMemberId,
    ref: (_w, kind) => madeUpRef(kind),
    options: (w) => ({ purpose: EACH_GRANT, actingFor: { organizationId: w.agencyId } }),
    reason: 'not_found',
    recordExists: false,
  },
  {
    name: 'a malformed id',
    account: (w) => w.strangerId,
    ref: (_w, kind) => ({ [kind]: 'not-a-uuid' }) as unknown as ApplicantResourceRef,
    options: () => self,
    reason: 'malformed_id',
    recordExists: false,
  },
];

const ACTIONS: readonly PermissionAction[] = ['VIEW_METADATA', 'MANAGE'];

describe('requireAccess gives one public refusal, whatever the reason', () => {
  let world: World;
  beforeAll(async () => {
    world = await buildWorld();
  });

  it('lets the genuine owner through on every kind of record', async () => {
    for (const kind of KINDS) {
      for (const action of ACTIONS) {
        const result = await requireAccess(
          world.db,
          accountPrincipal(world.ownerId),
          action,
          realRef(world, kind),
          self,
        );
        expect(isOk(result), `${kind} ${action}`).toBe(true);
        if (isOk(result)) expect(result.value.actor.kind).toBe('applicant_owner');
      }
    }
  });

  for (const kind of KINDS) {
    for (const action of ACTIONS) {
      it(`refuses every case identically: ${kind}, ${action}`, async () => {
        const answers: unknown[] = [];
        const hooks: AccessRefusal[][] = [];
        for (const refusal of REFUSALS) {
          const heard: AccessRefusal[] = [];
          answers.push(
            await requireAccess(
              world.db,
              accountPrincipal(refusal.account(world)),
              action,
              refusal.ref(world, kind),
              { ...refusal.options(world), onRefused: (detail) => heard.push(detail) },
            ),
          );
          hooks.push(heard);
        }
        // The whole returned value, not just its code: no extra field may carry the reason.
        for (const [index, answer] of answers.entries()) {
          expect(answer, REFUSALS[index]?.name).toStrictEqual({
            ok: false,
            error: { code: 'not_found', message: 'record not found' },
          });
        }
        // The internal reason reached the hook, once, and only the hook.
        for (const [index, refusal] of REFUSALS.entries()) {
          expect(hooks[index], refusal.name).toEqual([
            { reason: refusal.reason, recordExists: refusal.recordExists },
          ]);
        }
      });
    }
  }

  it('also refuses identically without a hook, and a non-account principal the same way', async () => {
    const made = await requireAccess(
      world.db,
      accountPrincipal(world.strangerId),
      'VIEW_METADATA',
      { missionId: MADE_UP },
      self,
    );
    const real = await requireAccess(
      world.db,
      accountPrincipal(world.strangerId),
      'VIEW_METADATA',
      { missionId: world.missionId },
      self,
    );
    expect(real).toStrictEqual(made);
  });
});

describe('a made-up id and a real foreign id do the same database work', () => {
  let world: World;
  beforeAll(async () => {
    world = await buildWorld();
  });

  /** The statements one gate call sends, with ids and literals reduced to their shape. */
  async function statements(
    accountId: string,
    action: PermissionAction,
    ref: ApplicantResourceRef,
    options: RequireAccessOptions,
  ): Promise<string[]> {
    world.log.length = 0;
    const result = await requireAccess(world.db, accountPrincipal(accountId), action, ref, options);
    expect(result.ok).toBe(false);
    return world.log.map((entry) => entry.sql);
  }

  for (const kind of KINDS) {
    for (const action of ACTIONS) {
      it(`same query count and sequence: ${kind}, ${action}`, async () => {
        const made = await statements(world.strangerId, action, madeUpRef(kind), self);
        const real = await statements(world.strangerId, action, realRef(world, kind), self);
        expect(made.length).toBeGreaterThan(0);
        expect(real).toEqual(made);

        const agency = (w: World): RequireAccessOptions => ({
          purpose: EACH_GRANT,
          actingFor: { organizationId: w.agencyId },
        });
        const madeByAgency = await statements(
          world.agencyMemberId,
          action,
          madeUpRef(kind),
          agency(world),
        );
        const realByAgency = await statements(
          world.agencyMemberId,
          action,
          realRef(world, kind),
          agency(world),
        );
        expect(realByAgency).toEqual(madeByAgency);
      });
    }
  }

  it('a contributor claim does the same work for a made-up and a real case', async () => {
    const claim = { purpose: 'contributor', contributorRequestId: randomUUID() } as const;
    const made = await statements(world.strangerId, 'PROPOSE_EDIT', { missionId: MADE_UP }, claim);
    const real = await statements(
      world.strangerId,
      'PROPOSE_EDIT',
      { missionId: world.missionId },
      claim,
    );
    expect(real).toEqual(made);
  });
});

/**
 * Allowed paths do not change. Each row below is a caller the gate lets through (or answers with
 * step-up or "say which relationship"), and its result is fixed here exactly as the gate gave it
 * before one refusal replaced the old codes. Then other people's grants are added to the same
 * traveller and every row, allowed or refused, must give exactly the same result: the gate reads
 * only the caller's own grants, which must change nothing.
 */
describe("allowed paths are unchanged, and other people's grants change nothing", () => {
  const STEP_UP_SECRET = 'test-step-up-secret';
  let world: World;
  let fixtures: {
    readonly agencyAgentId: string;
    readonly agencyOrgId: string;
    readonly assignedAgentId: string;
    readonly assignedColleagueId: string;
    readonly assignedOrgId: string;
    readonly contributorId: string;
    readonly contributorRequestId: string;
    readonly bothId: string;
    readonly bothOrgId: string;
  };

  async function activeOrg(db: Db, ownerOfOrg: string, name: string): Promise<string> {
    const org = await createOrganization(db, { actorAccountId: ownerOfOrg, name });
    if (!isOk(org)) throw new Error('org');
    const reviewerId = await account(db, `reviewer-${randomUUID()}@platform.example.com`);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewerId,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    return org.value.id;
  }

  async function accepted(
    db: Db,
    grant: Parameters<typeof createGrant>[1],
    acceptor: string,
  ): Promise<string> {
    const made = await createGrant(db, grant);
    if (!isOk(made)) throw new Error(`grant: ${made.error.message}`);
    const done = await acceptGrant(db, { actorAccountId: acceptor, grantId: made.value.id });
    if (!isOk(done)) throw new Error('accept');
    return made.value.id;
  }

  beforeAll(async () => {
    world = await buildWorld();
    const { db, ownerId, applicantId, missionId } = world;
    const actions = ['VIEW_METADATA', 'MANAGE', 'PREVIEW'] as const;

    // An agency with an active grant.
    const agencyAgentId = await account(db, 'agency-agent@acme.example.com');
    const agencyOrgId = await activeOrg(db, agencyAgentId, 'Granted Agency');
    await accepted(
      db,
      {
        actorAccountId: ownerId,
        applicantId,
        recipientOrganizationId: agencyOrgId,
        actions,
        purpose: 'visa-review',
      },
      agencyAgentId,
    );

    // An agency grant assigned to one named member (the database allows a row naming both).
    const assignedAgentId = await account(db, 'assigned@assigned.example.com');
    const assignedOrgId = await activeOrg(db, assignedAgentId, 'Assigned Agency');
    const assignedGrant = await accepted(
      db,
      {
        actorAccountId: ownerId,
        applicantId,
        recipientOrganizationId: assignedOrgId,
        actions,
        purpose: 'visa-review',
      },
      assignedAgentId,
    );
    await db
      .update(schema.grants)
      .set({ recipientAccountId: assignedAgentId })
      .where(eq(schema.grants.id, assignedGrant));
    const assignedColleagueId = await account(db, 'colleague@assigned.example.com');
    await db.insert(schema.memberships).values({
      organizationId: assignedOrgId,
      accountId: assignedColleagueId,
      role: 'REVIEWER',
      active: true,
    });

    // A contributor who claimed a request for the case.
    const created = await createContributorRequest(db, {
      actorAccountId: ownerId,
      missionId,
      contributorEmail: 'sponsor@example.com',
      docType: 'bank_statement',
      purpose: 'sponsor evidence',
    });
    if (!isOk(created)) throw new Error(`contributor request: ${created.error.message}`);
    const contributorId = await account(db, 'sponsor@example.com');
    const begun = await beginContributorSubmission(db, {
      rawToken: created.value.rawToken,
      actorAccountId: contributorId,
      actorEmail: 'sponsor@example.com',
      allowWalletReuse: false,
    });
    if (!isOk(begun)) throw new Error('begin');

    // Someone who can see the traveller both personally and through their agency.
    const bothId = await account(db, 'both@both.example.com');
    const bothOrgId = await activeOrg(db, bothId, 'Both Agency');
    await accepted(
      db,
      {
        actorAccountId: ownerId,
        applicantId,
        recipientOrganizationId: bothOrgId,
        actions: ['VIEW_METADATA'],
        purpose: 'visa-review',
      },
      bothId,
    );
    await accepted(
      db,
      {
        actorAccountId: ownerId,
        applicantId,
        recipientAccountId: bothId,
        actions: ['VIEW_METADATA'],
        purpose: 'visa-review',
      },
      bothId,
    );

    fixtures = {
      agencyAgentId,
      agencyOrgId,
      assignedAgentId,
      assignedColleagueId,
      assignedOrgId,
      contributorId,
      contributorRequestId: created.value.request.id,
      bothId,
      bothOrgId,
    };
  });

  function stepUpFor(accountId: string, resourceId: string) {
    const token = issueStepUpAssurance(STEP_UP_SECRET, {
      accountId,
      action: 'DOWNLOAD_ORIGINAL',
      resourceId,
    });
    const proof = verifyStepUp(STEP_UP_SECRET, token, {
      accountId,
      action: 'DOWNLOAD_ORIGINAL',
      resourceId,
    });
    if (!proof) throw new Error('step-up proof');
    return proof;
  }

  /** A result reduced to what a caller can observe (ids replaced by their role in the world). */
  function outcome(result: Result<AuthorizedApplicant<PermissionAction>, ServiceError>): unknown {
    if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
    const proof = result.value;
    return {
      ok: true,
      actor: proof.actor,
      action: proof.action,
      resource: proof.resource.kind,
      applicant: proof.applicant.id === world.applicantId ? 'the traveller' : proof.applicant.id,
    };
  }

  type Row = readonly [name: string, run: () => Promise<unknown>, expected: () => unknown];

  function rows(): readonly Row[] {
    const { db, ownerId, applicantId, missionId, documentId } = world;
    const f = fixtures;
    const gate = (
      accountId: string,
      action: PermissionAction,
      ref: ApplicantResourceRef,
      options: RequireAccessOptions,
    ) => requireAccess(db, accountPrincipal(accountId), action, ref, options).then(outcome);
    const ownerActor = { kind: 'applicant_owner', applicantId };
    const member = (accountId: string, organizationId: string) => ({
      kind: 'organization_member',
      accountId,
      membership: { organizationId, role: 'OWNER', active: true, organizationActive: true },
    });
    const allowed = (actor: unknown, action: string, resource: string) => ({
      ok: true,
      actor,
      action,
      resource,
      applicant: 'the traveller',
    });
    const refusedAnswer = { ok: false, code: 'not_found', message: 'record not found' };
    return [
      [
        'owner, traveller',
        () => gate(ownerId, 'MANAGE', { applicantId }, self),
        () => allowed(ownerActor, 'MANAGE', 'applicant'),
      ],
      [
        'owner, case',
        () => gate(ownerId, 'MANAGE', { missionId }, self),
        () => allowed(ownerActor, 'MANAGE', 'mission'),
      ],
      [
        'owner, document',
        () => gate(ownerId, 'PREVIEW', { documentId }, self),
        () => allowed(ownerActor, 'PREVIEW', 'document'),
      ],
      [
        'agency member with an active grant',
        () =>
          gate(
            f.agencyAgentId,
            'MANAGE',
            { missionId },
            { purpose: EACH_GRANT, actingFor: { organizationId: f.agencyOrgId } },
          ),
        () => allowed(member(f.agencyAgentId, f.agencyOrgId), 'MANAGE', 'mission'),
      ],
      [
        'agency member with an active grant, by the grant purpose',
        () => gate(f.agencyAgentId, 'VIEW_METADATA', { applicantId }, { purpose: 'visa-review' }),
        () => allowed(member(f.agencyAgentId, f.agencyOrgId), 'VIEW_METADATA', 'applicant'),
      ],
      [
        'assigned agency member',
        () =>
          gate(
            f.assignedAgentId,
            'VIEW_METADATA',
            { applicantId },
            { purpose: EACH_GRANT, actingFor: { organizationId: f.assignedOrgId } },
          ),
        () => allowed(member(f.assignedAgentId, f.assignedOrgId), 'VIEW_METADATA', 'applicant'),
      ],
      [
        'a colleague of the assigned member',
        () =>
          gate(
            f.assignedColleagueId,
            'VIEW_METADATA',
            { applicantId },
            { purpose: EACH_GRANT, actingFor: { organizationId: f.assignedOrgId } },
          ),
        () => refusedAnswer,
      ],
      [
        'contributor claim',
        () =>
          gate(
            f.contributorId,
            'PROPOSE_EDIT',
            { missionId },
            { purpose: 'x', contributorRequestId: f.contributorRequestId },
          ),
        () => ({
          ok: true,
          actor: {
            kind: 'contributor',
            accountId: f.contributorId,
            contributorRequestId: f.contributorRequestId,
          },
          action: 'PROPOSE_EDIT',
          resource: 'mission',
          applicant: 'the traveller',
        }),
      ],
      [
        'step-up needed',
        () => gate(ownerId, 'DOWNLOAD_ORIGINAL', { documentId }, self),
        () => ({
          ok: false,
          code: 'step_up_required',
          message: 'this action requires reauthentication',
        }),
      ],
      [
        'step-up given',
        () =>
          gate(
            ownerId,
            'DOWNLOAD_ORIGINAL',
            { documentId },
            { purpose: 'self', stepUp: stepUpFor(ownerId, documentId) },
          ),
        () => allowed(ownerActor, 'DOWNLOAD_ORIGINAL', 'document'),
      ],
      [
        'more than one relationship',
        () => gate(f.bothId, 'VIEW_METADATA', { applicantId }, { purpose: 'visa-review' }),
        () => ({
          ok: false,
          code: 'invalid',
          message:
            'more than one relationship allows this; say which organization (or individual access) to act for',
        }),
      ],
      [
        'more than one relationship, individual chosen',
        () =>
          gate(
            f.bothId,
            'VIEW_METADATA',
            { applicantId },
            { purpose: 'visa-review', actingFor: 'individual' },
          ),
        () =>
          allowed(
            { kind: 'individual_recipient', accountId: f.bothId },
            'VIEW_METADATA',
            'applicant',
          ),
      ],
      [
        'staff scope with the role',
        async () => {
          const staffId = await account(db, `staff-${randomUUID()}@example.com`);
          const email = `staff-${staffId}@example.com`;
          const scope = await staffPrincipal(
            db,
            { accountId: staffId, email, bootstrapEmails: [email] },
            'PACK_MANAGE',
          );
          return scope.ok ? { ok: true, platformAction: scope.value.platformAction } : scope;
        },
        () => ({ ok: true, platformAction: 'PACK_MANAGE' }),
      ],
      [
        'staff scope without the role keeps its own words',
        async () => {
          const staffId = await account(db, `staff-${randomUUID()}@example.com`);
          const scope = await staffPrincipal(
            db,
            { accountId: staffId, email: 'x@example.com', bootstrapEmails: [] },
            'PACK_MANAGE',
          );
          return scope.ok
            ? scope
            : { ok: false, code: scope.error.code, message: scope.error.message };
        },
        () => ({
          ok: false,
          code: 'forbidden',
          message: 'this account does not hold the platform role required',
        }),
      ],
    ];
  }

  /** Every refusal of the first block, as rows, so other people's grants are checked on them too. */
  function refusalRows(): readonly Row[] {
    const refusedAnswer = { ok: false, code: 'not_found', message: 'record not found' };
    const gate = (
      accountId: string,
      action: PermissionAction,
      ref: ApplicantResourceRef,
      options: RequireAccessOptions,
    ) => requireAccess(world.db, accountPrincipal(accountId), action, ref, options).then(outcome);
    return [
      ...REFUSALS.flatMap((refusal) =>
        KINDS.map(
          (kind): Row => [
            `${refusal.name}, ${kind}`,
            () =>
              gate(
                refusal.account(world),
                'VIEW_METADATA',
                refusal.ref(world, kind),
                refusal.options(world),
              ),
            () => refusedAnswer,
          ],
        ),
      ),
    ];
  }

  async function results(): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const [, run] of [...rows(), ...refusalRows()]) out.push(await run());
    return out;
  }

  // Passes on the gate before this change too (the red proof runs it there): nothing allowed moved.
  it('gives every allowed path exactly its earlier result', async () => {
    for (const [name, run, expected] of rows()) {
      expect(await run(), name).toEqual(expected());
    }
  });

  it('gives the same results, and does the same work, once other people hold grants too', async () => {
    const before = await results();
    world.log.length = 0;
    await requireAccess(
      world.db,
      accountPrincipal(world.strangerId),
      'VIEW_METADATA',
      { missionId: world.missionId },
      self,
    );
    const workBefore = world.log.map((entry) => entry.sql);

    // Other people's grants on the same traveller: personal and agency, all cases and one case,
    // accepted and pending. None of them is for any caller in the rows above.
    const { db, ownerId, applicantId, missionId } = world;
    for (let i = 0; i < 3; i += 1) {
      const otherId = await account(db, `other-${i}-${randomUUID()}@example.com`);
      await accepted(
        db,
        {
          actorAccountId: ownerId,
          applicantId,
          recipientAccountId: otherId,
          actions: ['VIEW_METADATA', 'MANAGE'],
          purpose: 'visa-review',
        },
        otherId,
      );
      const otherOrgOwner = await account(db, `other-org-${i}-${randomUUID()}@example.com`);
      const otherOrg = await activeOrg(db, otherOrgOwner, `Other ${i}`);
      await accepted(
        db,
        {
          actorAccountId: ownerId,
          applicantId,
          recipientOrganizationId: otherOrg,
          missionId,
          actions: ['VIEW_METADATA'],
          purpose: 'visa-review',
        },
        otherOrgOwner,
      );
      const made = await createGrant(db, {
        actorAccountId: ownerId,
        applicantId,
        recipientOrganizationId: otherOrg,
        actions: ['PREVIEW'],
        purpose: 'pending',
      });
      if (!isOk(made)) throw new Error('pending grant');
    }

    expect(await results()).toEqual(before);
    world.log.length = 0;
    await requireAccess(
      world.db,
      accountPrincipal(world.strangerId),
      'VIEW_METADATA',
      { missionId: world.missionId },
      self,
    );
    expect(world.log.map((entry) => entry.sql)).toEqual(workBefore);
  });
});
