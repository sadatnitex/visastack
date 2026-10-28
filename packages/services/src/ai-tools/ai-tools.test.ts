import { createHash, randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { fieldPolicyOf } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAiConnection,
  exchangeAiAuthorizationCode,
  revokeAiToken,
} from '../access/ai-connection';
import { accountPrincipal } from '../access/principal';
import { requireAccess } from '../access/require-access';
import { verifyStepUp } from '../access/step-up-proof';
import { type AiContextGateway, withAiConnection } from '../access/with-ai-connection';
import { provisionAccount } from '../accounts';
import { AI_TOOL_NAMES, type AiConnectionChoices } from '../ai-connection-scopes';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { exportAccount } from '../export';
import { attachPackVersion, createMission, createTask } from '../missions';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../packs';
import { checkPilotAccess } from '../pilot-access';
import type { KeyManagementPort } from '../ports';
import { editFact, registerFieldDefinition } from '../profile';
import { requiresProtection, resetProtectedFieldKeyCacheForTests } from '../protected-fields';
import { referenceCodesFor } from '../reference-codes';
import { assignReferenceCode } from '../reference-codes';
import { issueStepUpAssurance } from '../step-up';
import { AI_TOOLS, type AiToolResult, runAiTool } from './index';
import { AI_RESPONSE_LIMIT_BYTES, MESSAGES } from './result';

// Made-up values, each seeded so a test can prove where it does and does not appear.
const PASSPORT_NUMBER = 'BX7319046';
const NID_NUMBER = '1990123456789';
const INCOME = '4500000';
const TAX_ZONE = 'Zone Nine';
const REFUSAL = 'Refused for insufficient funds';
const HEALTH_NOTE = 'Needs a wheelchair ramp';
const AGENCY_NOTE = 'Agency private note: call the referee about 55512';
const TASK_NOTE = 'Task note: remind her about the secret bank code';
const PASSPORT_TEXT = `Passport scan text ${PASSPORT_NUMBER}`;
const VISA_TEXT = 'Visa vignette text: multiple entry, valid two years';
const RESOURCE = 'https://vs.example.test/mcp';
const STEP_UP_SECRET = 'test-step-up-secret';
/** Admitted, as in a development or public-beta deployment; the refusal has its own test. */
const ADMIT = async () => true;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
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
});

async function person(email = 'owner@example.com') {
  const provisioned = await provisionAccount(db, { email });
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
  return { ownerId, applicantId: applicant.value.id };
}

async function fact(ownerId: string, applicantId: string, fieldKey: string, value: string) {
  const policy = fieldPolicyOf(fieldKey);
  if (!policy) throw new Error(`unknown field ${fieldKey}`);
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

async function document(applicantId: string, docType: string, readText?: string) {
  const [storage] = await db
    .insert(schema.storageObjects)
    .values({ bucket: 'CLEAN', objectKey: `clean/${randomBytes(6).toString('hex')}` })
    .returning({ id: schema.storageObjects.id });
  if (!storage) throw new Error('storage');
  const [doc] = await db
    .insert(schema.documents)
    .values({ applicantId, originalName: 'scan.pdf', docType })
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
  if (readText !== undefined) {
    await db.insert(schema.ocrRuns).values({
      documentVersionId: version.id,
      applicantId,
      status: 'SUCCEEDED',
      provider: 'test',
      modelVersion: 'm',
      promptVersion: 'p',
      extractedText: readText,
    });
  }
  const code = (await referenceCodesFor(db, 'D', [doc.id])).get(doc.id);
  if (!code) throw new Error('code');
  return code;
}

async function pack(actor: string): Promise<string> {
  const created = await createPack(db, {
    actorAccountId: actor,
    key: 'gb.visit',
    name: 'UK Visit',
  });
  if (!isOk(created)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: created.value.id });
  if (!isOk(version)) throw new Error('version');
  for (const [kind, key] of [
    ['FIELD', 'passport_expiry'],
    ['DOCUMENT', 'VISA'],
  ] as const) {
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: key } : { docType: key }),
      citation: 'rule',
    });
  }
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  return version.value.id;
}

async function caseFor(
  ownerId: string,
  applicantId: string,
  title: string,
  packVersionId?: string,
) {
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId,
    title,
    destination: 'United Kingdom',
    purpose: 'Visit family',
    travelStartDate: new Date('2026-12-01T00:00:00Z'),
  });
  if (!isOk(mission)) throw new Error('mission');
  if (packVersionId) {
    const attached = await attachPackVersion(db, {
      actorAccountId: ownerId,
      missionId: mission.value.id,
      packVersionId,
    });
    if (!isOk(attached)) throw new Error('attach');
  }
  const code = (await referenceCodesFor(db, 'C', [mission.value.id])).get(mission.value.id);
  if (!code) throw new Error('case code');
  return { missionId: mission.value.id, reference: code };
}

/** One synthetic traveller with two cases, a full record, documents and an agency's notes. */
async function seed() {
  const { ownerId, applicantId } = await person();
  for (const [key, value] of [
    ['given_name', 'Nusrat'],
    ['family_name', 'Jahan'],
    ['nationality', 'Bangladeshi'],
    ['date_of_birth', '1990-05-01'],
    ['passport_number', PASSPORT_NUMBER],
    ['passport_expiry', '2031-01-01'],
    ['nid_number', NID_NUMBER],
    ['annual_income', INCOME],
    ['tax_zone', TAX_ZONE],
    ['refusal_reason', REFUSAL],
    ['accessibility_needs', HEALTH_NOTE],
  ] as const) {
    await fact(ownerId, applicantId, key, value);
  }
  const packVersionId = await pack(ownerId);
  const caseA = await caseFor(ownerId, applicantId, 'London Trip', packVersionId);
  const caseB = await caseFor(ownerId, applicantId, 'Paris Conference');
  const passport = await document(applicantId, 'PASSPORT', PASSPORT_TEXT);
  const visa = await document(applicantId, 'VISA', VISA_TEXT);
  await createTask(db, {
    actorAccountId: ownerId,
    missionId: caseA.missionId,
    description: TASK_NOTE,
    dueDate: new Date('2026-11-20T00:00:00Z'),
  });
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Harbor Visas' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('org');
  await db.insert(schema.evidenceRequests).values({
    organizationId: org.id,
    applicantId,
    missionId: caseA.missionId,
    kind: 'DOCUMENT',
    docType: 'BANK_STATEMENT',
    message: AGENCY_NOTE,
    status: 'OPEN',
  });
  return { ownerId, applicantId, caseA, caseB, passport, visa };
}

const CASE_A_ONLY: Omit<AiConnectionChoices, 'missionId'> = {
  layers: ['identity', 'travel_documents'],
  caseMode: 'ONE',
  documentList: true,
  documentText: false,
  revealIdentifiers: false,
  duration: '30d',
};

/** The consent screen approved, the code exchanged: an access token for the connection. */
async function connect(
  ownerId: string,
  applicantId: string,
  choices: AiConnectionChoices,
): Promise<{ token: string; refresh: string; connectionId: string }> {
  const proof = await requireAccess(
    db,
    accountPrincipal(ownerId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'ai_connection' },
  );
  if (!isOk(proof)) throw new Error('proof');
  // Full numbers need the identity check the consent screen asks for (S13).
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
  const created = await createAiConnection(proof.value, {
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
    token: tokens.value.access_token,
    refresh: tokens.value.refresh_token,
    connectionId: created.value.connectionId,
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

/** A successful answer; fails the test on a refusal. */
async function served(token: string, name: string, input: Record<string, unknown> = {}) {
  const outcome = await call(token, name, input);
  expect(outcome.kind).toBe('answered');
  expect(outcome.result.isError, JSON.stringify(outcome.result.content)).toBeUndefined();
  // The structured answer must match the tool's own declared output schema.
  const parsed = tool(name).outputSchema.safeParse(outcome.result.structuredContent);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return outcome.result;
}

async function refused(token: string, name: string, input: Record<string, unknown> = {}) {
  const outcome = await call(token, name, input);
  expect(outcome.kind).toBe('answered');
  expect(outcome.result.isError).toBe(true);
  expect(outcome.result.structuredContent).toBeUndefined();
  return outcome.result.content[0]?.text ?? '';
}

const wire = (result: AiToolResult) => JSON.stringify(result);

async function aiAudit() {
  return db
    .select()
    .from(schema.auditEvents)
    .where(like(schema.auditEvents.eventType, 'AI_CONTEXT_%'));
}

describe('AI tools: declared shape', () => {
  it('are exactly the five read-only tools ADR 0021 names, each with an output schema', () => {
    expect(AI_TOOLS.map((t) => t.name)).toEqual([
      'prepare_context',
      'list_cases',
      'get_profile_section',
      'list_documents',
      'get_document_text',
    ]);
    // The names audit records and telemetry may hold are exactly these (S16).
    expect(AI_TOOLS.map((t) => t.name)).toEqual([...AI_TOOL_NAMES]);
    for (const t of AI_TOOLS) {
      expect(t.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(t.title).toMatch(/^[A-Z]/);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.outputSchema).toBeDefined();
    }
  });
});

describe('AI tools: one case, money off (section K, AI connection owner)', () => {
  it('serves Case A only, compact and with provenance, and refuses Case B', async () => {
    const { ownerId, applicantId, caseA, caseB } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      missionId: caseA.missionId,
    });

    const context = await served(token, 'prepare_context');
    const body = context.structuredContent as {
      cases: { ref: string; readiness?: unknown }[];
      person: { basics?: { status: string }[] };
      profile?: Record<string, { status: string; field: string; masked?: string }[]>;
    };
    expect(body.cases.map((c) => c.ref)).toEqual([caseA.reference]);
    expect(body.cases[0]?.readiness).toBeDefined();
    // Every value carries its status (provenance in plain epistemic words).
    const values = [...(body.person.basics ?? []), ...Object.values(body.profile ?? {}).flat()];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value.status).toBeTruthy();
    // The text block carries the same answer for apps that only read text.
    expect(context.content[0]?.text).toContain(caseA.reference);

    const listed = await served(token, 'list_cases');
    expect(
      (listed.structuredContent as { cases: { reference: string }[] }).cases.map(
        (c) => c.reference,
      ),
    ).toEqual([caseA.reference]);

    expect(await refused(token, 'prepare_context', { case_reference: caseB.reference })).toBe(
      MESSAGES.caseNotShared,
    );
    // Its own case by reference, typed loosely, is fine.
    await served(token, 'prepare_context', {
      case_reference: caseA.reference.toLowerCase().replace('-', ' '),
    });
  });

  it('never returns a money value, an agency note or a task in any response', async () => {
    const { ownerId, applicantId, caseA, caseB, visa, passport } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      missionId: caseA.missionId,
    });
    const responses: string[] = [];
    const record = async (name: string, input: Record<string, unknown> = {}) =>
      responses.push(wire((await call(token, name, input)).result));
    await record('prepare_context');
    await record('prepare_context', { focus: ['money', 'overview'], depth: 'full' });
    await record('prepare_context', { focus: ['money'] });
    await record('prepare_context', { case_reference: caseB.reference });
    await record('list_cases');
    for (const section of ['identity', 'travel_documents', 'money', 'declarations', 'health']) {
      await record('get_profile_section', { section });
    }
    await record('list_documents');
    await record('list_documents', { group: 'financial' });
    await record('get_document_text', { document_reference: visa });
    await record('get_document_text', { document_reference: passport });
    const all = responses.join('\n');
    for (const secret of [
      INCOME,
      TAX_ZONE,
      REFUSAL,
      HEALTH_NOTE,
      AGENCY_NOTE,
      TASK_NOTE,
      'Harbor Visas',
      PASSPORT_NUMBER,
      NID_NUMBER,
      PASSPORT_TEXT,
      'annual_income',
      'tax_zone',
      'Paris Conference',
    ]) {
      expect(all).not.toContain(secret);
    }
    // No internal ids of any kind leave in an answer.
    expect(all).not.toContain(applicantId);
    expect(all).not.toContain(caseA.missionId);
    expect(all).not.toContain(caseB.missionId);
  });

  it('refuses a layer that was not chosen, plainly, never with an empty success', async () => {
    const { ownerId, applicantId, caseA } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      missionId: caseA.missionId,
    });
    expect(await refused(token, 'get_profile_section', { section: 'money' })).toBe(
      MESSAGES.notShared,
    );
    expect(await refused(token, 'prepare_context', { focus: ['money', 'family'] })).toBe(
      MESSAGES.notShared,
    );
    // Asked together with something shared: served, saying what was left out.
    const mixed = await served(token, 'prepare_context', { focus: ['money', 'overview'] });
    const body = mixed.structuredContent as { notShared?: string[]; profile?: object };
    expect(body.notShared).toEqual(['money']);
    expect(Object.keys(body.profile ?? {})).not.toContain('money');
  });

  it('is smaller for one case than the full export (bytes recorded)', async () => {
    const { ownerId, applicantId, caseA } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      missionId: caseA.missionId,
    });
    const everything = await exportAccount(db, { actorAccountId: ownerId, accountId: ownerId });
    if (!isOk(everything)) throw new Error('export');
    const exportBytes = Buffer.byteLength(JSON.stringify(everything.value), 'utf8');
    const context = await served(token, 'prepare_context', { depth: 'brief' });
    const contextBytes = Buffer.byteLength(JSON.stringify(context.structuredContent), 'utf8');
    expect(contextBytes).toBeLessThan(exportBytes);
    process.stdout.write(
      `ai connector size: export ${exportBytes} bytes, one-case context ${contextBytes} bytes\n`,
    );
  }, 60_000);
});

describe('AI tools: identifiers and documents', () => {
  it('masks identifiers unless the connection reveals them', async () => {
    const { ownerId, applicantId } = await seed();
    const masked = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
    });
    const section = await served(masked.token, 'get_profile_section', {
      section: 'travel_documents',
    });
    const passport = (
      section.structuredContent as { values: { field: string; masked?: string; value?: string }[] }
    ).values.find((v) => v.field === 'passport_number');
    expect(passport).toMatchObject({ masked: '***046' });
    expect(passport?.value).toBeUndefined();
    expect(wire(section)).not.toContain(PASSPORT_NUMBER);
    const identity = await served(masked.token, 'get_profile_section', { section: 'identity' });
    expect(wire(identity)).not.toContain(NID_NUMBER);

    const revealed = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
      revealIdentifiers: true,
    });
    const full = await served(revealed.token, 'get_profile_section', {
      section: 'travel_documents',
    });
    expect(wire(full)).toContain(PASSPORT_NUMBER);
    const fullIdentity = await served(revealed.token, 'get_profile_section', {
      section: 'identity',
    });
    expect(wire(fullIdentity)).toContain(NID_NUMBER);
  });

  it('refuses document text with the list on and text off', async () => {
    const { ownerId, applicantId, visa } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    const list = await served(token, 'list_documents');
    const documents = (list.structuredContent as { documents: { referenceCode: string }[] })
      .documents;
    expect(documents.map((d) => d.referenceCode)).toContain(visa);
    // The list never carries what a document says.
    expect(wire(list)).not.toContain(VISA_TEXT);
    expect(await refused(token, 'get_document_text', { document_reference: visa })).toBe(
      MESSAGES.notShared,
    );
  });

  it('gives text only for a granted group, never for a protected kind', async () => {
    const { ownerId, applicantId, visa, passport } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
      documentText: true,
    });
    const read = await served(token, 'get_document_text', { document_reference: visa });
    expect(read.structuredContent).toMatchObject({
      referenceCode: visa,
      text: VISA_TEXT,
      untrusted: true,
    });
    // Passports are protected by the platform: the text never leaves, whatever was ticked.
    expect(await refused(token, 'get_document_text', { document_reference: passport })).toBe(
      MESSAGES.documentProtected,
    );
    const context = await served(token, 'prepare_context');
    expect(wire(context)).toContain(VISA_TEXT);
    expect(wire(context)).not.toContain(PASSPORT_TEXT);
    expect(await refused(token, 'get_document_text', { document_reference: 'D-0000' })).toBe(
      MESSAGES.documentReference,
    );

    // A connection without the travel section has no group that allows the visa's text.
    const narrow = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      layers: ['identity'],
      caseMode: 'NONE',
      documentText: true,
    });
    expect(await refused(narrow.token, 'get_document_text', { document_reference: visa })).toBe(
      MESSAGES.noText,
    );
  });

  it('keeps a long text within the size limit, shortened with a plain notice', async () => {
    const { ownerId, applicantId } = await person();
    // 20,000 characters of three-byte script: about 60 KB, over the 50 KB answer limit.
    const long = await document(applicantId, 'VISA', 'অ'.repeat(20_000));
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
      documentText: true,
    });
    const read = await served(token, 'get_document_text', { document_reference: long });
    expect(Buffer.byteLength(JSON.stringify(read), 'utf8')).toBeLessThanOrEqual(
      AI_RESPONSE_LIMIT_BYTES,
    );
    expect(read.structuredContent).toMatchObject({ truncated: true, notice: MESSAGES.shortened });
    // Whole characters only: the text is still valid and still only that script.
    expect((read.structuredContent as { text: string }).text).toMatch(/^অ+$/);
  });
});

describe('AI tools: case modes', () => {
  it('with no case shared, refuses the case list and a case reference', async () => {
    const { ownerId, applicantId, caseA } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    expect(await refused(token, 'list_cases')).toBe(MESSAGES.notShared);
    expect(await refused(token, 'prepare_context', { case_reference: caseA.reference })).toBe(
      MESSAGES.caseNotShared,
    );
    const context = await served(token, 'prepare_context');
    expect((context.structuredContent as { cases?: unknown[] }).cases).toBeUndefined();
  });

  it('with all current cases, covers each current case and not a closed one', async () => {
    const { ownerId, applicantId, caseA, caseB } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'ALL_CURRENT',
    });
    const listed = await served(token, 'list_cases');
    expect(
      (listed.structuredContent as { cases: { reference: string }[] }).cases
        .map((c) => c.reference)
        .sort(),
    ).toEqual([caseA.reference, caseB.reference].sort());
    const one = await served(token, 'prepare_context', { case_reference: caseB.reference });
    expect((one.structuredContent as { cases: { ref: string }[] }).cases.map((c) => c.ref)).toEqual(
      [caseB.reference],
    );
    await db
      .update(schema.missions)
      .set({ state: 'CLOSED' })
      .where(eq(schema.missions.id, caseB.missionId));
    expect(await refused(token, 'prepare_context', { case_reference: caseB.reference })).toBe(
      MESSAGES.caseNotShared,
    );
  });

  it('says plainly when the one connected case was removed', async () => {
    const { ownerId, applicantId, caseA } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      missionId: caseA.missionId,
    });
    await db
      .update(schema.missions)
      .set({ purgedAt: new Date() })
      .where(eq(schema.missions.id, caseA.missionId));
    expect(await refused(token, 'list_cases')).toBe(MESSAGES.caseUnavailable);
    expect(await refused(token, 'prepare_context')).toBe(MESSAGES.caseUnavailable);
  });
});

describe('AI tools: the gate on every call', () => {
  it('refuses the very next call once the connection is turned off', async () => {
    const { ownerId, applicantId } = await seed();
    const { token, connectionId } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
    });
    await served(token, 'list_documents');
    await db
      .update(schema.aiConnections)
      .set({ revokedAt: new Date(), revokedReason: 'owner' })
      .where(eq(schema.aiConnections.id, connectionId));
    const outcome = await call(token, 'list_documents');
    expect(outcome.kind).toBe('unauthorized');
    expect(outcome.result).toMatchObject({ isError: true });
    expect(outcome.result.content[0]?.text).toBe(MESSAGES.ended);
  });

  it('refuses the next call after expiry and after the sign-in is revoked', async () => {
    const { ownerId, applicantId } = await seed();
    const expiring = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    await served(expiring.token, 'list_documents');
    await db
      .update(schema.aiConnections)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.aiConnections.id, expiring.connectionId));
    expect((await call(expiring.token, 'list_documents')).kind).toBe('unauthorized');

    const revoked = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    await served(revoked.token, 'list_documents');
    await revokeAiToken(db, { token: revoked.refresh });
    expect((await call(revoked.token, 'list_documents')).kind).toBe('unauthorized');
  });

  it('refuses when the account no longer owns the record, and for a wrong resource', async () => {
    const { ownerId, applicantId } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    const other = await person('other@example.com');
    const outcomeWrongResource = await runAiTool(db, tool('list_documents'), {} as never, {
      token,
      resource: 'https://evil.example/mcp',
      admission: ADMIT,
    });
    expect(outcomeWrongResource.kind).toBe('unauthorized');
    await db
      .update(schema.applicants)
      .set({ ownerAccountId: other.ownerId })
      .where(eq(schema.applicants.id, applicantId));
    expect((await call(token, 'list_documents')).kind).toBe('unauthorized');
  });

  it('hands over a gateway that stops working when the call ends', async () => {
    const { ownerId, applicantId } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    let kept: AiContextGateway | null = null;
    const outcome = await withAiConnection(
      db,
      { token, resource: RESOURCE, tool: 'probe', admission: ADMIT, encryption: keys },
      async (gateway) => {
        kept = gateway;
        return (await gateway.compose()).ok;
      },
      () => ({ kind: 'served', layers: [], cases: 0, values: 0, documents: 0, documentTexts: 0 }),
    );
    expect(outcome).toMatchObject({ ok: true, value: true });
    const later = await (kept as AiContextGateway | null)?.compose();
    expect(later).toMatchObject({ ok: false, error: 'failed' });
    // The gateway carries the granted scope as plain data, and no way to the record.
    expect(Object.keys(kept ?? {}).sort()).toEqual(['compose', 'denied', 'scope']);
  });

  it('records last use, and audits each call without values, text or tokens', async () => {
    const { ownerId, applicantId, caseA, visa } = await seed();
    const { token, connectionId } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      missionId: caseA.missionId,
      documentText: true,
    });
    await served(token, 'prepare_context');
    await served(token, 'get_document_text', { document_reference: visa });
    await refused(token, 'get_profile_section', { section: 'money' });
    const [connection] = await db
      .select({ lastUsedAt: schema.aiConnections.lastUsedAt })
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    expect(connection?.lastUsedAt).toBeInstanceOf(Date);

    const events = await aiAudit();
    expect(events.map((e) => e.eventType)).toEqual([
      'AI_CONTEXT_SERVED',
      'AI_CONTEXT_SERVED',
      'AI_CONTEXT_DENIED',
    ]);
    expect(events[0]).toMatchObject({
      resourceType: 'ai_connection',
      resourceId: connectionId,
      applicantId,
      missionId: caseA.missionId,
      result: 'ALLOWED',
    });
    expect(events[0]?.metadata).toMatchObject({
      clientHost: 'claude.ai',
      tool: 'prepare_context',
      caseMode: 'ONE',
    });
    expect((events[0]?.metadata as { layers: string[] }).layers).toEqual(
      expect.arrayContaining(['travel_documents']),
    );
    expect(events[2]).toMatchObject({ result: 'DENIED', reason: 'layer_not_granted' });
    const stored = JSON.stringify(events);
    for (const secret of [token, PASSPORT_NUMBER, VISA_TEXT, 'Nusrat', '2031-01-01', INCOME]) {
      expect(stored).not.toContain(secret);
    }
  });
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('AI tools: second review', () => {
  it('answers a database failure plainly, with no SQL or id, and still audits it', async () => {
    const { ownerId, applicantId } = await seed();
    const { token, connectionId } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'ALL_CURRENT',
    });
    await db.execute(sql`alter table missions rename to missions_away`);
    const outcome = await call(token, 'list_cases');
    await db.execute(sql`alter table missions_away rename to missions`);
    expect(outcome.kind).toBe('failed');
    const sent = wire(outcome.result);
    expect(outcome.result.content[0]?.text).toBe(MESSAGES.failed);
    expect(sent).not.toMatch(UUID);
    expect(sent.toLowerCase()).not.toMatch(/select|relation|missions/);
    const events = await aiAudit();
    expect(events.map((e) => [e.eventType, e.reason, e.resourceId])).toEqual([
      ['AI_CONTEXT_DENIED', 'failed', connectionId],
    ]);
  });

  it('refuses medical and police papers without their section, whatever the record holds', async () => {
    const { ownerId, applicantId } = await person();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    const before = [
      await refused(token, 'list_documents', { group: 'medical' }),
      await refused(token, 'list_documents', { group: 'legal_clearances' }),
    ];
    await document(applicantId, 'APPROVED_MEDICAL_CENTRE_RESULT');
    await document(applicantId, 'POLICE_CLEARANCE');
    const after = [
      await refused(token, 'list_documents', { group: 'medical' }),
      await refused(token, 'list_documents', { group: 'legal_clearances' }),
    ];
    expect(before).toEqual([MESSAGES.notShared, MESSAGES.notShared]);
    expect(after).toEqual(before);
    const granted = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      layers: ['identity', 'health', 'declarations'],
      caseMode: 'NONE',
    });
    for (const group of ['medical', 'legal_clearances']) {
      const list = await served(granted.token, 'list_documents', { group });
      expect((list.structuredContent as { documents: unknown[] }).documents).toHaveLength(1);
    }
  });

  it('masks the person’s own identifiers inside document text unless full numbers are shared', async () => {
    const { ownerId, applicantId } = await person();
    await fact(ownerId, applicantId, 'passport_number', PASSPORT_NUMBER);
    await fact(ownerId, applicantId, 'nid_number', NID_NUMBER);
    const receipt = await document(
      applicantId,
      'APPLICATION_RECEIPT',
      `Passport No BX7319046. Typed again: bx 731 9046. Old passport AB1234567. NID ${NID_NUMBER}. Ref 12345.`,
    );
    const masked = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
      documentText: true,
    });
    const read = await served(masked.token, 'get_document_text', { document_reference: receipt });
    const text = (read.structuredContent as { text: string }).text;
    expect(text).toBe(
      'Passport No ***046. Typed again: ***046. Old passport ***567. NID ***789. Ref 12345.',
    );
    const context = await served(masked.token, 'prepare_context', { focus: ['documents'] });
    expect(wire(context)).not.toContain(PASSPORT_NUMBER);
    expect(wire(context)).toContain('Passport No ***046');

    const revealed = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
      documentText: true,
      revealIdentifiers: true,
    });
    const full = await served(revealed.token, 'get_document_text', { document_reference: receipt });
    expect((full.structuredContent as { text: string }).text).toContain('Passport No BX7319046');
  });

  it('keeps what is granted when a focus narrows the sections shown', async () => {
    const { ownerId, applicantId } = await person();
    const police = await document(applicantId, 'POLICE_CLEARANCE');
    const medical = await document(applicantId, 'APPROVED_MEDICAL_CENTRE_RESULT');
    const visa = await document(applicantId, 'VISA');
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      layers: ['identity', 'travel_documents', 'health', 'declarations'],
      caseMode: 'NONE',
    });
    const focused = await served(token, 'prepare_context', { focus: ['documents'] });
    const listed = (focused.structuredContent as { documents: { referenceCode: string }[] })
      .documents;
    expect(listed.map((d) => d.referenceCode).sort()).toEqual([police, medical, visa].sort());
  });

  it('starts Personal Details with the basics', async () => {
    const { ownerId, applicantId } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    const identity = await served(token, 'get_profile_section', { section: 'identity' });
    const fields = (identity.structuredContent as { values: { field: string }[] }).values.map(
      (v) => v.field,
    );
    expect(fields.slice(0, 4)).toEqual([
      'given_name',
      'family_name',
      'nationality',
      'date_of_birth',
    ]);
    expect(fields).toContain('nid_number');
  });

  it('treats an empty focus as no focus', async () => {
    const { ownerId, applicantId } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    const empty = await served(token, 'prepare_context', { focus: [] });
    const none = await served(token, 'prepare_context');
    const strip = (r: AiToolResult) => {
      const { snapshotTakenAt: _taken, ...rest } = r.structuredContent as Record<string, unknown>;
      return rest;
    };
    expect(strip(empty)).toEqual(strip(none));
    expect(
      (empty.structuredContent as { documents?: unknown[] }).documents?.length,
    ).toBeGreaterThan(0);
  });

  it('audits what each answer actually returned, and no case for all current cases', async () => {
    const { ownerId, applicantId, visa } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'ALL_CURRENT',
      documentText: true,
    });
    const list = await served(token, 'list_documents');
    const context = await served(token, 'prepare_context', { focus: ['overview'] });
    await served(token, 'get_document_text', { document_reference: visa });
    const events = await aiAudit();
    const [listed, prepared, text] = events.map((e) => e.metadata as Record<string, unknown>);
    expect(listed).toMatchObject({
      tool: 'list_documents',
      documents: (list.structuredContent as { documents: unknown[] }).documents.length,
      values: 0,
      cases: 0,
    });
    const body = context.structuredContent as {
      person: { basics?: unknown[] };
      profile?: Record<string, unknown[]>;
      cases?: unknown[];
    };
    expect(prepared).toMatchObject({
      tool: 'prepare_context',
      values:
        (body.person.basics?.length ?? 0) +
        Object.values(body.profile ?? {}).reduce((n, l) => n + l.length, 0),
      cases: body.cases?.length ?? 0,
      caseMode: 'ALL_CURRENT',
    });
    expect((prepared as { layers?: string[] } | undefined)?.layers).toEqual(
      Object.keys(body.profile ?? {}).sort(),
    );
    expect(text).toMatchObject({ tool: 'get_document_text', documentTexts: 1 });
    for (const event of events) expect(event.missionId).toBeNull();
  });

  it('audits text from a group that is not shared as not shared', async () => {
    const { ownerId, applicantId } = await person();
    const job = await document(applicantId, 'EMPLOYMENT_CERTIFICATE', 'Employed since 2019');
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'NONE',
      documentText: true,
    });
    expect(await refused(token, 'get_document_text', { document_reference: job })).toBe(
      MESSAGES.noText,
    );
    const [event] = await aiAudit();
    expect(event).toMatchObject({ eventType: 'AI_CONTEXT_DENIED', reason: 'document_not_shared' });
  });

  it('refuses an account the pilot no longer admits, and records activity once a day', async () => {
    const { ownerId, applicantId } = await seed();
    const { token } = await connect(ownerId, applicantId, { ...CASE_A_ONLY, caseMode: 'NONE' });
    const refusedCall = await runAiTool(db, tool('list_documents'), {} as never, {
      token,
      resource: RESOURCE,
      admission: async () => false,
    });
    expect(refusedCall.kind).toBe('unauthorized');
    // The shared pilot rule itself admits an account that already exists, even with no bypass.
    const pilotRule = async (tx: Db, account: { email: string }) =>
      (await checkPilotAccess(tx, { email: account.email, allowlistEmails: [], bypass: false }))
        .allowed;
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.accounts)
      .set({ lastActiveAt: twoDaysAgo })
      .where(eq(schema.accounts.id, ownerId));
    const admitted = await runAiTool(db, tool('list_documents'), {} as never, {
      token,
      resource: RESOURCE,
      admission: pilotRule,
    });
    expect(admitted.kind).toBe('answered');
    const read = async () =>
      (
        await db
          .select({ at: schema.accounts.lastActiveAt })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, ownerId))
      )[0]?.at.getTime() ?? 0;
    const touched = await read();
    expect(touched).toBeGreaterThan(twoDaysAgo.getTime());
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db
      .update(schema.accounts)
      .set({ lastActiveAt: twoHoursAgo })
      .where(eq(schema.accounts.id, ownerId));
    await call(token, 'list_documents');
    expect(await read()).toBe(twoHoursAgo.getTime());
  });

  it('reads no profile values for document-only answers and no basics where none are shown', async () => {
    const { ownerId, applicantId } = await seed();
    const { token } = await connect(ownerId, applicantId, {
      ...CASE_A_ONLY,
      caseMode: 'ALL_CURRENT',
    });
    const list = await served(token, 'list_documents');
    expect(
      (list.structuredContent as { omitted: { not_needed?: number } }).omitted.not_needed ?? 0,
    ).toBe(0);
    let unwraps = 0;
    const counting: KeyManagementPort = {
      ...keys,
      async unwrapDataKey(...args: Parameters<KeyManagementPort['unwrapDataKey']>) {
        unwraps += 1;
        return keys.unwrapDataKey(...args);
      },
    };
    for (const name of ['list_cases', 'list_documents']) {
      const outcome = await runAiTool(db, tool(name), {} as never, {
        token,
        resource: RESOURCE,
        admission: ADMIT,
        encryption: counting,
      });
      expect(outcome.kind).toBe('answered');
    }
    expect(unwraps).toBe(0);
  });
});
