import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAiConnectionCounts } from '../ai-connection-counts';
import { AI_TOOLS, runAiTool } from '../ai-tools/index';
import { MESSAGES } from '../ai-tools/result';
import type { Db } from '../db';
import { hashInvitationToken } from '../invitation-tokens';
import { acceptOrganizationInvitation } from '../invitations';
import { setMembershipActive } from '../organizations';
import { seedStaffAccount, staffScopeFor } from '../platform-roles.test-support';
import { listAgencyAiConnections } from './agency-ai-connections';
import {
  ADMIT,
  AGENCY_RESOURCE,
  agency,
  callAgencyTool,
  caseOf,
  connectAgency,
  connectOwner,
  documentWithText,
  enableAgencyAiTools,
  fact,
  member,
  said,
  shareWithAgency,
  traveller,
} from './agency-ai.test-support';
import { auditAiAnswerWithheld } from './with-ai-connection';

/**
 * S22 round 2 (code and security review): what an agency's AI app may infer, the agency's list of
 * connections, ending connections when a member leaves or is moved out of owner and admin, a full
 * audit trail for withheld and failed answers, counting calls, and the daily count.
 */

const GIVEN = 'Nusrat';
const TAX_ZONE = 'Zone Nine';
const WORK_TEXT = 'Employment letter: senior engineer since 2019';

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  await enableAgencyAiTools(db);
});

function field(result: { readonly structuredContent?: object }, key: string): unknown {
  return result.structuredContent ? Reflect.get(result.structuredContent, key) : undefined;
}

async function sharedTraveller(
  email: string,
  organization: { ownerId: string; organizationId: string },
) {
  const t = await traveller(db, email);
  await fact(db, t.ownerId, t.applicantId, 'given_name', GIVEN, 'universal');
  await fact(db, t.ownerId, t.applicantId, 'tax_zone', TAX_ZONE, 'business');
  const someCase = await caseOf(db, t.ownerId, t.applicantId, 'London Trip');
  const work = await documentWithText(db, t.applicantId, 'EMPLOYMENT_CERTIFICATE', WORK_TEXT);
  return { ...t, someCase, work, organization };
}

async function events(eventType: string) {
  return db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, eventType))
    .orderBy(asc(schema.auditEvents.seq));
}

describe('S22 round 2: the agency AI app learns nothing about what was withheld', () => {
  it('gives no count of what the traveller did not share, in context, lists and single documents', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    await shareWithAgency(db, { ...t, organization: a, ai: true, categories: ['universal'] });
    await shareWithAgency(db, { ...t, organization: a, ai: true, missionId: t.someCase.missionId });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);

    const context = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.someCase.reference,
    });
    expect(said(context.result)).toContain(GIVEN);
    expect(said(context.result)).not.toContain(TAX_ZONE);
    expect(Reflect.get(Object(field(context.result, 'omitted')), 'not_granted') ?? 0).toBe(0);

    const documents = await callAgencyTool(db, token, 'list_documents', {
      case_reference: t.someCase.reference,
    });
    expect(field(documents.result, 'documents')).toEqual([]);
    expect(Reflect.get(Object(field(documents.result, 'omitted')), 'not_granted')).toBe(0);

    const text = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: t.someCase.reference,
      document_reference: t.work.reference,
    });
    expect(text.text).toBe(MESSAGES.agencyNoText);
    expect(said(text.result)).not.toContain(WORK_TEXT);
  });
});

describe('S22 round 2: the agency list of AI connections', () => {
  it('lists every live connection, with 60 newer abandoned or ended ones beside it', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const { connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    await db
      .update(schema.aiConnections)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.aiConnections.id, connectionId));
    for (let i = 0; i < 60; i++) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.aiConnections)
          .values({
            accountId: a.ownerId,
            applicantId: null,
            clientId: 'https://claude.ai/meta',
            clientName: 'Claude',
            clientHost: 'claude.ai',
            caseMode: 'ALL_CURRENT',
            // Half never finished connecting; half were turned off.
            activatedAt: i % 2 === 0 ? null : new Date(),
            revokedAt: i % 2 === 0 ? null : new Date(),
          })
          .returning({ id: schema.aiConnections.id });
        if (!row) throw new Error('row');
        await tx
          .insert(schema.aiConnectionAgencies)
          .values({ connectionId: row.id, organizationId: a.organizationId });
      });
    }
    const listed = await listAgencyAiConnections(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
    });
    if (!isOk(listed)) throw new Error('list');
    const live = listed.value.connections.filter((c) => c.live);
    expect(live.map((c) => c.id)).toEqual([connectionId]);
    expect(listed.value.connections[0]?.id).toBe(connectionId);
    expect(listed.value.connections.filter((c) => !c.live)).toHaveLength(10);
  });
});

describe('S22 round 2: a member leaving or moved out of owner and admin', () => {
  it('ends their connections before the membership record, when turned off', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { connectionId } = await connectAgency(db, a.organizationId, admin.accountId);
    const off = await setMembershipActive(db, {
      actorAccountId: a.ownerId,
      organizationId: a.organizationId,
      membershipId: admin.membershipId,
      active: false,
    });
    expect(isOk(off)).toBe(true);
    const revoked = await events('AI_CONNECTION_REVOKED');
    const deactivated = await events('MEMBERSHIP_DEACTIVATED');
    expect(revoked.map((e) => e.resourceId)).toEqual([connectionId]);
    expect(revoked[0]?.metadata).toMatchObject({ reason: 'agency_member_removed' });
    expect(Number(revoked[0]?.seq)).toBeLessThan(Number(deactivated[0]?.seq));
  });

  it('ends their connections, with their own record, when an invitation moves them to case manager', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { connectionId, token } = await connectAgency(db, a.organizationId, admin.accountId);
    const raw = 'demotion-invitation-token';
    await db.insert(schema.organizationInvitations).values({
      organizationId: a.organizationId,
      email: 'admin@example.com',
      role: 'CASE_MANAGER',
      tokenHash: hashInvitationToken(raw),
      invitedByAccountId: a.ownerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const accepted = await acceptOrganizationInvitation(db, {
      actorAccountId: admin.accountId,
      actorEmail: 'admin@example.com',
      rawToken: raw,
    });
    expect(isOk(accepted)).toBe(true);
    const revoked = await events('AI_CONNECTION_REVOKED');
    expect(revoked.map((e) => e.resourceId)).toEqual([connectionId]);
    expect(revoked[0]?.metadata).toMatchObject({ reason: 'agency_member_role_changed' });
    const [accept] = await events('ORGANIZATION_INVITATION_ACCEPTED');
    expect(Number(revoked[0]?.seq)).toBeLessThan(Number(accept?.seq));
    expect((await callAgencyTool(db, token, 'list_cases', {})).kind).toBe('unauthorized');
  });
});

describe('S22 round 2: the audit trail and the counts', () => {
  it('records a withheld answer on every traveller the call reached, with the agency, and counts the call once', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    for (let i = 0; i < 30; i++) {
      const t = await traveller(db, `traveller-${i}@example.com`);
      await caseOf(db, t.ownerId, t.applicantId, `Trip ${i}`);
      await shareWithAgency(db, { ...t, organization: a, ai: true });
    }
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    const { AGENCY_AI_TOOLS } = await import('../ai-tools/agency-tools');
    const listCases = AGENCY_AI_TOOLS.find((item) => item.name === 'list_cases');
    if (!listCases) throw new Error('agency tool');
    const callId = '11111111-2222-4333-8444-555555555555';
    const outcome = await runAiTool(db, listCases, {} as never, {
      token,
      resource: AGENCY_RESOURCE,
      admission: ADMIT,
      callId,
    });
    expect(outcome.kind).toBe('answered');
    const served = await events('AI_CONTEXT_SERVED');
    expect(served).toHaveLength(30);
    expect(new Set(served.map((e) => Reflect.get(Object(e.metadata), 'callId')))).toEqual(
      new Set([callId]),
    );
    // The route withholds the answer as too large.
    await auditAiAnswerWithheld(db, { connectionId, tool: 'list_cases', callId });
    const withheld = await events('AI_CONTEXT_DENIED');
    expect(withheld).toHaveLength(30);
    expect(new Set(withheld.map((e) => e.applicantId))).toEqual(
      new Set(served.map((e) => e.applicantId)),
    );
    for (const record of withheld) {
      expect(record.metadata).toMatchObject({
        reason: 'too_large',
        withheld: true,
        connectionKind: 'AGENCY',
        organizationId: a.organizationId,
        callId,
      });
    }
    const staff = await staffScopeFor(
      db,
      await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com'),
      'AI_SETTINGS_MANAGE',
    );
    const counts = await getAiConnectionCounts(db, staff);
    // One call, withheld: nothing answered, one refused.
    expect(counts).toMatchObject({ ok: true, value: { served: 0, denied: 1 } });
  });

  it('counts one answered call once however many travellers it names', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    for (let i = 0; i < 30; i++) {
      const t = await traveller(db, `traveller-${i}@example.com`);
      await caseOf(db, t.ownerId, t.applicantId, `Trip ${i}`);
      await shareWithAgency(db, { ...t, organization: a, ai: true });
    }
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    await callAgencyTool(db, token, 'list_cases', {});
    const staff = await staffScopeFor(
      db,
      await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com'),
      'AI_SETTINGS_MANAGE',
    );
    expect(await getAiConnectionCounts(db, staff)).toMatchObject({
      ok: true,
      value: { served: 1, denied: 0 },
    });
  });

  it('records the depth served on an agency read', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    await callAgencyTool(db, token, 'prepare_context', {
      case_reference: t.someCase.reference,
      depth: 'brief',
    });
    const [served] = await events('AI_CONTEXT_SERVED');
    expect(served?.metadata).toMatchObject({ depth: 'brief' });
  });

  it('records a call that fails part-way on the traveller it reached, with the agency', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const { withAgencyAiConnection } = await import('./with-ai-connection');
    await expect(
      withAgencyAiConnection(
        db,
        { token, resource: AGENCY_RESOURCE, tool: 'prepare_context', admission: ADMIT },
        async (gateway) => {
          await gateway.compose(t.someCase.reference);
          throw new Error('broke after reading');
        },
        () => ({ kind: 'denied', reason: 'failed' }),
      ),
    ).rejects.toThrow('broke after reading');
    const failed = await events('AI_CONTEXT_DENIED');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.applicantId).toBe(t.applicantId);
    expect(failed[0]?.metadata).toMatchObject({
      reason: 'failed',
      connectionKind: 'AGENCY',
      organizationId: a.organizationId,
    });
    // A failed call gives its count back.
    const [bucket] = await db
      .select({ count: schema.rateLimitBuckets.count })
      .from(schema.rateLimitBuckets)
      .where(
        and(
          eq(schema.rateLimitBuckets.subjectId, a.organizationId),
          eq(schema.rateLimitBuckets.action, 'ai_feature.ai_agency_tools'),
        ),
      );
    expect(bucket?.count ?? 0).toBe(0);
  });

  it('records a refused tool call for the agency in one direction and on the owner’s record in the other', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    const agencyToken = (await connectAgency(db, a.organizationId, a.ownerId)).token;
    const ownerTool = AI_TOOLS.find((item) => item.name === 'get_profile_section');
    if (!ownerTool) throw new Error('tool');
    const refused = await runAiTool(db, ownerTool, { section: 'identity' } as never, {
      token: agencyToken,
      resource: AGENCY_RESOURCE,
      admission: ADMIT,
    });
    expect(refused.kind).toBe('unauthorized');
    const [forAgency] = await events('AI_CONTEXT_DENIED');
    expect(forAgency?.applicantId).toBeNull();
    expect(forAgency?.metadata).toMatchObject({
      reason: 'tool_not_offered',
      connectionKind: 'AGENCY',
      organizationId: a.organizationId,
    });

    // An owner token on an agency tool: recorded on the owner's own record.
    const ownerToken = await connectOwner(db, t.ownerId, t.applicantId);
    const back = await callAgencyTool(db, ownerToken, 'list_cases', {});
    expect(back.kind).toBe('unauthorized');
    const denied = await events('AI_CONTEXT_DENIED');
    const onOwner = denied.find((e) => e.applicantId === t.applicantId);
    expect(onOwner?.metadata).toMatchObject({ reason: 'tool_not_offered' });
    expect(Reflect.get(Object(onOwner?.metadata), 'connectionKind')).toBeUndefined();
  });

  it('keeps the agency count exact, charged in its own statement and given back when refused', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    await enableAgencyAiTools(db, 3);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const read = (reference: string) =>
      callAgencyTool(db, token, 'prepare_context', { case_reference: reference });
    expect(said((await read(t.someCase.reference)).result)).toContain(GIVEN);
    // A refused call is given back.
    expect((await read('C-Z9Z9Z9')).result.isError).toBe(true);
    expect(said((await read(t.someCase.reference)).result)).toContain(GIVEN);
    expect(said((await read(t.someCase.reference)).result)).toContain(GIVEN);
    expect((await read(t.someCase.reference)).text).toBe(MESSAGES.agencyLimit);
    const [bucket] = await db
      .select({ count: schema.rateLimitBuckets.count })
      .from(schema.rateLimitBuckets)
      .where(
        and(
          eq(schema.rateLimitBuckets.subjectId, a.organizationId),
          eq(schema.rateLimitBuckets.action, 'ai_feature.ai_agency_tools'),
        ),
      );
    expect(bucket?.count).toBe(3);
  });
});
