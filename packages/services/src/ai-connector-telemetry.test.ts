import { createHash, randomBytes } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { fieldPolicyOf } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, inArray, like, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAiConnection,
  exchangeAiAuthorizationCode,
  refreshAiTokens,
  resolveAiAccessToken,
  revokeAiToken,
} from './access/ai-connection';
import { changeAiConnection, turnOffAiConnection } from './access/ai-connection-manage';
import { type StaffScope, accountPrincipal, staffPrincipal } from './access/principal';
import { requireAccess } from './access/require-access';
import { verifyStepUp } from './access/step-up-proof';
import { auditAiAnswerWithheld } from './access/with-ai-connection';
import { provisionAccount } from './accounts';
import { getAiConnectionCounts } from './ai-connection-counts';
import type { AiConnectionChoices } from './ai-connection-scopes';
import { AI_TOOLS, runAiTool } from './ai-tools';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission, createTask } from './missions';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';
import type { KeyManagementPort } from './ports';
import { resetProductEventLogForTests } from './product-events';
import { editFact, registerFieldDefinition } from './profile';
import { requiresProtection, resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { assignReferenceCode, referenceCodesFor } from './reference-codes';
import { issueStepUpAssurance } from './step-up';

/**
 * S16 acceptance (ADR 0021 section 7): every AI audit event and every AI product event is driven
 * through the real code paths with recognisable made-up values, and none of those values reaches
 * stored audit metadata, a product event, or anything written to the console.
 */

// Made-up, recognisable values. Each one is seeded so the test can prove it never leaks.
const PASSPORT_NUMBER = 'QZ7731905';
const TASK_TEXT = 'Sentinel task: wire the deposit to cousin Rafiq before Friday';
const DOCUMENT_TEXT = 'Sentinel vignette text: multiple entry, reference 88213-KESTREL';
const RESOURCE = 'https://vs.example.test/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const STEP_UP_SECRET = 'synthetic-step-up-secret-for-tests-only-0123456789';
const ADMIT = async () => true;
const CLIENT = {
  clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
  clientName: 'Claude',
  clientHost: 'claude.ai',
};

const keys: KeyManagementPort = (() => {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      return {
        keyVersion: 'test-v1',
        plaintextDataKey: randomBytes(32),
        wrappedDataKey: masterKey,
      };
    },
    async unwrapDataKey() {
      return masterKey;
    },
  };
})();

const tool = (name: string) => {
  const found = AI_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(name);
  return found;
};

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  resetProtectedFieldKeyCacheForTests();
  resetProductEventLogForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Everything written to the console while `work` runs, as text. */
async function consoleDuring<T>(work: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(
      args
        .map((arg) =>
          arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : JSON.stringify(arg),
        )
        .join(' '),
    );
  };
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation(capture);
  }
  try {
    const value = await work();
    return { value, logged: lines.join('\n') };
  } finally {
    vi.restoreAllMocks();
  }
}

async function seed() {
  const provisioned = await provisionAccount(db, { email: 'owner@example.com' });
  if (!isOk(provisioned)) throw new Error('provision');
  const ownerId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: ownerId,
    accountId: ownerId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  for (const [fieldKey, value] of [
    ['given_name', 'Nusrat'],
    ['passport_number', PASSPORT_NUMBER],
    ['passport_expiry', '2031-01-01'],
  ] as const) {
    const policy = fieldPolicyOf(fieldKey);
    if (!policy) throw new Error(fieldKey);
    await registerFieldDefinition(db, {
      key: fieldKey,
      dataType: 'text',
      sensitivity: policy.sensitivity,
      repeating: policy.group !== undefined,
    });
    const edited = await editFact(db, {
      actorAccountId: ownerId,
      applicantId,
      fieldKey,
      value,
      ...(requiresProtection(policy.sensitivity) ? { encryption: keys } : {}),
    });
    if (!isOk(edited)) throw new Error(`fact ${fieldKey}`);
  }
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId,
    title: 'London Trip',
    destination: 'United Kingdom',
    purpose: 'Visit family',
    travelStartDate: new Date('2026-12-01T00:00:00Z'),
  });
  if (!isOk(mission)) throw new Error('mission');
  await createTask(db, {
    actorAccountId: ownerId,
    missionId: mission.value.id,
    description: TASK_TEXT,
    dueDate: new Date('2026-11-20T00:00:00Z'),
  });
  const [storage] = await db
    .insert(schema.storageObjects)
    .values({ bucket: 'CLEAN', objectKey: `clean/${randomBytes(6).toString('hex')}` })
    .returning({ id: schema.storageObjects.id });
  if (!storage) throw new Error('storage');
  const [doc] = await db
    .insert(schema.documents)
    .values({ applicantId, originalName: 'visa.pdf', docType: 'VISA' })
    .returning({ id: schema.documents.id });
  if (!doc) throw new Error('document');
  await assignReferenceCode(db, 'D', doc.id);
  const [version] = await db
    .insert(schema.documentVersions)
    .values({
      documentId: doc.id,
      storageObjectId: storage.id,
      processingStatus: 'APPROVED',
      safetyStatus: 'CLEAN',
    })
    .returning({ id: schema.documentVersions.id });
  if (!version) throw new Error('version');
  await db.insert(schema.ocrRuns).values({
    documentVersionId: version.id,
    applicantId,
    status: 'SUCCEEDED',
    provider: 'test',
    modelVersion: 'm',
    promptVersion: 'p',
    extractedText: DOCUMENT_TEXT,
  });
  const visa = (await referenceCodesFor(db, 'D', [doc.id])).get(doc.id);
  if (!visa) throw new Error('code');
  return { ownerId, applicantId, missionId: mission.value.id, visa };
}

const CHOICES: AiConnectionChoices = {
  layers: ['identity', 'travel_documents'],
  caseMode: 'ALL_CURRENT',
  documentList: true,
  documentText: true,
  revealIdentifiers: true,
  duration: '30d',
};

async function ownerProof(ownerId: string, applicantId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(ownerId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'ai_connection' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value;
}

/** Consent approved, code exchanged: every secret the flow handled, for the leak checks. */
async function connect(ownerId: string, applicantId: string, choices = CHOICES) {
  const stepUpRequest = {
    accountId: ownerId,
    action: 'EXPORT_PROFILE' as const,
    resourceId: applicantId,
  };
  const stepUp = choices.revealIdentifiers
    ? verifyStepUp(
        STEP_UP_SECRET,
        issueStepUpAssurance(STEP_UP_SECRET, stepUpRequest),
        stepUpRequest,
      )
    : undefined;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const created = await createAiConnection(await ownerProof(ownerId, applicantId), {
    client: CLIENT,
    choices,
    codeChallenge: challenge,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    ...(stepUp ? { stepUp } : {}),
  });
  if (!isOk(created)) throw new Error(created.error.description);
  const tokens = await exchangeAiAuthorizationCode(db, {
    code: created.value.code,
    codeVerifier: verifier,
    clientId: CLIENT.clientId,
    redirectUri: REDIRECT,
    resource: RESOURCE,
  });
  if (!isOk(tokens)) throw new Error(tokens.error.description);
  return {
    connectionId: created.value.connectionId,
    token: tokens.value.access_token,
    refresh: tokens.value.refresh_token,
    secrets: [created.value.code, verifier, tokens.value.access_token, tokens.value.refresh_token],
  };
}

async function call(token: string, name: string, input: Record<string, unknown> = {}) {
  return runAiTool(db, tool(name), input as never, {
    token,
    resource: RESOURCE,
    admission: ADMIT,
    encryption: keys,
  });
}

async function aiAuditRows() {
  return db
    .select()
    .from(schema.auditEvents)
    .where(
      or(
        like(schema.auditEvents.eventType, 'AI_CONNECTION_%'),
        like(schema.auditEvents.eventType, 'AI_CONTEXT_%'),
      ),
    );
}

async function aiProductEvents() {
  return db
    .select()
    .from(schema.productEvents)
    .where(
      inArray(schema.productEvents.eventType, [
        'AI_CONNECTOR_CONNECTED',
        'AI_CONTEXT_REQUESTED',
        'AI_CONTEXT_DENIED',
        'AI_CONNECTOR_REVOKED',
      ]),
    );
}

describe('S16: no value, task text, document text, token or code in AI audit or telemetry', () => {
  it('drives every AI audit event and product event, and none carries a sentinel', async () => {
    const { ownerId, applicantId, visa } = await seed();
    const { value: run, logged } = await consoleDuring(async () => {
      const connection = await connect(ownerId, applicantId);
      // Served: the answers really do carry the sentinels, so the checks below are not empty.
      const context = await call(connection.token, 'prepare_context');
      const text = await call(connection.token, 'get_document_text', { document_reference: visa });
      // Refused: a section that was not granted.
      const refused = await call(connection.token, 'get_profile_section', { section: 'money' });
      // Withheld by the route as too large to send.
      await auditAiAnswerWithheld(db, {
        connectionId: connection.connectionId,
        tool: 'prepare_context',
      });
      // Failed part-way (a database fault).
      await db.execute(sql`alter table missions rename to missions_away`);
      const failed = await call(connection.token, 'list_cases');
      await db.execute(sql`alter table missions_away rename to missions`);
      // The sign-in machinery, which writes no audit but must not log either.
      const refreshed = await refreshAiTokens(db, {
        refreshToken: connection.refresh,
        clientId: CLIENT.clientId,
        resource: RESOURCE,
      });
      if (!isOk(refreshed)) throw new Error(refreshed.error.description);
      await revokeAiToken(db, { token: refreshed.value.refresh_token });
      // Change Access, then Turn Off.
      const second = await connect(ownerId, applicantId);
      const changed = await changeAiConnection(await ownerProof(ownerId, applicantId), {
        connectionId: second.connectionId,
        choices: { ...CHOICES, revealIdentifiers: false, duration: 'keep' },
      });
      const off = await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
        connectionId: second.connectionId,
      });
      return {
        context,
        text,
        refused,
        failed,
        changed,
        off,
        secrets: [
          ...connection.secrets,
          ...second.secrets,
          refreshed.value.access_token,
          refreshed.value.refresh_token,
        ],
      };
    });

    expect(run.context.kind).toBe('answered');
    expect(JSON.stringify(run.context.result)).toContain(PASSPORT_NUMBER);
    expect(JSON.stringify(run.text.result)).toContain(DOCUMENT_TEXT);
    expect(run.refused.result.isError).toBe(true);
    expect(run.failed.kind).toBe('failed');
    expect(isOk(run.changed)).toBe(true);
    expect(run.off).toMatchObject({ ok: true, value: { alreadyOff: false } });

    const audit = await aiAuditRows();
    expect(new Set(audit.map((row) => row.eventType))).toEqual(
      new Set([
        'AI_CONNECTION_CREATED',
        'AI_CONNECTION_CHANGED',
        'AI_CONNECTION_REVOKED',
        'AI_CONTEXT_SERVED',
        'AI_CONTEXT_DENIED',
      ]),
    );
    const events = await aiProductEvents();
    expect(new Set(events.map((row) => row.eventType))).toEqual(
      new Set([
        'AI_CONNECTOR_CONNECTED',
        'AI_CONTEXT_REQUESTED',
        'AI_CONTEXT_DENIED',
        'AI_CONNECTOR_REVOKED',
      ]),
    );

    const sentinels = [PASSPORT_NUMBER, TASK_TEXT, DOCUMENT_TEXT, ...run.secrets];
    // The whole stored row, not just the metadata: reason, ids and labels too.
    const stored = JSON.stringify({ audit, events });
    for (const sentinel of sentinels) {
      expect(stored, 'stored audit or product event').not.toContain(sentinel);
      expect(logged, 'console output').not.toContain(sentinel);
    }
    // Partial matches too: the last digits a masked number shows, a slice of each text.
    for (const fragment of ['7731905', 'cousin Rafiq', '88213-KESTREL']) {
      expect(stored).not.toContain(fragment);
      expect(logged).not.toContain(fragment);
    }
  });

  it('keeps audit metadata to ids, host, tool, layers, counts, depth and reason codes', async () => {
    const { ownerId, applicantId, visa } = await seed();
    const connection = await connect(ownerId, applicantId);
    await call(connection.token, 'prepare_context');
    await call(connection.token, 'get_document_text', { document_reference: visa });
    await call(connection.token, 'get_profile_section', { section: 'money' });
    await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
      connectionId: connection.connectionId,
    });
    const allowedKeys: Record<string, readonly string[]> = {
      AI_CONNECTION_CREATED: ['clientHost', 'layers', 'caseMode', 'revealIdentifiers', 'duration'],
      AI_CONNECTION_REVOKED: ['reason'],
      AI_CONTEXT_SERVED: [
        'clientHost',
        'tool',
        'layers',
        'caseMode',
        'cases',
        'values',
        'documents',
        'documentTexts',
        'depth',
      ],
      AI_CONTEXT_DENIED: ['clientHost', 'tool', 'caseMode', 'reason'],
    };
    for (const row of await aiAuditRows()) {
      const keysAllowed = allowedKeys[row.eventType];
      expect(keysAllowed, row.eventType).toBeDefined();
      for (const [key, value] of Object.entries(row.metadata as Record<string, unknown>)) {
        expect(keysAllowed, `${row.eventType}.${key}`).toContain(key);
        // Only short codes, numbers, booleans and lists of section names: never prose.
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (typeof item === 'string') expect(item, key).toMatch(/^[A-Za-z0-9_.-]{1,40}$/);
          else expect(['number', 'boolean'], key).toContain(typeof item);
        }
      }
    }
  });
});

describe('S16: AI product events on each path', () => {
  it('records connected, requested, denied and revoked, with labels and numbers only', async () => {
    const { ownerId, applicantId, visa } = await seed();
    const connection = await connect(ownerId, applicantId);
    expect(await aiProductEvents()).toEqual([
      expect.objectContaining({
        eventType: 'AI_CONNECTOR_CONNECTED',
        accountId: ownerId,
        organizationId: null,
        dimension: 'ALL_CURRENT',
        metricValue: 2,
      }),
    ]);

    await call(connection.token, 'prepare_context');
    await call(connection.token, 'get_document_text', { document_reference: visa });
    await call(connection.token, 'get_profile_section', { section: 'money' });
    await auditAiAnswerWithheld(db, {
      connectionId: connection.connectionId,
      tool: 'prepare_context',
    });
    await db.execute(sql`alter table missions rename to missions_away`);
    await call(connection.token, 'list_cases');
    await db.execute(sql`alter table missions_away rename to missions`);
    await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
      connectionId: connection.connectionId,
    });
    // Turning off again is a quiet success and records nothing more.
    await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
      connectionId: connection.connectionId,
    });

    const events = await aiProductEvents();
    const shape = events
      .map((e) => [e.eventType, e.dimension, e.accountId === ownerId] as const)
      .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`));
    expect(shape).toEqual([
      ['AI_CONNECTOR_CONNECTED', 'ALL_CURRENT', true],
      ['AI_CONNECTOR_REVOKED', null, true],
      ['AI_CONTEXT_DENIED', 'FAILED', true],
      ['AI_CONTEXT_DENIED', 'LAYER_NOT_GRANTED', true],
      ['AI_CONTEXT_DENIED', 'TOO_LARGE', true],
      ['AI_CONTEXT_REQUESTED', 'GET_DOCUMENT_TEXT', true],
      ['AI_CONTEXT_REQUESTED', 'PREPARE_CONTEXT', true],
    ]);
    const requested = events.find((e) => e.dimension === 'PREPARE_CONTEXT');
    expect(requested?.metricValue).toBeGreaterThan(0);
    const revoked = events.find((e) => e.eventType === 'AI_CONNECTOR_REVOKED');
    expect(revoked?.metricValue).toBeGreaterThanOrEqual(0);
    // Once-only events store a hash, never the connection id itself.
    expect(JSON.stringify(events)).not.toContain(connection.connectionId);
  });

  it('records no telemetry when the token is refused before any connection is known', async () => {
    const { ownerId, applicantId } = await seed();
    const connection = await connect(ownerId, applicantId);
    const before = (await aiProductEvents()).length;
    const outcome = await call(`vsa_${'A'.repeat(43)}`, 'prepare_context');
    expect(outcome.kind).toBe('unauthorized');
    await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
      connectionId: connection.connectionId,
    });
    const afterOff = await aiProductEvents();
    expect(afterOff.length).toBe(before + 1);
    expect((await call(connection.token, 'prepare_context')).kind).toBe('unauthorized');
    expect((await aiProductEvents()).length).toBe(afterOff.length);
  });
});

describe('S16: telemetry never in the way', () => {
  it('a product event that cannot be written leaves the call, the audit and the turn-off intact', async () => {
    const { ownerId, applicantId } = await seed();
    await db.execute(sql`alter table product_events rename to product_events_away`);
    const { value, logged } = await consoleDuring(async () => {
      const connection = await connect(ownerId, applicantId);
      const served = await call(connection.token, 'prepare_context');
      const refused = await call(connection.token, 'get_profile_section', { section: 'money' });
      const off = await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
        connectionId: connection.connectionId,
      });
      return { connection, served, refused, off };
    });
    await db.execute(sql`alter table product_events_away rename to product_events`);

    expect(value.served.kind).toBe('answered');
    expect(value.served.result.isError).toBeUndefined();
    expect(JSON.stringify(value.served.result)).toContain(PASSPORT_NUMBER);
    expect(value.refused.result.isError).toBe(true);
    expect(value.off).toMatchObject({ ok: true, value: { alreadyOff: false } });
    expect((await aiAuditRows()).map((row) => row.eventType).sort()).toEqual([
      'AI_CONNECTION_CREATED',
      'AI_CONNECTION_REVOKED',
      'AI_CONTEXT_DENIED',
      'AI_CONTEXT_SERVED',
    ]);
    expect(await aiProductEvents()).toEqual([]);
    // The failure was reported, once per event type, and without any value or token.
    expect(logged).toContain('AI_CONTEXT_REQUESTED was not recorded');
    for (const sentinel of [PASSPORT_NUMBER, ...value.connection.secrets]) {
      expect(logged).not.toContain(sentinel);
    }
  });
});

describe('S16: last used is written at most once a minute', () => {
  it('skips the write within a minute and writes again after it', async () => {
    const { ownerId, applicantId } = await seed();
    const { token, connectionId } = await connect(ownerId, applicantId);
    const lastUsed = async () =>
      (
        await db
          .select({ at: schema.aiConnections.lastUsedAt })
          .from(schema.aiConnections)
          .where(eq(schema.aiConnections.id, connectionId))
      )[0]?.at;
    const start = new Date(Date.now() + 1000);
    expect(
      await resolveAiAccessToken(db, { token, resource: RESOURCE, now: start }),
    ).not.toBeNull();
    expect((await lastUsed())?.getTime()).toBe(start.getTime());
    const soon = new Date(start.getTime() + 59_000);
    await resolveAiAccessToken(db, { token, resource: RESOURCE, now: soon });
    expect((await lastUsed())?.getTime()).toBe(start.getTime());
    const later = new Date(start.getTime() + 60_000);
    await resolveAiAccessToken(db, { token, resource: RESOURCE, now: later });
    expect((await lastUsed())?.getTime()).toBe(later.getTime());
  });
});

describe('S16: staff count of AI app connections', () => {
  async function securityAdmin() {
    const actor = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com');
    return staffScopeFor(db, actor, 'AI_SETTINGS_MANAGE');
  }

  it('counts active and turned-off connections and the last seven days of calls', async () => {
    const { ownerId, applicantId, visa } = await seed();
    const live = await connect(ownerId, applicantId);
    const ended = await connect(ownerId, applicantId);
    const expired = await connect(ownerId, applicantId);
    await db
      .update(schema.aiConnections)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.aiConnections.id, expired.connectionId));
    // Approved on the consent screen but never finished by the app: not active.
    const pending = await createAiConnection(await ownerProof(ownerId, applicantId), {
      client: CLIENT,
      choices: { ...CHOICES, revealIdentifiers: false },
      codeChallenge: createHash('sha256').update('x'.repeat(43)).digest('base64url'),
      redirectUri: REDIRECT,
      resource: RESOURCE,
    });
    expect(isOk(pending)).toBe(true);
    await call(live.token, 'prepare_context');
    await call(live.token, 'get_document_text', { document_reference: visa });
    await call(live.token, 'get_profile_section', { section: 'money' });
    await turnOffAiConnection(await ownerProof(ownerId, applicantId), {
      connectionId: ended.connectionId,
    });

    const staff = await securityAdmin();
    const counts = await getAiConnectionCounts(db, staff);
    expect(counts).toMatchObject({
      ok: true,
      value: { available: true, active: 1, turnedOff: 1, served: 2, denied: 1 },
    });
    // Eight days on, the calls fall out of the window; the connections are still counted.
    const later = await getAiConnectionCounts(
      db,
      staff,
      new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    );
    expect(later).toMatchObject({
      ok: true,
      value: { available: true, active: 1, turnedOff: 1, served: 0, denied: 0 },
    });
    // Totals only: nothing about a person, an app or a case.
    if (!isOk(counts)) throw new Error('counts');
    expect(Object.keys(counts.value).sort()).toEqual(
      ['active', 'available', 'denied', 'served', 'since', 'turnedOff'].sort(),
    );
    const text = JSON.stringify(counts.value);
    for (const id of [ownerId, applicantId, live.connectionId, 'claude.ai']) {
      expect(text).not.toContain(id);
    }
  });

  it('shows zeros on an empty platform', async () => {
    const counts = await getAiConnectionCounts(db, await securityAdmin());
    expect(counts).toMatchObject({
      ok: true,
      value: { available: true, active: 0, turnedOff: 0, served: 0, denied: 0 },
    });
  });

  it('says "not available yet" while the connection tables do not exist', async () => {
    const staff = await securityAdmin();
    await db.execute(sql`alter table ai_connections rename to ai_connections_away`);
    expect(await getAiConnectionCounts(db, staff)).toEqual({
      ok: true,
      value: { available: false },
    });
  });

  it('does not hide a failure that is not a missing table', async () => {
    const staff = await securityAdmin();
    await db.execute(sql`alter table ai_connections rename column revoked_at to revoked_away`);
    // A missing column reads as "not migrated yet" too; a broken query of any other kind throws.
    expect(await getAiConnectionCounts(db, staff)).toMatchObject({ ok: true });
    await db.execute(sql`alter table ai_connections rename column revoked_away to revoked_at`);
    const failing = {
      ...db,
      select: () => {
        throw new Error('connection reset');
      },
    } as unknown as Db;
    await expect(getAiConnectionCounts(failing, staff)).rejects.toThrow('connection reset');
  });

  it('refuses anyone who is not a security admin with a fresh scope', async () => {
    const support = await seedStaffAccount(db, 'SUPPORT_ADMIN', 'support@example.com');
    expect(isErr(await staffPrincipal(db, support, 'AI_SETTINGS_MANAGE'))).toBe(true);
    const otherAction = await staffScopeFor(db, support, 'PROCESSING_JOB_RETRY');
    const forged = {
      kind: 'staff',
      accountId: support.accountId,
      platformAction: 'AI_SETTINGS_MANAGE',
      verifiedAt: new Date(),
    };
    for (const scope of [otherAction, forged, null, undefined]) {
      const refused = await getAiConnectionCounts(
        db,
        scope as unknown as StaffScope<'AI_SETTINGS_MANAGE'>,
      );
      expect(refused).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    // A genuine scope goes stale after five minutes.
    const staff = await securityAdmin();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
    expect(await getAiConnectionCounts(db, staff)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});
