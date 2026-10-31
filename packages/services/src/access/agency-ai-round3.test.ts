import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENCY_AI_TOOLS } from '../ai-tools/agency-tools';
import { runAiTool } from '../ai-tools/index';
import { MESSAGES } from '../ai-tools/result';
import type { Db } from '../db';
import { setMembershipActive } from '../organizations';
import { listAgencyAiConnections, turnOffAgencyAiConnection } from './agency-ai-connections';
import {
  ADMIT,
  AGENCY_RESOURCE,
  agency,
  callAgencyTool,
  caseOf,
  connectAgency,
  documentWithText,
  enableAgencyAiTools,
  fact,
  member,
  said,
  shareWithAgency,
  traveller,
} from './agency-ai.test-support';
import {
  auditAiAnswerWithheld,
  authenticateAiRequest,
  withAgencyAiConnection,
} from './with-ai-connection';

/**
 * S22 round 3 (code and security review): the member's standing checked again inside the work's
 * own transaction, every failure recorded, give-backs that never hide what happened, a withheld
 * answer given back, the ended list, a membership change that must succeed first, the true reason
 * in the audit, no tool call skipping the route's checks, and protected documents always closed
 * to agencies.
 */

const hooks = vi.hoisted(() => ({
  beforeCharge: null as null | (() => Promise<void>),
  gateThrows: false,
  chargeThrows: false,
  refundThrows: false,
}));

vi.mock('../ai-feature-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-feature-settings')>();
  return {
    ...actual,
    openAiFeatureGate: async (...args: Parameters<typeof actual.openAiFeatureGate>) => {
      if (hooks.gateThrows) throw new Error('gate broke');
      return actual.openAiFeatureGate(...args);
    },
    chargeAiFeatureUse: async (...args: Parameters<typeof actual.chargeAiFeatureUse>) => {
      if (hooks.chargeThrows) throw new Error('count broke');
      if (hooks.beforeCharge) await hooks.beforeCharge();
      return actual.chargeAiFeatureUse(...args);
    },
    refundAiFeatureUse: async (...args: Parameters<typeof actual.refundAiFeatureUse>) => {
      if (hooks.refundThrows) throw new Error('give-back broke');
      return actual.refundAiFeatureUse(...args);
    },
  };
});

const GIVEN = 'Nusrat';
const WORK_TEXT = 'Employment letter: senior engineer since 2019';
const VISA_TEXT = 'Visa sticker: multiple entry, valid to 2027';
const PASSPORT_TEXT = 'Passport number BX0099887';

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  await enableAgencyAiTools(db);
});
afterEach(() => {
  hooks.beforeCharge = null;
  hooks.gateThrows = false;
  hooks.chargeThrows = false;
  hooks.refundThrows = false;
  vi.restoreAllMocks();
});

async function sharedTraveller(
  email: string,
  organization: { ownerId: string; organizationId: string },
) {
  const t = await traveller(db, email);
  await fact(db, t.ownerId, t.applicantId, 'given_name', GIVEN, 'universal');
  const someCase = await caseOf(db, t.ownerId, t.applicantId, 'London Trip');
  await shareWithAgency(db, { ...t, organization, ai: true });
  return { ...t, someCase };
}

async function events(eventType: string) {
  return db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, eventType))
    .orderBy(asc(schema.auditEvents.seq));
}

async function todayCount(organizationId: string): Promise<number> {
  const [bucket] = await db
    .select({ count: schema.rateLimitBuckets.count })
    .from(schema.rateLimitBuckets)
    .where(
      and(
        eq(schema.rateLimitBuckets.subjectId, organizationId),
        eq(schema.rateLimitBuckets.action, 'ai_feature.ai_agency_tools'),
      ),
    );
  return bucket?.count ?? 0;
}

function tool(name: (typeof AGENCY_AI_TOOLS)[number]['name']) {
  const found = AGENCY_AI_TOOLS.find((item) => item.name === name);
  if (!found) throw new Error(name);
  return found;
}

describe('S22 round 3: the standing is checked again inside the work', () => {
  it('refuses a call when Turn Off committed after the first checks and before the work [break: skip the second check]', async () => {
    await enableAgencyAiTools(db, 5);
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    hooks.beforeCharge = async () => {
      hooks.beforeCharge = null;
      const off = await turnOffAgencyAiConnection(db, {
        organizationId: a.organizationId,
        accountId: a.ownerId,
        connectionId,
      });
      if (!isOk(off)) throw new Error('turn off');
    };
    const outcome = await runAiTool(
      db,
      tool('prepare_context'),
      { case_reference: t.someCase.reference } as never,
      { token, resource: AGENCY_RESOURCE, admission: ADMIT },
    );
    expect(outcome.kind).toBe('unauthorized');
    expect(said(outcome.result)).not.toContain(GIVEN);
    expect(await events('AI_CONTEXT_SERVED')).toHaveLength(0);
    const denied = await events('AI_CONTEXT_DENIED');
    expect(denied).toHaveLength(1);
    // Round 4: recorded with the reason stored when it was turned off.
    expect(denied[0]?.metadata).toMatchObject({
      reason: 'agency_turned_off',
      organizationId: a.organizationId,
    });
    // The charge is given back.
    expect(await todayCount(a.organizationId)).toBe(0);
  });
});

describe('S22 round 3: every failure is recorded and give-backs never hide it', () => {
  it('records a failed call with the agency when the checks or the count throw', async () => {
    await enableAgencyAiTools(db, 5);
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const call = () =>
      runAiTool(db, tool('prepare_context'), { case_reference: t.someCase.reference } as never, {
        token,
        resource: AGENCY_RESOURCE,
        admission: ADMIT,
      });
    hooks.gateThrows = true;
    expect((await call()).kind).toBe('failed');
    hooks.gateThrows = false;
    hooks.chargeThrows = true;
    expect((await call()).kind).toBe('failed');
    const failed = await events('AI_CONTEXT_DENIED');
    expect(failed).toHaveLength(2);
    for (const record of failed) {
      expect(record.metadata).toMatchObject({
        reason: 'failed',
        connectionKind: 'AGENCY',
        organizationId: a.organizationId,
      });
    }
  });

  it('keeps the real error and the failed records when giving the count back throws', async () => {
    await enableAgencyAiTools(db, 5);
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hooks.refundThrows = true;
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
    expect(failed[0]?.metadata).toMatchObject({ reason: 'failed' });

    // A refusal still answers with its plain words.
    const refused = await callAgencyTool(db, token, 'prepare_context', {
      case_reference: 'C-Z9Z9Z9',
    });
    expect(refused.kind).toBe('answered');
    expect(refused.result.isError).toBe(true);
    expect(refused.text).not.toContain('give-back');
    expect(errors.mock.calls.flat().join(' ')).toContain('aiAgencyToolsGiveBack');
  });
});

describe('S22 round 3: an answer withheld as too large is free', () => {
  it('gives the call back once, however many times it is reported', async () => {
    await enableAgencyAiTools(db, 5);
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await sharedTraveller('t1@example.com', a);
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    const list = (callId: string) =>
      runAiTool(db, tool('list_cases'), {} as never, {
        token,
        resource: AGENCY_RESOURCE,
        admission: ADMIT,
        callId,
      });
    const first = '11111111-2222-4333-8444-555555555555';
    const second = '11111111-2222-4333-8444-666666666666';
    expect((await list(first)).kind).toBe('answered');
    expect((await list(second)).kind).toBe('answered');
    expect(await todayCount(a.organizationId)).toBe(2);
    await auditAiAnswerWithheld(db, { connectionId, tool: 'list_cases', callId: first });
    expect(await todayCount(a.organizationId)).toBe(1);
    await auditAiAnswerWithheld(db, { connectionId, tool: 'list_cases', callId: first });
    expect(await todayCount(a.organizationId)).toBe(1);
  });
});

describe('S22 round 3: the ended list', () => {
  it('lists a long-lived connection turned off today first among the ended ones', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const { connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    await db
      .update(schema.aiConnections)
      .set({ createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.aiConnections.id, connectionId));
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (let i = 0; i < 12; i++) {
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
            activatedAt: hourAgo,
            revokedAt: hourAgo,
          })
          .returning({ id: schema.aiConnections.id });
        if (!row) throw new Error('row');
        await tx
          .insert(schema.aiConnectionAgencies)
          .values({ connectionId: row.id, organizationId: a.organizationId });
      });
    }
    const off = await turnOffAgencyAiConnection(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
      connectionId,
    });
    expect(isOk(off)).toBe(true);
    const listed = await listAgencyAiConnections(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
    });
    if (!isOk(listed)) throw new Error('list');
    const ended = listed.value.connections.filter((c) => !c.live);
    expect(ended).toHaveLength(10);
    expect(ended[0]?.id).toBe(connectionId);
  });
});

describe('S22 round 3: a membership change must succeed before anything else', () => {
  it('ends nothing and records nothing when the membership is gone by the time it is changed [break: end connections first]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { connectionId } = await connectAgency(db, a.organizationId, admin.accountId);
    // The membership row refuses the change, as if it vanished after it was read.
    await db.execute(sql`
      create function round3_skip_membership_update() returns trigger language plpgsql as $$
      begin return null; end $$`);
    await db.execute(sql`
      create trigger round3_skip_membership_update before update on memberships
      for each row execute function round3_skip_membership_update()`);
    const off = await setMembershipActive(db, {
      actorAccountId: a.ownerId,
      organizationId: a.organizationId,
      membershipId: admin.membershipId,
      active: false,
    });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error.code).toBe('not_found');
    const [connection] = await db
      .select({ revokedAt: schema.aiConnections.revokedAt })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(connection?.revokedAt).toBeNull();
    expect(await events('AI_CONNECTION_REVOKED')).toHaveLength(0);
    expect(await events('MEMBERSHIP_DEACTIVATED')).toHaveLength(0);
  });
});

describe('S22 round 3: the true reason stays in the audit', () => {
  it('gives the app the same answer for a document not shared and one with no text, and records which', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await traveller(db, 't1@example.com');
    await fact(db, t.ownerId, t.applicantId, 'given_name', GIVEN, 'universal');
    const someCase = await caseOf(db, t.ownerId, t.applicantId, 'London Trip');
    const work = await documentWithText(db, t.applicantId, 'EMPLOYMENT_CERTIFICATE', WORK_TEXT);
    // A shared document whose text was never read.
    const visa = await documentWithText(db, t.applicantId, 'VISA', VISA_TEXT);
    await db.delete(schema.ocrRuns).where(eq(schema.ocrRuns.extractedText, VISA_TEXT));
    await shareWithAgency(db, { ...t, organization: a, ai: true, categories: ['universal'] });
    await shareWithAgency(db, { ...t, organization: a, ai: true, missionId: someCase.missionId });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const read = (reference: string) =>
      callAgencyTool(db, token, 'get_document_text', {
        case_reference: someCase.reference,
        document_reference: reference,
      });
    const notShared = await read(work.reference);
    const noText = await read(visa.reference);
    expect(said(notShared.result)).not.toContain(WORK_TEXT);
    expect(notShared.text).toBe(MESSAGES.agencyNoText);
    expect(said(notShared.result)).toBe(said(noText.result));
    const denied = await events('AI_CONTEXT_DENIED');
    expect(denied.map((e) => Reflect.get(Object(e.metadata), 'reason'))).toEqual([
      'document_not_shared',
      'no_text',
    ]);
    expect(denied[0]?.metadata).toMatchObject({ notGranted: 1 });
    expect(denied[1]?.metadata).toMatchObject({ notGranted: 0 });
  });
});

describe('S22 round 3: no tool call skips the route checks', () => {
  it('checks a removed member in full unless the call is a valid agency tool call', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { token } = await connectAgency(db, a.organizationId, admin.accountId);
    await db
      .update(schema.memberships)
      .set({ active: false })
      .where(eq(schema.memberships.id, admin.membershipId));
    const base = { token, resource: AGENCY_RESOURCE, admission: ADMIT };
    expect(await authenticateAiRequest(db, base)).toBeNull();
    expect(await authenticateAiRequest(db, { ...base, agencyToolCall: false })).toBeNull();
    // A valid agency tool call is checked by the agency gate on the call itself, which refuses it.
    expect(await authenticateAiRequest(db, { ...base, agencyToolCall: true })).not.toBeNull();
    const outcome = await runAiTool(db, tool('list_cases'), {} as never, base);
    expect(outcome.kind).toBe('unauthorized');
  });
});

describe('S22 round 3: protected documents stay closed to agencies', () => {
  it('keeps a passport closed to an agency even when a switch opens the type [break: follow the switches for agencies]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await traveller(db, 't1@example.com');
    const someCase = await caseOf(db, t.ownerId, t.applicantId, 'London Trip');
    const passport = await documentWithText(db, t.applicantId, 'PASSPORT', PASSPORT_TEXT);
    await shareWithAgency(db, { ...t, organization: a, ai: true });
    await db
      .insert(schema.documentProtectionSettings)
      .values({ scope: 'DOCUMENT_TYPE', key: 'PASSPORT', restricted: false });
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const read = await callAgencyTool(db, token, 'get_document_text', {
      case_reference: someCase.reference,
      document_reference: passport.reference,
    });
    expect(said(read.result)).not.toContain(PASSPORT_TEXT);
    expect(read.text).toBe(MESSAGES.documentProtected);
  });
});
