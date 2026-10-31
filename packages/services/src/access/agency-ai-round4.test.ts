import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENCY_AI_TOOLS } from '../ai-tools/agency-tools';
import { runAiTool } from '../ai-tools/index';
import type { Db } from '../db';
import { setMembershipActive } from '../organizations';
import { listAgencyAiConnections, turnOffAgencyAiConnection } from './agency-ai-connections';
import {
  AGENCY_RESOURCE,
  agency,
  caseOf,
  connectAgency,
  enableAgencyAiTools,
  fact,
  member,
  said,
  shareWithAgency,
  traveller,
} from './agency-ai.test-support';
import { resolveAiAccessToken } from './ai-connection';
import { auditAiAnswerWithheld } from './with-ai-connection';

/**
 * S22 round 4 (re-review of round 3): give back only what a call was charged, the true reason when
 * standing changes during a call, the account's admission checked again, a last-used touch that
 * never waits, and turn-off times only on connections still live.
 */

const hooks = vi.hoisted(() => ({
  beforeCharge: null as null | (() => Promise<void>),
  uncounted: false,
}));

vi.mock('../ai-feature-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-feature-settings')>();
  return {
    ...actual,
    chargeAiFeatureUse: async (...args: Parameters<typeof actual.chargeAiFeatureUse>) => {
      if (hooks.beforeCharge) await hooks.beforeCharge();
      // As for a call nothing was counted for (the count kept its own way).
      if (hooks.uncounted) return Object.freeze({ feature: args[1].feature, counted: false });
      return actual.chargeAiFeatureUse(...args);
    },
  };
});

const GIVEN = 'Nusrat';
const DAY_MS = 24 * 60 * 60 * 1000;

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  await enableAgencyAiTools(db);
});
afterEach(() => {
  hooks.beforeCharge = null;
  hooks.uncounted = false;
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

const ADMITTED = { suspended: false };
const admission = async () => !ADMITTED.suspended;

describe('S22 round 4: a withheld answer gives back only what the call was charged', () => {
  it('counts every agency call before the work and gives a withheld one back', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await sharedTraveller('t1@example.com', a);
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    const callId = '21111111-2222-4333-8444-555555555555';
    const outcome = await runAiTool(db, tool('list_cases'), {} as never, {
      token,
      resource: AGENCY_RESOURCE,
      admission,
      callId,
    });
    expect(outcome.kind).toBe('answered');
    expect(await todayCount(a.organizationId)).toBe(1);
    await auditAiAnswerWithheld(db, { connectionId, tool: 'list_cases', callId });
    expect(await todayCount(a.organizationId)).toBe(0);
  });

  it('gives nothing back for a call that was not counted [break: mark every served record counted]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    await sharedTraveller('t1@example.com', a);
    const { token, connectionId } = await connectAgency(db, a.organizationId, a.ownerId);
    // Other calls today, counted.
    await db.insert(schema.rateLimitBuckets).values({
      subjectId: a.organizationId,
      action: 'ai_feature.ai_agency_tools',
      windowStart: new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS),
      count: 3,
    });
    hooks.uncounted = true;
    const callId = '21111111-2222-4333-8444-666666666666';
    const outcome = await runAiTool(db, tool('list_cases'), {} as never, {
      token,
      resource: AGENCY_RESOURCE,
      admission,
      callId,
    });
    expect(outcome.kind).toBe('answered');
    const served = await events('AI_CONTEXT_SERVED');
    expect(served.length).toBeGreaterThan(0);
    for (const record of served)
      expect(Reflect.get(Object(record.metadata), 'countDay')).toBeUndefined();
    await auditAiAnswerWithheld(db, { connectionId, tool: 'list_cases', callId });
    expect(await todayCount(a.organizationId)).toBe(3);
  });
});

describe('S22 round 4: standing changed during a call', () => {
  it('records a member removed during the call as ended, not as an expired connection [break: read the turn-off first]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const { token } = await connectAgency(db, a.organizationId, admin.accountId);
    hooks.beforeCharge = async () => {
      hooks.beforeCharge = null;
      const off = await setMembershipActive(db, {
        actorAccountId: a.ownerId,
        organizationId: a.organizationId,
        membershipId: admin.membershipId,
        active: false,
      });
      if (!isOk(off)) throw new Error('member off');
    };
    const outcome = await runAiTool(
      db,
      tool('prepare_context'),
      { case_reference: t.someCase.reference } as never,
      { token, resource: AGENCY_RESOURCE, admission },
    );
    expect(outcome.kind).toBe('unauthorized');
    expect(said(outcome.result)).not.toContain(GIVEN);
    const denied = await events('AI_CONTEXT_DENIED');
    expect(denied).toHaveLength(1);
    expect(denied[0]?.metadata).toMatchObject({ reason: 'agency_member_ended' });
    expect(await todayCount(a.organizationId)).toBe(0);
  });

  it('refuses a call when the account is suspended between the checks and the work [break: skip the admission re-check]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    hooks.beforeCharge = async () => {
      hooks.beforeCharge = null;
      ADMITTED.suspended = true;
    };
    try {
      const outcome = await runAiTool(
        db,
        tool('prepare_context'),
        { case_reference: t.someCase.reference } as never,
        { token, resource: AGENCY_RESOURCE, admission },
      );
      expect(outcome.kind).toBe('unauthorized');
      expect(said(outcome.result)).not.toContain(GIVEN);
      expect(await events('AI_CONTEXT_SERVED')).toHaveLength(0);
      expect(await todayCount(a.organizationId)).toBe(0);
    } finally {
      ADMITTED.suspended = false;
    }
  });
});

describe('S22 round 4: the last-used touch never waits', () => {
  it('touches the row only when it can be locked at once [break: a plain update]', async () => {
    const statements: string[] = [];
    const client = await createMigratedPglite();
    const logged = drizzle(client, {
      schema,
      logger: { logQuery: (query: string) => statements.push(query.toLowerCase()) },
    }) as unknown as Db;
    await enableAgencyAiTools(logged);
    const a = await agency(logged, 'owner-a@example.com', 'Harbor Visas');
    const { token, connectionId } = await connectAgency(logged, a.organizationId, a.ownerId);
    statements.length = 0;
    const resolved = await resolveAiAccessToken(logged, { token, resource: AGENCY_RESOURCE });
    expect(resolved?.connectionId).toBe(connectionId);
    // PGlite has one connection, so a lock held by another call cannot be staged here; the
    // statement itself is checked: the touch locks the row only if no one holds it, else skips.
    const touch = statements.find((q) => q.startsWith('update "ai_connections"'));
    expect(touch).toContain('for update skip locked');
    const [row] = await logged
      .select({ lastUsedAt: schema.aiConnections.lastUsedAt })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(row?.lastUsedAt).not.toBeNull();
  });
});

describe('S22 round 4: turn-off times only on connections still live', () => {
  it('keeps a connection turned off yesterday in the ended list after a member with many long-ended connections is turned off [break: stamp every connection]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const admin = await member(db, a, 'admin@example.com', 'ADMIN');
    const insert = async (accountId: string, values: { createdAt: Date; revokedAt: Date | null }) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.aiConnections)
          .values({
            accountId,
            applicantId: null,
            clientId: 'https://claude.ai/meta',
            clientName: 'Claude',
            clientHost: 'claude.ai',
            caseMode: 'ALL_CURRENT',
            activatedAt: values.createdAt,
            createdAt: values.createdAt,
            revokedAt: values.revokedAt,
            ...(values.revokedAt ? { revokedReason: 'turned off by agency' } : {}),
          })
          .returning({ id: schema.aiConnections.id });
        if (!row) throw new Error('row');
        await tx
          .insert(schema.aiConnectionAgencies)
          .values({ connectionId: row.id, organizationId: a.organizationId });
        return row.id;
      });
    const expired: string[] = [];
    for (let i = 0; i < 12; i++) {
      expired.push(
        await insert(admin.accountId, {
          createdAt: new Date(Date.now() - (40 + i) * DAY_MS),
          revokedAt: null,
        }),
      );
    }
    const yesterday = await insert(a.ownerId, {
      createdAt: new Date(Date.now() - 3 * DAY_MS),
      revokedAt: new Date(Date.now() - DAY_MS),
    });
    const off = await setMembershipActive(db, {
      actorAccountId: a.ownerId,
      organizationId: a.organizationId,
      membershipId: admin.membershipId,
      active: false,
    });
    expect(isOk(off)).toBe(true);
    // A long-ended connection keeps no turn-off time and gets no turn-off record.
    const stamped = await db
      .select({ id: schema.aiConnections.id, revokedAt: schema.aiConnections.revokedAt })
      .from(schema.aiConnections);
    for (const row of stamped.filter((r) => expired.includes(r.id))) {
      expect(row.revokedAt).toBeNull();
    }
    expect(await events('AI_CONNECTION_REVOKED')).toHaveLength(0);
    const listed = await listAgencyAiConnections(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
    });
    if (!isOk(listed)) throw new Error('list');
    const ended = listed.value.connections.filter((c) => !c.live);
    expect(ended[0]?.id).toBe(yesterday);
    // Turning off one that already ended says it was already off.
    const again = await turnOffAgencyAiConnection(db, {
      organizationId: a.organizationId,
      accountId: a.ownerId,
      connectionId: expired[0] ?? '',
    });
    expect(isOk(again) && again.value.alreadyOff).toBe(true);
  });
});
