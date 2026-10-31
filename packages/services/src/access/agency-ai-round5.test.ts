import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENCY_AI_TOOLS } from '../ai-tools/agency-tools';
import { runAiTool } from '../ai-tools/index';
import type { Db } from '../db';
import { turnOffAgencyAiConnection } from './agency-ai-connections';
import {
  ADMIT,
  AGENCY_RESOURCE,
  agency,
  caseOf,
  connectAgency,
  enableAgencyAiTools,
  fact,
  said,
  shareWithAgency,
  traveller,
} from './agency-ai.test-support';

/**
 * S22 round 5 (review of round 4): the connection's own end checked first with every refusal
 * recorded, a re-check of the account that writes nothing, counting with no daily limit, and the
 * overage report for Agency AI Tools.
 */

const hooks = vi.hoisted(() => ({
  beforeCharge: null as null | (() => Promise<void>),
  chargeThrows: false,
  // As for an agency whose plan sets no daily limit (the default plan sets 500).
  noLimit: false,
}));

vi.mock('../ai-feature-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai-feature-settings')>();
  return {
    ...actual,
    openAiFeatureGate: async (...args: Parameters<typeof actual.openAiFeatureGate>) => {
      const gate = await actual.openAiFeatureGate(...args);
      return hooks.noLimit && gate.ok
        ? { ...gate, value: { ...gate.value, dailyLimit: null } }
        : gate;
    },
    chargeAiFeatureUse: async (...args: Parameters<typeof actual.chargeAiFeatureUse>) => {
      if (hooks.beforeCharge) await hooks.beforeCharge();
      if (hooks.chargeThrows) throw new Error('count broke');
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
  hooks.chargeThrows = false;
  hooks.noLimit = false;
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

function prepare(token: string, reference: string) {
  const tool = AGENCY_AI_TOOLS.find((item) => item.name === 'prepare_context');
  if (!tool) throw new Error('tool');
  return runAiTool(db, tool, { case_reference: reference } as never, {
    token,
    resource: AGENCY_RESOURCE,
    admission: ADMIT,
  });
}

function reported(errors: { mock: { calls: unknown[][] } }, event: string): number {
  return errors.mock.calls.filter((call) => String(call[0]).includes(event)).length;
}

describe('S22 round 5: the connection’s own end first, every refusal recorded', () => {
  it('records a connection turned off while the setting also went off as turned off, and answers unauthorized [break: check the setting first]', async () => {
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
      await db
        .update(schema.organizationAiSettings)
        .set({ aiConnectionsEnabled: false })
        .where(eq(schema.organizationAiSettings.organizationId, a.organizationId));
    };
    const outcome = await prepare(token, t.someCase.reference);
    expect(outcome.kind).toBe('unauthorized');
    expect(said(outcome.result)).not.toContain(GIVEN);
    const denied = await events('AI_CONTEXT_DENIED');
    expect(denied.map((e) => Reflect.get(Object(e.metadata), 'reason'))).toEqual([
      'agency_turned_off',
    ]);
  });

  it('re-checks the account without writing to it [break: touch the account in the re-check]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const old = new Date(Date.now() - 40 * DAY_MS);
    // After the first checks touched the account, it looks long idle again: only a re-check that
    // writes would touch it.
    hooks.beforeCharge = async () => {
      hooks.beforeCharge = null;
      await db
        .update(schema.accounts)
        .set({ lastActiveAt: old })
        .where(eq(schema.accounts.id, a.ownerId));
    };
    const outcome = await prepare(token, t.someCase.reference);
    expect(said(outcome.result)).toContain(GIVEN);
    const [account] = await db
      .select({ lastActiveAt: schema.accounts.lastActiveAt })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, a.ownerId));
    expect(account?.lastActiveAt.getTime()).toBe(old.getTime());
  });
});

describe('S22 round 5: counting with and without a daily limit', () => {
  it('answers and reports once when the count cannot be written and there is no limit, and fails closed with one [break: fail closed always]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hooks.chargeThrows = true;
    hooks.noLimit = true;
    const open = await prepare(token, t.someCase.reference);
    expect(open.kind).toBe('answered');
    expect(said(open.result)).toContain(GIVEN);
    expect(reported(errors, 'aiAgencyToolsCount')).toBe(1);

    hooks.noLimit = false;
    const closed = await prepare(token, t.someCase.reference);
    expect(closed.kind).toBe('failed');
    expect(said(closed.result)).not.toContain(GIVEN);
  });

  it('reports a limit saved while calls ran, once per agency and day [break: no report]', async () => {
    const a = await agency(db, 'owner-a@example.com', 'Harbor Visas');
    const t = await sharedTraveller('t1@example.com', a);
    const { token } = await connectAgency(db, a.organizationId, a.ownerId);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hooks.noLimit = true;
    // Each call starts with no limit; the platform owner saves a limit of 1 while it runs.
    const run = async () => {
      await enableAgencyAiTools(db, null);
      hooks.beforeCharge = async () => {
        hooks.beforeCharge = null;
        await enableAgencyAiTools(db, 1);
      };
      return prepare(token, t.someCase.reference);
    };
    expect(said((await run()).result)).toContain(GIVEN);
    expect(reported(errors, 'aiFeatureOverage')).toBe(0);
    expect(said((await run()).result)).toContain(GIVEN);
    expect(said((await run()).result)).toContain(GIVEN);
    expect(reported(errors, 'aiFeatureOverage')).toBe(1);
    const markers = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(
        and(
          eq(schema.rateLimitBuckets.subjectId, a.organizationId),
          eq(schema.rateLimitBuckets.action, 'ai_feature_overage:ai_agency_tools'),
        ),
      );
    expect(markers).toHaveLength(1);
  });
});
