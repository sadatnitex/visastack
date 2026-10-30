import { createHash, randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { AI_FEATURE_OFF_HINT } from '@visastack/core/ai-features';
import { fieldPolicyOf } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAiConnection, exchangeAiAuthorizationCode } from '../access/ai-connection';
import { changeAiConnection } from '../access/ai-connection-manage';
import { accountPrincipal } from '../access/principal';
import { EACH_GRANT, requireAccess } from '../access/require-access';
import { verifyStepUp } from '../access/step-up-proof';
import { type AiWriteGateway, withAiSuggestionConnection } from '../access/with-ai-connection';
import { provisionAccount } from '../accounts';
import { assignMember, decideTaskForOrg, listTasksForOrg, updateTaskForOrg } from '../agency';
import {
  approveClearProposals,
  approveProposal,
  countAiExtractionAttempts,
  listPendingProposals,
  totalAiCostUnits,
} from '../ai';
import type { AiConnectionChoices } from '../ai-connection-scopes';
import { deleteAiDraft, listAiDrafts } from '../ai-suggestions';
import { createApplicant } from '../applicants';
import { listNeedsAttention } from '../attention';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { exportAccount } from '../export';
import { buildExportCsvTables } from '../export-csv';
import { getTravellerInsights } from '../insights-read';
import { createMission, listTasks, transitionMission } from '../missions';
import { addMembership, createOrganization, reviewOrganization } from '../organizations';
import { editFact, registerFieldDefinition } from '../profile';
import { requiresProtection, resetProtectedFieldKeyCacheForTests } from '../protected-fields';
import { RATE_LIMITS } from '../rate-limit';
import { exhaustRateLimit } from '../rate-limit.test-support';
import { assignReferenceCode, referenceCodesFor } from '../reference-codes';
import { acceptGrant, createGrant } from '../sharing';
import { issueStepUpAssurance } from '../step-up';
import { AI_TOOLS, runAiTool } from './index';
import { MESSAGES, describeResult } from './result';

/**
 * The three suggestion tools (S21, ADR 0021 extension "Suggest Changes"), end to end through the
 * real gate, token store, access gate and migrated database. Made-up values only.
 */

const RESOURCE = 'https://vs.example.test/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const STEP_UP_SECRET = 'test-step-up-secret';
const ADMIT = async () => true;
const CLAUDE = {
  clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
  clientName: 'Claude',
  clientHost: 'claude.ai',
};
const CHATGPT = {
  clientId: 'https://chatgpt.com/oauth/client-metadata',
  clientName: 'ChatGPT',
  clientHost: 'chatgpt.com',
};
const NEW_PHONE = '+8801700000999';
const PASSPORT_NUMBER = 'BX7319046';

const keys = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    return {
      keyVersion: 'test-v1',
      plaintextDataKey: randomBytes(32),
      wrappedDataKey: Buffer.alloc(32, 7),
    };
  },
  async unwrapDataKey() {
    return Buffer.alloc(32, 7);
  },
};

let db: Db;
/** One clock for every call in a test, so the daily limits count in one window. */
let now: Date;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  resetProtectedFieldKeyCacheForTests();
  now = new Date();
  // AI App Suggestions starts off; the platform owner turns it on in AI Features.
  await setFeature(true);
});

/** The platform owner's switch for AI App Suggestions, as the AI Features page saves it. */
async function setFeature(enabled: boolean, dailyLimit: number | null = null) {
  await db
    .insert(schema.platformAiFeatureSettings)
    .values({ featureKey: 'ai_app_suggestions', enabled, dailyLimit })
    .onConflictDoUpdate({
      target: schema.platformAiFeatureSettings.featureKey,
      set: { enabled, dailyLimit },
    });
}

const tool = (name: string) => {
  const found = AI_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(name);
  return found;
};

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

async function register(fieldKey: string) {
  const policy = fieldPolicyOf(fieldKey);
  if (!policy) throw new Error(`unknown field ${fieldKey}`);
  await registerFieldDefinition(db, {
    key: fieldKey,
    dataType: 'text',
    sensitivity: policy.sensitivity,
    repeating: policy.group !== undefined,
  });
  return policy;
}

async function fact(ownerId: string, applicantId: string, fieldKey: string, value: string) {
  const policy = await register(fieldKey);
  const edited = await editFact(db, {
    actorAccountId: ownerId,
    applicantId,
    fieldKey,
    value,
    ...(requiresProtection(policy.sensitivity) ? { encryption: keys } : {}),
  });
  if (!isOk(edited)) throw new Error(`fact ${fieldKey}`);
}

async function document(applicantId: string, docType: string) {
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
  const code = (await referenceCodesFor(db, 'D', [doc.id])).get(doc.id);
  if (!code) throw new Error('code');
  return { reference: code, versionId: version.id };
}

async function caseFor(ownerId: string, applicantId: string, title: string) {
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId,
    title,
    destination: 'United Kingdom',
    purpose: 'Visit family',
  });
  if (!isOk(mission)) throw new Error('mission');
  const code = (await referenceCodesFor(db, 'C', [mission.value.id])).get(mission.value.id);
  if (!code) throw new Error('case code');
  return { missionId: mission.value.id, reference: code };
}

const SUGGEST: Omit<AiConnectionChoices, 'missionId'> = {
  layers: ['identity', 'travel_documents'],
  caseMode: 'ALL_CURRENT',
  documentList: true,
  documentText: false,
  revealIdentifiers: false,
  duration: '30d',
  suggestChanges: true,
};

async function connect(
  ownerId: string,
  applicantId: string,
  choices: AiConnectionChoices,
  client = CLAUDE,
): Promise<{ token: string; connectionId: string }> {
  const proof = await requireAccess(
    db,
    accountPrincipal(ownerId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'ai_connection' },
  );
  if (!isOk(proof)) throw new Error('proof');
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
    client,
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
    clientId: client.clientId,
    redirectUri: REDIRECT,
    resource: RESOURCE,
  });
  if (!isOk(tokens)) throw new Error(tokens.error.description);
  return { token: tokens.value.access_token, connectionId: created.value.connectionId };
}

async function call(token: string, name: string, input: Record<string, unknown>) {
  return runAiTool(db, tool(name), input as never, {
    token,
    resource: RESOURCE,
    admission: ADMIT,
    encryption: keys,
    now,
  });
}

async function saved(token: string, name: string, input: Record<string, unknown>) {
  const outcome = await call(token, name, input);
  expect(outcome.kind).toBe('answered');
  expect(outcome.result.isError, JSON.stringify(outcome.result.content)).toBeUndefined();
  const parsed = tool(name).outputSchema.safeParse(outcome.result.structuredContent);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return outcome.result.structuredContent ?? {};
}

async function refused(token: string, name: string, input: Record<string, unknown>) {
  const outcome = await call(token, name, input);
  expect(outcome.kind).toBe('answered');
  expect(outcome.result.isError).toBe(true);
  return outcome.result.content[0]?.text ?? '';
}

/** A day `days` from today, as `YYYY-MM-DD` (UTC is the same day as Dhaka for days ahead). */
function dueIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
const DUE = dueIn(30);

const phoneSuggestion = {
  section: 'identity',
  field: 'phone',
  value: NEW_PHONE,
  reason: 'The person told me their number changed last week.',
};

async function counts() {
  const [proposals, runs, factVersions, drafts, tasks] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.fieldProposals),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.aiExtractionRuns),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.factVersions),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.aiDrafts),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.missionTasks),
  ]);
  return {
    proposals: proposals[0]?.n ?? 0,
    runs: runs[0]?.n ?? 0,
    factVersions: factVersions[0]?.n ?? 0,
    drafts: drafts[0]?.n ?? 0,
    tasks: tasks[0]?.n ?? 0,
  };
}

describe('suggest_profile_update', () => {
  it('leaves one pending suggestion and no fact until the person approves it', async () => {
    const { ownerId, applicantId } = await person();
    await fact(ownerId, applicantId, 'phone', '+8801700000111');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    const before = await counts();

    const answer = await saved(token, 'suggest_profile_update', phoneSuggestion);
    expect(answer).toMatchObject({
      status: 'waiting_for_approval',
      section: 'identity',
      document: null,
    });
    const after = await counts();
    expect(after.factVersions).toBe(before.factVersions);
    expect(after.proposals).toBe(before.proposals + 1);

    const [pending] = await listPendingProposals(db, applicantId);
    expect(pending?.proposal).toMatchObject({
      fieldKey: 'phone',
      value: NEW_PHONE,
      status: 'PENDING',
      documentVersionId: null,
      rationale: phoneSuggestion.reason,
      confidence: 0,
    });
    expect(pending?.fromApp).toEqual({ name: 'Claude', host: 'claude.ai' });
    const [run] = await db.select().from(schema.aiExtractionRuns);
    expect(run).toMatchObject({ modelVersion: 'connector:claude.ai', costUnits: 0 });

    // Kept out of every AI count and spend.
    expect(await totalAiCostUnits(db)).toBe(0);

    // Approving it is the person's own word: confirmed by them, entered by hand, no document.
    const approved = await approveProposal(db, {
      actorAccountId: ownerId,
      proposalId: pending?.proposal.id ?? '',
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.version).toMatchObject({
      value: NEW_PHONE,
      status: 'CONFLICTED',
      method: 'MANUAL',
      sourceDocumentVersionId: null,
    });
  });

  it('saves an approved suggestion as confirmed by the person when nothing was confirmed before', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'suggest_profile_update', phoneSuggestion);
    const [pending] = await listPendingProposals(db, applicantId);
    const approved = await approveProposal(db, {
      actorAccountId: ownerId,
      proposalId: pending?.proposal.id ?? '',
    });
    if (!isOk(approved)) throw new Error(approved.error.message);
    expect(approved.value.version).toMatchObject({
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
      sourceDocumentVersionId: null,
    });
    const events = await db
      .select()
      .from(schema.productEvents)
      .where(eq(schema.productEvents.eventType, 'AI_PROPOSAL_ACCEPTED'));
    expect(events.map((e) => e.dimension)).toEqual(['CONNECTOR']);
  });

  it('ties a suggestion to the latest version of a listed document, never as the document’s proof', async () => {
    const { ownerId, applicantId } = await person();
    await register('passport_expiry');
    const passport = await document(applicantId, 'PASSPORT');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    const answer = await saved(token, 'suggest_profile_update', {
      section: 'travel_documents',
      field: 'Passport Expiry',
      value: '2031-01-01',
      reason: 'Read from the passport the person showed me.',
      document_reference: passport.reference.toLowerCase(),
    });
    expect(answer).toMatchObject({ document: passport.reference });
    const [pending] = await listPendingProposals(db, applicantId);
    expect(pending?.proposal.documentVersionId).toBe(passport.versionId);
    const approved = await approveProposal(db, {
      actorAccountId: ownerId,
      proposalId: pending?.proposal.id ?? '',
    });
    if (!isOk(approved)) throw new Error(approved.error.message);
    expect(approved.value.version).toMatchObject({
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
      sourceDocumentVersionId: null,
    });

    // A document the connection cannot list is refused, and so is any document without the list.
    expect(
      await refused(token, 'suggest_profile_update', {
        ...phoneSuggestion,
        document_reference: 'D-ZZZZZZ',
      }),
    ).toBe(MESSAGES.documentNotOpen);
    const noList = await connect(ownerId, applicantId, { ...SUGGEST, documentList: false });
    expect(
      await refused(noList.token, 'suggest_profile_update', {
        ...phoneSuggestion,
        document_reference: passport.reference,
      }),
    ).toBe(MESSAGES.notShared);
  });

  it('refuses a detail outside the granted parts, a protected one, and a number without Full Document Numbers', async () => {
    const { ownerId, applicantId } = await person();
    for (const key of [
      'phone',
      'annual_income',
      'nid_number',
      'religion',
      'passport_number',
      'refusal_reason',
      'accessibility_needs',
    ]) {
      await register(key);
    }
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    const before = await counts();
    const tries = [
      // A section the person did not choose.
      [{ section: 'money', field: 'annual_income' }, MESSAGES.notShared],
      // A detail that is not in the section named.
      [{ section: 'identity', field: 'passport_expiry' }, MESSAGES.fieldNotOpen],
      // Protected details are never suggested by an app.
      [{ section: 'identity', field: 'nid_number' }, MESSAGES.fieldNotOpen],
      [{ section: 'identity', field: 'religion' }, MESSAGES.fieldNotOpen],
      [{ section: 'identity', field: 'accessibility_needs' }, MESSAGES.fieldNotOpen],
      // A document number needs Full Document Numbers.
      [{ section: 'travel_documents', field: 'passport_number' }, MESSAGES.fieldNotOpen],
      // A detail the catalogue does not know.
      [{ section: 'identity', field: 'favourite_colour' }, MESSAGES.fieldNotOpen],
    ] as const;
    for (const [target, message] of tries) {
      expect(
        await refused(token, 'suggest_profile_update', { ...phoneSuggestion, ...target }),
        `${target.field}`,
      ).toBe(message);
    }
    // Past refusals only with Past Refusals and Declarations.
    const withDeclarations = await connect(ownerId, applicantId, {
      ...SUGGEST,
      layers: ['identity', 'declarations'],
    });
    await saved(withDeclarations.token, 'suggest_profile_update', {
      ...phoneSuggestion,
      section: 'declarations',
      field: 'refusal_reason',
      value: 'Refused in 2019 for a missing bank letter',
    });
    expect((await counts()).proposals).toBe(before.proposals + 1);

    // With Full Document Numbers, a passport number may be suggested, and the answer is the same
    // whether or not it matches what is on file.
    const full = await connect(ownerId, applicantId, { ...SUGGEST, revealIdentifiers: true });
    await fact(ownerId, applicantId, 'passport_number', PASSPORT_NUMBER);
    const matching = await saved(full.token, 'suggest_profile_update', {
      ...phoneSuggestion,
      section: 'travel_documents',
      field: 'passport_number',
      value: PASSPORT_NUMBER,
    });
    const different = await saved(full.token, 'suggest_profile_update', {
      ...phoneSuggestion,
      section: 'travel_documents',
      field: 'passport_number',
      value: 'BX0000001',
    });
    expect(matching).toEqual(different);
    expect(JSON.stringify(matching)).not.toContain(PASSPORT_NUMBER);
  });

  it('answers a repeated suggestion with the same reply, writes it once and counts it once', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const { token, connectionId } = await connect(ownerId, applicantId, SUGGEST);
    const first = await saved(token, 'suggest_profile_update', phoneSuggestion);
    const again = await saved(token, 'suggest_profile_update', phoneSuggestion);
    expect(again).toEqual(first);
    expect((await counts()).proposals).toBe(1);
    const [bucket] = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.subjectId, connectionId));
    expect(bucket?.count).toBe(1);
  });

  it('is never accepted in bulk, never counts as AI use and never stops the reading of a file', async () => {
    const { ownerId, applicantId } = await person();
    await register('passport_expiry');
    const passport = await document(applicantId, 'PASSPORT');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'suggest_profile_update', {
      section: 'travel_documents',
      field: 'passport_expiry',
      value: '2031-01-01',
      reason: 'From the passport.',
      document_reference: passport.reference,
    });
    const [pending] = await listPendingProposals(db, applicantId);
    // Even if it looked like a clear reading (confident, quoted word for word), it is left to the person.
    await db
      .update(schema.fieldProposals)
      .set({ confidence: 99 })
      .where(eq(schema.fieldProposals.id, pending?.proposal.id ?? ''));
    await db.insert(schema.evidenceLocations).values({
      fieldProposalId: pending?.proposal.id ?? '',
      snippet: 'Expiry 2031-01-01',
      verified: true,
    });
    const bulk = await approveClearProposals(db, {
      actorAccountId: ownerId,
      applicantId,
      proposalIds: [pending?.proposal.id ?? ''],
    });
    expect(bulk).toEqual({ ok: true, value: { approved: 0, leftForReview: 1, alreadyDecided: 0 } });
    expect(await countAiExtractionAttempts(db, passport.versionId)).toBe(0);
    expect(await totalAiCostUnits(db)).toBe(0);
  });
});

describe('Suggest Changes is the person’s choice, read again on every call', () => {
  it('refuses every suggestion tool without it, and writes nothing', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, { ...SUGGEST, suggestChanges: false });
    const before = await counts();
    expect(await refused(token, 'suggest_profile_update', phoneSuggestion)).toBe(
      MESSAGES.suggestionsOff,
    );
    expect(await refused(token, 'save_draft', { title: 'Letter', body: 'Dear Sir' })).toBe(
      MESSAGES.suggestionsOff,
    );
    expect(
      await refused(token, 'add_reminder', {
        case_reference: trip.reference,
        title: 'Book it',
        due_date: DUE,
      }),
    ).toBe(MESSAGES.suggestionsOff);
    expect(await counts()).toEqual(before);
  });

  it('stops on the very next call after Change Access turns it off, with nothing written', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const { token, connectionId } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'save_draft', { title: 'Letter', body: 'Dear Sir or Madam' });
    const owner = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'ai_connection' },
    );
    if (!isOk(owner)) throw new Error('owner');
    const changed = await changeAiConnection(owner.value, {
      connectionId,
      choices: { ...SUGGEST, suggestChanges: false, duration: 'keep' },
    });
    expect(isOk(changed), JSON.stringify(changed)).toBe(true);
    const before = await counts();
    expect(await refused(token, 'save_draft', { title: 'Second', body: 'Dear Sir' })).toBe(
      MESSAGES.suggestionsOff,
    );
    expect(await refused(token, 'suggest_profile_update', phoneSuggestion)).toBe(
      MESSAGES.suggestionsOff,
    );
    expect(await counts()).toEqual(before);
  });

  it('refuses while the person has processing turned off', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    expect(await refused(token, 'suggest_profile_update', phoneSuggestion)).toBe(
      MESSAGES.consentNeeded,
    );
    expect((await counts()).proposals).toBe(0);
  });
});

describe('the daily limits', () => {
  it('saves 15 a day for one app, refuses the 16th, and the refusal writes nothing', async () => {
    const { ownerId, applicantId } = await person();
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    for (let n = 1; n <= 15; n++) {
      await saved(token, 'save_draft', { title: `Draft ${n}`, body: `Body ${n}` });
    }
    expect(await refused(token, 'save_draft', { title: 'Draft 16', body: 'Body 16' })).toBe(
      MESSAGES.writeLimit,
    );
    expect((await counts()).drafts).toBe(15);
    const denied = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_CONTEXT_DENIED'));
    expect(denied.map((e) => e.reason)).toEqual(['write_limit']);
  });

  it('holds 15 a day for the person across all their apps and all three tools', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const claude = await connect(ownerId, applicantId, SUGGEST);
    const chatgpt = await connect(ownerId, applicantId, SUGGEST, CHATGPT);
    for (let n = 1; n <= 5; n++) {
      await saved(claude.token, 'save_draft', { title: `Draft ${n}`, body: 'Body' });
      await saved(chatgpt.token, 'add_reminder', {
        case_reference: trip.reference,
        title: `Reminder ${n}`,
        due_date: DUE,
      });
    }
    for (let n = 1; n <= 5; n++) {
      await saved(chatgpt.token, 'suggest_profile_update', {
        ...phoneSuggestion,
        value: `+88017000001${n}`,
      });
    }
    // Neither app has reached 15 on its own, but the person has.
    expect(await refused(claude.token, 'save_draft', { title: 'One more', body: 'Body' })).toBe(
      MESSAGES.writeLimit,
    );
    const after = await counts();
    expect([after.drafts, after.tasks, after.proposals]).toEqual([5, 5, 5]);
  });

  it('applies a lower daily limit the platform owner set, never a higher one than the plan', async () => {
    const { ownerId, applicantId } = await person();
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await setFeature(true, 2);
    await saved(token, 'save_draft', { title: 'One', body: 'Body' });
    await saved(token, 'save_draft', { title: 'Two', body: 'Body' });
    expect(await refused(token, 'save_draft', { title: 'Three', body: 'Body' })).toBe(
      MESSAGES.writeLimit,
    );
    // A higher admin limit does not lift the plan's 15.
    const other = await person('second@example.com');
    const second = await connect(other.ownerId, other.applicantId, SUGGEST);
    await setFeature(true, 500);
    await exhaustRateLimit(
      db,
      other.ownerId,
      'ai_write.account',
      RATE_LIMITS.AI_WRITE_ACCOUNT_DAY,
      now,
    );
    expect(await refused(second.token, 'save_draft', { title: 'Over', body: 'Body' })).toBe(
      MESSAGES.writeLimit,
    );
  });
});

describe('the AI Features switch for AI App Suggestions', () => {
  it('refuses all three tools while off, keeps everything people already have, and loses nothing when back on', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'suggest_profile_update', phoneSuggestion);
    await saved(token, 'save_draft', {
      title: 'Letter',
      body: 'Dear Sir',
      case_reference: trip.reference,
    });
    await saved(token, 'add_reminder', {
      case_reference: trip.reference,
      title: 'Book',
      due_date: DUE,
    });
    const kept = await counts();

    await setFeature(false);
    expect(MESSAGES.featureOff.startsWith(AI_FEATURE_OFF_HINT)).toBe(true);
    expect(
      await refused(token, 'suggest_profile_update', { ...phoneSuggestion, value: '+1' }),
    ).toBe(MESSAGES.featureOff);
    expect(await refused(token, 'save_draft', { title: 'Two', body: 'Body' })).toBe(
      MESSAGES.featureOff,
    );
    expect(
      await refused(token, 'add_reminder', {
        case_reference: trip.reference,
        title: 'Two',
        due_date: DUE,
      }),
    ).toBe(MESSAGES.featureOff);
    expect(await counts()).toEqual(kept);
    // Reading still works, and what the person has stays: the suggestion, the draft, the reminder.
    const read = await call(token, 'list_cases', {});
    expect(read.result.isError).toBeUndefined();
    expect(await listPendingProposals(db, applicantId)).toHaveLength(1);
    const owner = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'ai_drafts' },
    );
    if (!isOk(owner)) throw new Error('owner');
    expect((await listAiDrafts(owner.value)).drafts).toHaveLength(1);
    const tasks = await listTasks(db, ownerId, trip.missionId);
    expect(isOk(tasks) && tasks.value[0]?.addedBy?.appName).toBe('Claude');
    // The suggestion can still be decided while the feature is off.
    const [pending] = await listPendingProposals(db, applicantId);
    expect(
      isOk(
        await approveProposal(db, {
          actorAccountId: ownerId,
          proposalId: pending?.proposal.id ?? '',
        }),
      ),
    ).toBe(true);

    await setFeature(true);
    await saved(token, 'save_draft', { title: 'Back', body: 'Body' });
    expect((await listAiDrafts(owner.value)).drafts).toHaveLength(2);
  });

  it('is off when the platform owner has never turned it on', async () => {
    const { ownerId, applicantId } = await person();
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await db.delete(schema.platformAiFeatureSettings);
    expect(await refused(token, 'save_draft', { title: 'Letter', body: 'Body' })).toBe(
      MESSAGES.featureOff,
    );
    expect((await counts()).drafts).toBe(0);
  });
});

describe('save_draft', () => {
  it('keeps a draft for the person only, with its case, and the person can remove it', async () => {
    const { ownerId, applicantId } = await person();
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    const answer = await saved(token, 'save_draft', {
      title: 'Cover Letter',
      body: 'Dear Sir or Madam,\n\nI am writing to apply.',
      case_reference: trip.reference,
    });
    expect(answer).toMatchObject({ status: 'saved', case: trip.reference });

    const owner = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'ai_drafts' },
    );
    if (!isOk(owner)) throw new Error('owner');
    const list = await listAiDrafts(owner.value);
    expect(list.available).toBe(true);
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({
      title: 'Cover Letter',
      body: 'Dear Sir or Madam,\n\nI am writing to apply.',
      caseTitle: 'London Trip',
      appName: 'Claude',
      appHost: 'claude.ai',
    });

    const manage = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'MANAGE',
      { applicantId },
      { purpose: 'ai_drafts' },
    );
    if (!isOk(manage)) throw new Error('manage');
    expect(isOk(await deleteAiDraft(manage.value, list.drafts[0]?.id ?? ''))).toBe(true);
    expect((await counts()).drafts).toBe(0);
    const [removed] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_DRAFT_DELETED'));
    expect(JSON.stringify(removed)).not.toContain('Dear Sir');
  });

  it('refuses a case the connection does not cover', async () => {
    const { ownerId, applicantId } = await person();
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const other = await caseFor(ownerId, applicantId, 'Paris Conference');
    const { token } = await connect(ownerId, applicantId, {
      ...SUGGEST,
      caseMode: 'ONE',
      missionId: trip.missionId,
    });
    expect(
      await refused(token, 'save_draft', {
        title: 'Letter',
        body: 'Body',
        case_reference: other.reference,
      }),
    ).toBe(MESSAGES.caseNotShared);
    const none = await connect(ownerId, applicantId, { ...SUGGEST, caseMode: 'NONE' });
    expect(
      await refused(none.token, 'save_draft', {
        title: 'Letter',
        body: 'Body',
        case_reference: trip.reference,
      }),
    ).toBe(MESSAGES.noCases);
    expect((await counts()).drafts).toBe(0);
  });
});

describe('add_reminder', () => {
  it('adds a task to the case, labelled with the app, due on the day given', async () => {
    const { ownerId, applicantId } = await person();
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    const answer = await saved(token, 'add_reminder', {
      case_reference: trip.reference,
      title: 'Book the biometrics appointment',
      due_date: DUE,
    });
    expect(answer).toMatchObject({ status: 'added', case: trip.reference, dueDate: DUE });
    const tasks = await listTasks(db, ownerId, trip.missionId);
    if (!isOk(tasks)) throw new Error('tasks');
    expect(tasks.value).toHaveLength(1);
    expect(tasks.value[0]).toMatchObject({
      description: 'Book the biometrics appointment',
      status: 'OPEN',
      dueTimezone: 'Asia/Dhaka',
      addedBy: { appName: 'Claude', appHost: 'claude.ai' },
    });
    expect(tasks.value[0]?.dueDate?.toISOString()).toBe(`${DUE}T00:00:00.000Z`);
  });

  it('refuses a past date, a closed case, and a case not covered', async () => {
    const { ownerId, applicantId } = await person();
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, {
      ...SUGGEST,
      caseMode: 'ONE',
      missionId: trip.missionId,
    });
    expect(
      await refused(token, 'add_reminder', {
        case_reference: trip.reference,
        title: 'Too late',
        due_date: '2001-01-01',
      }),
    ).toBe(MESSAGES.invalidInput);
    expect(
      await refused(token, 'add_reminder', {
        case_reference: trip.reference,
        title: 'Not a day',
        due_date: `${DUE.slice(0, 5)}02-30`,
      }),
    ).toBe(MESSAGES.invalidInput);
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: trip.missionId,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled), JSON.stringify(cancelled)).toBe(true);
    expect(
      await refused(token, 'add_reminder', {
        case_reference: trip.reference,
        title: 'Book it',
        due_date: DUE,
      }),
    ).toBe(MESSAGES.caseFinished);
    expect((await counts()).tasks).toBe(0);
  });
});

describe('the audit trail of suggestions', () => {
  it('records the kind, the app and a count, never a value, reason, title or text', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'suggest_profile_update', phoneSuggestion);
    await saved(token, 'save_draft', { title: 'Secret Title', body: 'Secret body text' });
    await saved(token, 'add_reminder', {
      case_reference: trip.reference,
      title: 'Secret reminder',
      due_date: DUE,
    });
    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          like(schema.auditEvents.eventType, 'AI_%'),
          eq(schema.auditEvents.applicantId, applicantId),
        ),
      );
    const suggested = rows.filter((row) => row.eventType === 'AI_CHANGE_SUGGESTED');
    expect(suggested.map((row) => row.metadata)).toEqual([
      expect.objectContaining({ kind: 'profile_suggestion', layer: 'identity', count: 1 }),
      expect.objectContaining({ kind: 'draft', count: 1 }),
      expect.objectContaining({ kind: 'reminder', count: 1 }),
    ]);
    const all = JSON.stringify(await db.select().from(schema.auditEvents));
    for (const secret of [
      NEW_PHONE,
      phoneSuggestion.reason,
      'Secret Title',
      'Secret body text',
      'Secret reminder',
      'phone',
    ]) {
      expect(all, secret).not.toContain(secret);
    }
  });
});

describe('the gateway a suggestion tool gets', () => {
  it('has exactly the three writes, and a read tool’s gateway has none', async () => {
    const { ownerId, applicantId } = await person();
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    let seen: readonly string[] = [];
    await withAiSuggestionConnection(
      db,
      { token, resource: RESOURCE, tool: 'save_draft', admission: ADMIT, now },
      async (gateway: AiWriteGateway) => {
        seen = Object.keys(gateway.writes).sort();
        expect(Object.isFrozen(gateway)).toBe(true);
        expect(Object.isFrozen(gateway.writes)).toBe(true);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      },
      describeResult,
    );
    expect(seen).toEqual(['addReminder', 'saveDraft', 'suggestProfileUpdate']);
    let readKeys: readonly string[] = [];
    const reader = AI_TOOLS.find((t) => t.name === 'list_cases');
    if (!reader) throw new Error('list_cases');
    await runAiTool(
      db,
      {
        ...reader,
        async run(gateway) {
          readKeys = Object.keys(gateway);
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
      {} as never,
      { token, resource: RESOURCE, admission: ADMIT, now },
    );
    expect(readKeys).not.toContain('writes');
  });
});

describe('what an agency sees (owner decision 30 Oct 2026: AI reminders are private)', () => {
  it('never sees or changes a reminder an AI app added, nor a draft, even on a case it manages', async () => {
    const { ownerId, applicantId } = await person();
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'add_reminder', {
      case_reference: trip.reference,
      title: 'Book the biometrics appointment',
      due_date: DUE,
    });
    await saved(token, 'save_draft', {
      title: 'Private Draft',
      body: 'Only for me',
      case_reference: trip.reference,
    });

    const admin = await provisionAccount(db, { email: 'admin@harbor.example.com' });
    const member = await provisionAccount(db, { email: 'member@harbor.example.com' });
    if (!isOk(admin) || !isOk(member)) throw new Error('agents');
    const org = await createOrganization(db, { actorAccountId: admin.value.id, name: 'Harbor' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await provisionAccount(db, { email: 'reviewer@platform.example.com' });
    if (!isOk(reviewer)) throw new Error('reviewer');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    await addMembership(db, {
      actorAccountId: admin.value.id,
      organizationId: org.value.id,
      accountId: member.value.id,
      role: 'CASE_MANAGER',
    });
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'SHARING',
      granted: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA', 'MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    await acceptGrant(db, { actorAccountId: admin.value.id, grantId: grant.value.id });
    await assignMember(db, {
      actorAccountId: admin.value.id,
      organizationId: org.value.id,
      memberAccountId: member.value.id,
      missionId: trip.missionId,
    });

    // The owner sees it, labelled; the agency's list leaves it out.
    const own = await listTasks(db, ownerId, trip.missionId);
    if (!isOk(own)) throw new Error('own tasks');
    expect(own.value).toHaveLength(1);
    const taskId = own.value[0]?.id ?? '';
    expect(await listTasksForOrg(db, org.value.id, applicantId, trip.missionId)).toEqual([]);
    // Nor can the agency change it by its id.
    const update = await updateTaskForOrg(db, {
      actorAccountId: member.value.id,
      organizationId: org.value.id,
      missionId: trip.missionId,
      taskId,
      priority: 'HIGH',
    });
    expect(update.ok ? 'changed' : update.error.code).toBe('not_found');
    const decide = await decideTaskForOrg(db, {
      actorAccountId: member.value.id,
      organizationId: org.value.id,
      missionId: trip.missionId,
      taskId,
      status: 'DONE',
    });
    expect(decide.ok ? 'changed' : decide.error.code).toBe('not_found');
    const after = await listTasks(db, ownerId, trip.missionId);
    expect(isOk(after) && after.value[0]).toMatchObject({ status: 'OPEN', priority: 'NORMAL' });

    // A task the person added by hand is still shared as before.
    await db
      .insert(schema.missionTasks)
      .values({ missionId: trip.missionId, description: 'By hand' });
    expect(
      (await listTasksForOrg(db, org.value.id, applicantId, trip.missionId)).map(
        (t) => t.description,
      ),
    ).toEqual(['By hand']);

    const agency = await requireAccess(
      db,
      accountPrincipal(admin.value.id),
      'VIEW_METADATA',
      { applicantId },
      { purpose: EACH_GRANT, actingFor: { organizationId: org.value.id } },
    );
    if (!isOk(agency)) throw new Error(`agency access: ${agency.error.message}`);
    expect(agency.value.actor.kind).not.toBe('applicant_owner');
    expect((await listAiDrafts(agency.value)).drafts).toEqual([]);
  });
});

describe('Suggest Changes can only be added while the feature is on (security review S1)', () => {
  const scopesOf = async (connectionId: string) =>
    (
      await db
        .select({ scopes: schema.aiConnections.scopes })
        .from(schema.aiConnections)
        .where(eq(schema.aiConnections.id, connectionId))
    )[0]?.scopes ?? [];
  const change = async (ownerId: string, applicantId: string, id: string, suggest: boolean) => {
    const owner = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'ai_connection' },
    );
    if (!isOk(owner)) throw new Error('owner');
    const changed = await changeAiConnection(owner.value, {
      connectionId: id,
      choices: { ...SUGGEST, suggestChanges: suggest, duration: 'keep' },
    });
    if (!isOk(changed)) throw new Error('change');
  };

  it('a consent sent while the feature is off stores no Suggest Changes; once on, it does', async () => {
    const { ownerId, applicantId } = await person();
    await setFeature(false);
    const off = await connect(ownerId, applicantId, SUGGEST);
    expect(await scopesOf(off.connectionId)).not.toContain('suggest_changes');
    await setFeature(true);
    const on = await connect(ownerId, applicantId, SUGGEST);
    expect(await scopesOf(on.connectionId)).toContain('suggest_changes');
  });

  it('while off, Change Access can keep or remove it, never add it', async () => {
    const { ownerId, applicantId } = await person();
    const had = await connect(ownerId, applicantId, SUGGEST);
    const never = await connect(ownerId, applicantId, { ...SUGGEST, suggestChanges: false });
    await setFeature(false);
    await change(ownerId, applicantId, had.connectionId, true);
    expect(await scopesOf(had.connectionId)).toContain('suggest_changes');
    await change(ownerId, applicantId, never.connectionId, true);
    expect(await scopesOf(never.connectionId)).not.toContain('suggest_changes');
    await change(ownerId, applicantId, had.connectionId, false);
    expect(await scopesOf(had.connectionId)).not.toContain('suggest_changes');
    // And once removed while off, it cannot come back until the feature is on.
    await change(ownerId, applicantId, had.connectionId, true);
    expect(await scopesOf(had.connectionId)).not.toContain('suggest_changes');
  });
});

describe('S21 review round 2', () => {
  const ownerRead = async (ownerId: string, applicantId: string) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'ai_review' },
    );
    if (!isOk(proof)) throw new Error('owner');
    return proof.value;
  };

  it('registers a catalogue detail nobody has saved yet, as saving it by hand would', async () => {
    const { ownerId, applicantId } = await person();
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    expect(
      await db
        .select()
        .from(schema.fieldDefinitions)
        .where(eq(schema.fieldDefinitions.key, 'phone')),
    ).toEqual([]);
    await saved(token, 'suggest_profile_update', phoneSuggestion);
    const [definition] = await db
      .select()
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, 'phone'));
    expect(definition).toMatchObject({ sensitivity: 'STANDARD', repeating: false });
    const [pending] = await listPendingProposals(db, applicantId);
    expect(
      isOk(
        await approveProposal(db, {
          actorAccountId: ownerId,
          proposalId: pending?.proposal.id ?? '',
        }),
      ),
    ).toBe(true);
  });

  it('counts profile suggestions apart on Home, linking to My Profile, and keeps them out of insights', async () => {
    const { ownerId, applicantId } = await person();
    await fact(ownerId, applicantId, 'passport_expiry', '2031-01-01');
    const passport = await document(applicantId, 'PASSPORT');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'suggest_profile_update', phoneSuggestion);
    await saved(token, 'suggest_profile_update', {
      section: 'travel_documents',
      field: 'passport_expiry',
      value: '2032-02-02',
      reason: 'The person said the passport was renewed.',
      document_reference: passport.reference,
    });
    const attention = await listNeedsAttention(await ownerRead(ownerId, applicantId), { now });
    if (!isOk(attention)) throw new Error('attention');
    const suggestionItems = attention.value.items
      .filter((item) => item.kind === 'suggestions')
      .map((item) => ({ title: item.title, count: item.count, href: item.href }));
    expect(suggestionItems).toEqual(
      expect.arrayContaining([
        {
          title: 'Suggestions from AI Apps Waiting for You',
          count: 1,
          href: `/app/applicant/${applicantId}/profile#ai-app-suggestions`,
        },
        {
          title: 'Suggested Details Waiting for Your Decision',
          count: 1,
          href: `/app/applicant/${applicantId}/documents`,
        },
      ]),
    );
    // An app's claim about the passport is never shown as something read from the file.
    const insights = await getTravellerInsights(await ownerRead(ownerId, applicantId), {
      now,
    });
    if (!isOk(insights)) throw new Error('insights');
    expect(insights.value.mismatches).toEqual([]);
  });

  it('treats an empty optional reference as no reference', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    expect(
      await saved(token, 'suggest_profile_update', { ...phoneSuggestion, document_reference: '' }),
    ).toMatchObject({ document: null });
    expect(
      await saved(token, 'save_draft', { title: 'Letter', body: 'Body', case_reference: '' }),
    ).toMatchObject({ case: null });
  });

  it('answers a resend of the 15th write as already waiting, and still refuses a 16th', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    for (let n = 1; n <= 14; n++) {
      await saved(token, 'save_draft', { title: `Draft ${n}`, body: 'Body' });
    }
    const first = await saved(token, 'suggest_profile_update', phoneSuggestion);
    // The app timed out and sent the same suggestion again: the same answer, nothing new.
    expect(await saved(token, 'suggest_profile_update', phoneSuggestion)).toEqual(first);
    expect(await refused(token, 'save_draft', { title: 'Draft 16', body: 'Body' })).toBe(
      MESSAGES.writeLimit,
    );
    expect((await counts()).proposals).toBe(1);
  });

  it('puts drafts, tasks, which app added them and the AI connections in the account export', async () => {
    const { ownerId, applicantId } = await person();
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await saved(token, 'save_draft', { title: 'Letter', body: 'Dear Sir' });
    await saved(token, 'add_reminder', {
      case_reference: trip.reference,
      title: 'Book it',
      due_date: DUE,
    });
    const exported = await exportAccount(db, { actorAccountId: ownerId, accountId: ownerId });
    if (!isOk(exported)) throw new Error('export');
    expect(exported.value.manifest.counts).toMatchObject({
      aiDrafts: 1,
      missionTasks: 1,
      aiTaskOrigins: 1,
      aiConnections: 1,
    });
    const tables = buildExportCsvTables(exported.value);
    const rows = (name: string) => tables.find((table) => table.name === name)?.rowCount;
    expect([
      rows('ai_drafts.csv'),
      rows('mission_tasks.csv'),
      rows('ai_task_origins.csv'),
      rows('ai_connections.csv'),
    ]).toEqual([1, 1, 1, 1]);
    // Token hashes are never part of it.
    expect(JSON.stringify(exported.value)).not.toContain('token_hash');
    expect(JSON.stringify(exported.value)).not.toContain('tokenHash');
  });
});

describe('S21 review round 3', () => {
  /** Runs `body` with every statement the code sends to the database written down. */
  async function recording<T>(body: () => Promise<T>) {
    const plain = db;
    const statements: string[] = [];
    const client = (plain as unknown as { $client: PGlite }).$client;
    db = drizzle(client, {
      schema,
      logger: { logQuery: (query) => void statements.push(query) },
    }) as unknown as Db;
    try {
      return { value: await body(), statements };
    } finally {
      db = plain;
    }
  }
  const touches = (statements: readonly string[], table: string) =>
    statements.filter((statement) => statement.includes(`"${table}"`));

  it('an app at its daily limit does no expensive work: no document list, no case lookup', async () => {
    const { ownerId, applicantId } = await person();
    await register('phone');
    const passport = await document(applicantId, 'PASSPORT');
    const trip = await caseFor(ownerId, applicantId, 'London Trip');
    const { token } = await connect(ownerId, applicantId, SUGGEST);
    await exhaustRateLimit(db, ownerId, 'ai_write.account', RATE_LIMITS.AI_WRITE_ACCOUNT_DAY, now);
    const suggestion = await recording(() =>
      refused(token, 'suggest_profile_update', {
        ...phoneSuggestion,
        document_reference: passport.reference,
      }),
    );
    expect(suggestion.value).toBe(MESSAGES.writeLimit);
    expect(touches(suggestion.statements, 'documents')).toEqual([]);
    expect(touches(suggestion.statements, 'document_versions')).toEqual([]);
    const reminder = await recording(() =>
      refused(token, 'add_reminder', {
        case_reference: trip.reference,
        title: 'Book it',
        due_date: DUE,
      }),
    );
    expect(reminder.value).toBe(MESSAGES.writeLimit);
    expect(touches(reminder.statements, 'missions')).toEqual([]);
    const draft = await recording(() =>
      refused(token, 'save_draft', {
        title: 'Letter',
        body: 'Body',
        case_reference: trip.reference,
      }),
    );
    expect(draft.value).toBe(MESSAGES.writeLimit);
    expect(touches(draft.statements, 'missions')).toEqual([]);
    expect(await counts()).toMatchObject({ proposals: 0, drafts: 0, tasks: 0 });
  });
});
