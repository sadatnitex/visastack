import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { type Result, isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiClassifyOutcome,
  type AiClassifyPort,
  type AiExplainOutcome,
  type AiExplainPort,
  type AiExtractionOutcome,
  type AiExtractionPort,
  type AiInconsistencyOutcome,
  type AiInconsistencyPort,
  type FieldProposal,
  acknowledgeInconsistencyFlag,
  approveDocumentTypeProposal,
  approveProposal,
  dismissInconsistencyFlag,
  documentAiCostUnits,
  explainReadinessGap,
  getLatestOcrRun,
  listPendingDocumentTypeProposals,
  listPendingInconsistencyFlags,
  listPendingProposals,
  rejectDocumentTypeProposal,
  rejectProposal,
  runClassification,
  runExtraction,
  runInconsistencyCheck,
  runOcr,
  totalAiCostUnits,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import type { ServiceError } from './errors';
import type { AiOcrOutcome, AiOcrPort, AiOcrUsage } from './ocr';
import type { KeyManagementPort } from './ports';
import { editFact, getCurrentFactVersion, registerFieldDefinition } from './profile';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedVersion(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return { account, applicantId: applicant.value.id, versionId: version.value.version.id };
}

/** A deterministic, fixed-key test double, matching protected-fields.test.ts's own fixture. */
function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return { keyVersion, plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

async function grantAiConsent(db: Db, accountId: string) {
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'AI_EXTRACTION',
    granted: true,
  });
}

/**
 * Directly inserts an IN_FLIGHT `ai_extraction_runs` row, standing in for
 * another request's own reservation that is still genuinely mid-flight.
 * PGlite fully serializes db.transaction() calls (see the note above the
 * deliberately-absent race test below), so this is how this file simulates
 * concurrent state it cannot produce through real interleaving.
 */
async function insertInFlightRun(
  db: Db,
  documentVersionId: string,
  applicantId: string,
  createdAt?: Date,
): Promise<string> {
  const [row] = await db
    .insert(schema.aiExtractionRuns)
    .values({
      documentVersionId,
      applicantId,
      status: 'IN_FLIGHT',
      modelVersion: 'unknown',
      promptVersion: 'unknown',
      ...(createdAt ? { createdAt } : {}),
    })
    .returning();
  return (row as { id: string }).id;
}

const proposals: FieldProposal[] = [
  {
    type: 'NEW',
    fieldKey: 'passport.number',
    value: 'L898902C3',
    confidence: 0.98,
    rationale: 'MRZ line 2 matches',
    evidenceSnippet: 'L898902C36UTO7408122F1204159ZE184226B',
  },
  { type: 'UNMAPPED', value: 'mystery', confidence: 0.4 },
];

function stubAi(
  result: AiExtractionOutcome = { ok: true, result: { proposals, usage } },
): AiExtractionPort {
  return {
    async extract() {
      return result;
    },
    cacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'p1', schemaVersion: 's1' };
    },
  };
}

/** Same shape as stubAi, but counts real adapter invocations — for asserting a cache hit never calls it again. */
function countingStubAi(result: AiExtractionOutcome = { ok: true, result: { proposals, usage } }): {
  ai: AiExtractionPort;
  callCount: () => number;
} {
  let calls = 0;
  const ai: AiExtractionPort = {
    async extract() {
      calls += 1;
      return result;
    },
    cacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'p1', schemaVersion: 's1' };
    },
  };
  return { ai, callCount: () => calls };
}

const usage = {
  costUnits: 3,
  inputUnits: 2,
  outputUnits: 1,
  cachedUnits: 0,
  modelVersion: 'gpt-5.6-terra',
  promptVersion: 'p1',
  schemaVersion: 's1',
  provider: 'openai',
  latencyMs: 42,
};

describe('AI Gateway — proposals never silently mutate', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('requires AI_EXTRACTION consent to run', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai1@example.com');
    const denied = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('consent_required');
  });

  it('runs, persists proposals + evidence without mutating, then approves atomically with provenance', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai2@example.com');
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });

    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    expect(isOk(run)).toBe(true);
    if (!isOk(run)) return;
    expect(run.value.proposals).toHaveLength(2);
    expect(run.value.proposals[0]?.confidence).toBe(98);
    expect(await totalAiCostUnits(db)).toBe(3);
    // No facts were written by extraction — only proposals.
    expect(await db.select().from(schema.facts)).toHaveLength(0);

    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(eq(schema.evidenceLocations.fieldProposalId, run.value.proposals[0]?.id ?? ''));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.snippet).toContain('L898902C3');

    const pending = await listPendingProposals(db, applicantId);
    expect(pending).toHaveLength(2);

    const mappedProposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')?.id;
    expect(mappedProposalId).toBeDefined();

    const approved = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId: mappedProposalId as string,
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    const current = await getCurrentFactVersion(db, approved.value.fact.id);
    expect(current?.value).toBe('L898902C3');
    expect(current?.status).toBe('DOCUMENT_SUPPORTED');
    expect(current?.method).toBe('DOCUMENT');
    expect(current?.sourceDocumentVersionId).toBe(versionId);
    expect(current?.modelVersion).toBe('gpt-5.6-terra');

    const remaining = await listPendingProposals(db, applicantId);
    expect(remaining).toHaveLength(1);
  });

  it('threads an encryption port through to a RESTRICTED field approval (Commercial V1 SEC-03): fails closed without one, protects the value with one', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-restricted@example.com');
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, {
      key: 'passport.number',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const mappedProposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;

    const withoutPort = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId: mappedProposalId,
    });
    expect(isErr(withoutPort)).toBe(true);
    if (isErr(withoutPort)) expect(withoutPort.error.code).toBe('encryption_unavailable');
    // Still PENDING, not silently consumed by the failed attempt above — both
    // fixture proposals (the mapped one and the UNMAPPED one) remain.
    expect(await listPendingProposals(db, applicantId)).toHaveLength(2);

    const port = fakeKeyManagementPort();
    const withPort = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId: mappedProposalId,
      encryption: port,
    });
    expect(isOk(withPort)).toBe(true);
    if (!isOk(withPort)) return;

    const rows = await db.select().from(schema.factVersions);
    const row = rows.find((r) => r.id === withPort.value.version.id);
    expect(row?.value).toBeNull();
    expect(row?.valueCiphertext).not.toBeNull();
    expect(Buffer.from(row?.valueCiphertext ?? []).includes('L898902C3')).toBe(false);
    // Only the mapped proposal was decided — the UNMAPPED one is still pending.
    expect(await listPendingProposals(db, applicantId)).toHaveLength(1);
  });

  it('refuses to approve a proposal (writing to the Master Profile) once CORE_PROCESSING consent has been revoked, even though AI_EXTRACTION consent remains granted (Codex review, PR #65)', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-core-revoked@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const mappedProposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;

    // Core processing consent is revoked — AI_EXTRACTION consent (checked
    // only by `runExtraction`, above) stays granted, so existing proposals
    // remain visible, but approving one writes to the Master Profile via
    // `editFact`, which is gated on CORE_PROCESSING.
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'CORE_PROCESSING',
      granted: false,
    });

    const approved = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId: mappedProposalId,
    });
    expect(isErr(approved)).toBe(true);
    if (isErr(approved)) expect(approved.error.code).toBe('consent_required');

    // Nothing was written, and the proposal is still pending — decidable
    // again once core processing consent is restored.
    expect(await db.select().from(schema.facts)).toHaveLength(0);
    const stillPending = await listPendingProposals(db, applicantId);
    expect(stillPending.some((p) => p.proposal.id === mappedProposalId)).toBe(true);
  });

  it('refuses to re-approve an already-decided proposal', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-idempotent@example.com');
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const proposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;

    const first = await approveProposal(db, { actorAccountId: account.id, proposalId });
    expect(isOk(first)).toBe(true);
    const second = await approveProposal(db, { actorAccountId: account.id, proposalId });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('refuses to approve an UNMAPPED proposal', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai3@example.com');
    await grantAiConsent(db, account.id);
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const unmappedId = run.value.proposals.find((p) => p.type === 'UNMAPPED')?.id as string;
    const result = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId: unmappedId,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('unknown_field');
  });

  it('rejects a proposal without touching the profile', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-reject@example.com');
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const proposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;
    const rejected = await rejectProposal(db, {
      actorAccountId: account.id,
      proposalId,
      reason: 'looks wrong',
    });
    expect(isOk(rejected)).toBe(true);
    expect(await db.select().from(schema.facts)).toHaveLength(0);
    expect(await listPendingProposals(db, applicantId)).toHaveLength(1);
  });

  it('enforces the durable, platform-wide cost budget across separate calls', async () => {
    const {
      account: a1,
      applicantId: ap1,
      versionId: v1,
    } = await seedVersion(db, 'ai4@example.com');
    await grantAiConsent(db, a1.id);
    const first = await runExtraction(db, stubAi(), {
      actorAccountId: a1.id,
      applicantId: ap1,
      documentVersionId: v1,
      text: 'MRZ...',
      budgetLimitUnits: 3,
    });
    expect(isOk(first)).toBe(true);
    expect(await totalAiCostUnits(db)).toBe(3);

    // A second, unrelated caller is blocked once the platform-wide budget is spent —
    // the guard is a durable ledger, not a per-call in-memory counter.
    const {
      account: a2,
      applicantId: ap2,
      versionId: v2,
    } = await seedVersion(db, 'ai5@example.com');
    await grantAiConsent(db, a2.id);
    const second = await runExtraction(db, stubAi(), {
      actorAccountId: a2.id,
      applicantId: ap2,
      documentVersionId: v2,
      text: 'MRZ...',
      budgetLimitUnits: 3,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('records a FAILED run and no proposals when the adapter fails', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-fail@example.com');
    await grantAiConsent(db, account.id);
    const failing = stubAi({ ok: false, code: 'upstream_error', message: 'timeout' });
    const result = await runExtraction(db, failing, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('upstream_error');
    expect(await totalAiCostUnits(db)).toBe(0);
    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('FAILED');
    expect(runs[0]?.errorCode).toBe('upstream_error');
  });

  it('flags a conflict instead of silently overwriting an already-confirmed value', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-conflict@example.com');
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });

    // The applicant already confirmed a value manually.
    const manual = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'DIFFERENT123',
      status: 'APPLICANT_CONFIRMED',
    });
    if (!isOk(manual)) throw new Error('manual edit failed');

    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const proposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;

    const approved = await approveProposal(db, { actorAccountId: account.id, proposalId });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.version.status).toBe('CONFLICTED');
    expect(approved.value.version.value).toBe('L898902C3');

    const conflictRows = await db
      .select()
      .from(schema.conflicts)
      .where(eq(schema.conflicts.fieldProposalId, proposalId));
    expect(conflictRows).toHaveLength(1);
    expect(conflictRows[0]?.previousFactVersionId).toBe(manual.value.version.id);
    expect(conflictRows[0]?.newFactVersionId).toBe(approved.value.version.id);
  });

  it('records correction feedback when a human edits a value before approving', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-correct@example.com');
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const proposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;

    const approved = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId,
      correctedValue: 'L898902C3-CORRECTED',
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.version.value).toBe('L898902C3-CORRECTED');

    const feedback = await db
      .select()
      .from(schema.correctionFeedback)
      .where(eq(schema.correctionFeedback.fieldProposalId, proposalId));
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.originalValue).toBe('L898902C3');
    expect(feedback[0]?.correctedValue).toBe('L898902C3-CORRECTED');
  });

  it('enforces a per-document budget cap independent of the platform-wide cap', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-doc-budget@example.com');
    await grantAiConsent(db, account.id);
    const first = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      perDocumentBudgetLimitUnits: 3,
    });
    expect(isOk(first)).toBe(true);

    const second = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      perDocumentBudgetLimitUnits: 3,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('enforces a max-attempts cap per document', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-attempts@example.com');
    await grantAiConsent(db, account.id);
    const first = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isOk(first)).toBe(true);

    // Deliberately DIFFERENT text from the first call — this must be a
    // genuinely new (cache-miss) attempt, not a cache-hit-eligible repeat,
    // so the limit refuses it for the reason this test names. Reusing the
    // identical text here (as this test did before finding #28's fix) would
    // make this a cache hit instead — a different, already-covered scenario
    // (see "does not let cache hits exhaust the per-document attempt limit").
    const second = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'a second, different document entirely',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  // NOTE: a genuine concurrent-request race test (two Promise.all'd
  // runExtraction calls for the same document, asserting the attempt cap is
  // never bypassed) is deliberately not included here. PGlite fully
  // serializes db.transaction() calls — a second transaction's callback
  // never begins until the first's has completely committed — so two
  // overlapping runExtraction calls can never actually interleave inside
  // this test suite regardless of whether the advisory lock in ai.ts is
  // present. Confirmed by direct experiment (temporarily removing the lock
  // still passed such a test), so it was removed rather than kept as
  // something that looks like coverage but cannot fail. The above sequential
  // test covers the check logic itself; the lock's cross-connection
  // serialization is a documented Postgres guarantee (see ai.ts's doc
  // comment on runExtraction), not something PGlite can exercise — see
  // docs/security/durable-jobs-and-upload-integrity.md's "not yet covered".
  // The same reasoning applies identically to the second (platform-wide,
  // finding #20) lock added alongside this one — no separate note repeats it.

  it('does not let cache hits exhaust the per-document attempt limit (finding #28)', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-cache-attempts@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isOk(first)).toBe(true);
    expect(callCount()).toBe(1);

    // Three more identical (cache-hit-eligible) requests, well past the
    // attempt limit of 1 — every one must still succeed, served from cache,
    // without ever invoking the adapter again. Before the fix, the SECOND of
    // these alone would have been refused: countAiExtractionAttempts counted
    // the first call's cache-hit-eligible repeats as attempts, even though
    // they cost nothing and did no new AI work.
    for (let i = 0; i < 3; i++) {
      const repeat = await runExtraction(db, ai, {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ...',
        budgetLimitUnits: 1000,
        maxAttemptsPerDocument: 1,
      });
      expect(isOk(repeat)).toBe(true);
    }
    expect(callCount()).toBe(1);

    // A genuinely new (non-cache-hit-eligible — different text) request
    // still correctly hits the SAME limit of 1: the fix excludes cache hits
    // specifically, not attempts in general.
    const genuinelyNewAtLimit = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'a completely different document',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isErr(genuinelyNewAtLimit)).toBe(true);
    if (isErr(genuinelyNewAtLimit)) expect(genuinelyNewAtLimit.error.code).toBe('invalid');
    expect(callCount()).toBe(1);

    // Same still-uncached request, limit raised to 2 (one more than the
    // single genuine attempt made so far): now succeeds. This specifically
    // isolates countAiExtractionAttempts's own row-exclusion (finding #28) —
    // the count it returns here must be 1 (the one real row), not 4 (the
    // real row plus the 3 cache-hit rows above), or this would still be
    // wrongly refused (4 >= 2) despite only 1 attempt ever being genuinely
    // paid. The earlier assertions alone can't tell these apart, since with
    // the cache lookup reordered ahead of this check (also finding #28), a
    // cache HIT never reaches countAiExtractionAttempts at all regardless of
    // whether it excludes cache rows — only a request that is itself a
    // cache MISS, after cache hits already exist in the table, exercises
    // the exclusion.
    const genuinelyNewUnderRaisedLimit = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'a completely different document',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 2,
    });
    expect(isOk(genuinelyNewUnderRaisedLimit)).toBe(true);
    expect(callCount()).toBe(2);
  });

  it('refuses to run AI extraction on a document over the configured page limit', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-pages@example.com');
    await grantAiConsent(db, account.id);
    const [run] = await db
      .insert(schema.processingRuns)
      .values({ documentVersionId: versionId, pipelineVersion: '1.0.0', status: 'COMPLETED' })
      .returning();
    await db.insert(schema.extractionRuns).values({
      processingRunId: (run as { id: string }).id,
      documentVersionId: versionId,
      parserName: 'test',
      parserVersion: '1.0.0',
      status: 'SUCCEEDED',
      extractedText: 'MRZ...',
      pageCount: 50,
    });

    const result = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      maxPagesPerDocument: 10,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });
});

describe('AI Gateway — caching and schema version (master directive §7 "PR 9")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('serves a second identical request from cache, at zero cost, without invoking the adapter again', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-cache-hit@example.com');
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(callCount()).toBe(1);
    expect(await totalAiCostUnits(db)).toBe(3);

    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    // The adapter was never invoked a second time — served entirely from cache.
    expect(callCount()).toBe(1);
    // A cache hit costs nothing — the ledger total is unchanged by the second call.
    expect(await totalAiCostUnits(db)).toBe(3);
    expect(second.value.proposals).toHaveLength(first.value.proposals.length);

    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId))
      .orderBy(schema.aiExtractionRuns.createdAt);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.costUnits).toBe(3);
    expect(runs[1]?.costUnits).toBe(0);
    expect(runs[1]?.servedFromCacheRunId).toBe(runs[0]?.id);
    expect(runs[1]?.cacheKey).toBe(runs[0]?.cacheKey);
    expect(runs[1]?.cacheKey).not.toBeNull();

    const cacheHitEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_EXTRACTION_CACHE_HIT'));
    expect(cacheHitEvents).toHaveLength(1);
  });

  it('never serves a cache hit older than 30 days (PRV-02, Part 7 §11: "AI cache: <=30d later") -- runs and pays for a fresh extraction instead', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-cache-stale@example.com');
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(callCount()).toBe(1);

    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.aiExtractionRuns)
      .set({ createdAt: thirtyOneDaysAgo })
      .where(eq(schema.aiExtractionRuns.id, first.value.aiExtractionRunId));

    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    // The stale match was never served -- a genuinely new, billed call ran instead.
    expect(callCount()).toBe(2);
    expect(await totalAiCostUnits(db)).toBe(6);

    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId))
      .orderBy(schema.aiExtractionRuns.createdAt);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.costUnits).toBe(3);
    expect(runs[1]?.servedFromCacheRunId).toBeNull();
  });

  it('serves a cache hit at exactly 29 days old (still within the default window)', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-cache-still-fresh@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.aiExtractionRuns)
      .set({ createdAt: twentyNineDaysAgo })
      .where(eq(schema.aiExtractionRuns.id, first.value.aiExtractionRunId));

    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(callCount()).toBe(1); // still served from cache -- never re-invoked
    expect(await totalAiCostUnits(db)).toBe(3);
  });

  it('honors a caller-supplied cacheMaxAgeDays override', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-cache-custom-age@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      cacheMaxAgeDays: 1,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.aiExtractionRuns)
      .set({ createdAt: twoDaysAgo })
      .where(eq(schema.aiExtractionRuns.id, first.value.aiExtractionRunId));

    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      cacheMaxAgeDays: 1,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    // A 1-day override means a 2-day-old match is already stale.
    expect(callCount()).toBe(2);
  });

  it('does not serve from cache when the document text changes (different content hash)', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ai-cache-miss@example.com');
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ content A',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);
    expect(callCount()).toBe(1);

    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ content B — genuinely different',
      budgetLimitUnits: 1000,
    });
    expect(isOk(second)).toBe(true);
    // A different content hash produces a different cache key, so the adapter runs again.
    expect(callCount()).toBe(2);
    expect(await totalAiCostUnits(db)).toBe(6);

    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.servedFromCacheRunId === null)).toBe(true);
    expect(runs[0]?.cacheKey).not.toBe(runs[1]?.cacheKey);
  });

  it('persists the adapter-reported schema version on every successful (non-cached) run', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-schema-version@example.com',
    );
    await grantAiConsent(db, account.id);
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(run)).toBe(true);

    const rows = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schemaVersion).toBe('s1');
  });

  it('a cache hit still fails closed once the platform-wide budget is exhausted', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-cache-budget@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai } = countingStubAi();

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      // Exactly enough budget for one real (non-cached) run costing 3 units.
      budgetLimitUnits: 3,
    });
    expect(isOk(first)).toBe(true);

    // The budget is now exhausted — even though the second call would be a
    // cache hit (same document, same text), the budget check runs first and
    // still refuses it. A deliberate, conservative ordering (see the comment
    // at the cache-lookup call site in ai.ts).
    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 3,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });
});

describe('AI Gateway -- concurrency gate and budget-race safety (Part 8 §11)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  // NOTE: as with the advisory-lock tests above, a genuine Promise.all race
  // is not possible in this suite (PGlite fully serializes db.transaction()
  // calls), so every test below simulates "another call is genuinely
  // mid-flight" via insertInFlightRun's direct row insert instead.

  it('refuses to reserve a new call once the platform-wide concurrency cap is reached', async () => {
    const { versionId: otherVersionId, applicantId: otherApplicantId } = await seedVersion(
      db,
      'ai-concurrency-other@example.com',
    );
    await insertInFlightRun(db, otherVersionId, otherApplicantId);

    const { account, applicantId, versionId } = await seedVersion(db, 'ai-concurrency@example.com');
    await grantAiConsent(db, account.id);

    const result = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      maxConcurrentCalls: 1,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('rate_limited');
  });

  it('still allows a new call through when the platform-wide in-flight count is under the concurrency cap', async () => {
    const { versionId: otherVersionId, applicantId: otherApplicantId } = await seedVersion(
      db,
      'ai-concurrency-headroom-other@example.com',
    );
    await insertInFlightRun(db, otherVersionId, otherApplicantId);

    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-concurrency-headroom@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      maxConcurrentCalls: 2,
    });
    expect(isOk(result)).toBe(true);
  });

  it('self-heals a stale IN_FLIGHT reservation (an abandoned call, e.g. a crashed process) instead of leaving it stuck forever', async () => {
    const { versionId: staleVersionId, applicantId: staleApplicantId } = await seedVersion(
      db,
      'ai-stale-other@example.com',
    );
    const staleId = await insertInFlightRun(
      db,
      staleVersionId,
      staleApplicantId,
      new Date(Date.now() - 10 * 60 * 1000),
    );

    const { account, applicantId, versionId } = await seedVersion(db, 'ai-stale@example.com');
    await grantAiConsent(db, account.id);

    const result = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
      maxConcurrentCalls: 1,
    });
    // The stale reservation from 10 minutes ago no longer occupies the
    // single available slot -- it was released before the concurrency count
    // ran.
    expect(isOk(result)).toBe(true);

    const [stale] = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.id, staleId));
    expect(stale?.status).toBe('FAILED');
    expect(stale?.errorCode).toBe('in_flight_expired');
  });

  it('reserves the worst historical cost for every in-flight call so concurrent calls cannot race the platform-wide budget', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-reserve-budget@example.com',
    );
    await grantAiConsent(db, account.id);

    // Establish real evidence of what a call can cost (maxObservedCostUnits
    // never invents a pricing estimate): one genuine paid run costing 3
    // units.
    const first = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);

    const { versionId: otherVersionId, applicantId: otherApplicantId } = await seedVersion(
      db,
      'ai-reserve-budget-other@example.com',
    );
    await insertInFlightRun(db, otherVersionId, otherApplicantId);

    // Committed spend so far is only 3 -- comfortably under this limit of 7
    // on its own. But one call is already reserved in flight, and this
    // third call would be a second: reserving the worst historical cost (3)
    // for each of the two pushes the projected total to 3 + 2*3 = 9, over
    // the limit, so this is refused before it ever reaches the adapter.
    const third = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'a third, different document entirely',
      budgetLimitUnits: 7,
    });
    expect(isErr(third)).toBe(true);
    if (isErr(third)) expect(third.error.code).toBe('invalid');
  });
});

describe('AI Gateway -- evidence grounding (Part 8 AI-04)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const MRZ_SNIPPET = 'L898902C36UTO7408122F1204159ZE184226B';

  it('confirms and records the exact position of a genuinely verbatim evidence snippet', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-evidence-verified@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const sourceText = `Passport MRZ: ${MRZ_SNIPPET} end of document`;

    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: sourceText,
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const proposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;

    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(eq(schema.evidenceLocations.fieldProposalId, proposalId));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.verified).toBe(true);
    const expectedStart = sourceText.indexOf(MRZ_SNIPPET);
    expect(evidence[0]?.charStart).toBe(expectedStart);
    expect(evidence[0]?.charEnd).toBe(expectedStart + MRZ_SNIPPET.length);
  });

  it('flags a fabricated evidence snippet as unverified, without dropping the proposal', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-evidence-unverified@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fabricated: FieldProposal[] = [
      {
        type: 'NEW',
        fieldKey: 'passport.number',
        value: 'L898902C3',
        confidence: 0.9,
        evidenceSnippet: 'this exact phrase never appears anywhere in the source document',
      },
    ];

    const run = await runExtraction(
      db,
      stubAi({ ok: true, result: { proposals: fabricated, usage } }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: `Passport MRZ: ${MRZ_SNIPPET}`,
        budgetLimitUnits: 10,
      },
    );
    if (!isOk(run)) throw new Error('run failed');
    // Unverified evidence is a signal for the human reviewer, never a reason
    // to silently drop an otherwise-structurally-valid proposal.
    expect(run.value.proposals).toHaveLength(1);

    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(eq(schema.evidenceLocations.fieldProposalId, run.value.proposals[0]?.id ?? ''));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.verified).toBe(false);
    expect(evidence[0]?.charStart).toBeNull();
    expect(evidence[0]?.charEnd).toBeNull();
  });

  it('carries a verified evidence flag through a cache hit unchanged', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-evidence-cache@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const { ai } = countingStubAi();
    const sourceText = `Passport MRZ: ${MRZ_SNIPPET}`;

    const first = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: sourceText,
      budgetLimitUnits: 1000,
    });
    if (!isOk(first)) throw new Error('first run failed');

    const second = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: sourceText,
      budgetLimitUnits: 1000,
    });
    if (!isOk(second)) throw new Error('second run failed');

    const cachedProposalId = second.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;
    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(eq(schema.evidenceLocations.fieldProposalId, cachedProposalId));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.verified).toBe(true);
  });
});

describe('AI Gateway -- kill switch (Part 8 §5: "rechecked immediately before outbound call")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('proceeds normally when killSwitchCheck resolves true', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-killswitch-on@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const result = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
      killSwitchCheck: async () => true,
    });
    expect(isOk(result)).toBe(true);
    expect(callCount()).toBe(1);
  });

  it('refuses without ever invoking the adapter when killSwitchCheck resolves false, recording a FAILED run with errorCode "disabled"', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-killswitch-off@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubAi();

    const result = await runExtraction(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
      killSwitchCheck: async () => false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
    // The whole point of rechecking before dispatch: the adapter itself is
    // never reached once the switch says no.
    expect(callCount()).toBe(0);

    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('FAILED');
    expect(runs[0]?.errorCode).toBe('disabled');
  });

  it('defaults to allowing dispatch when no killSwitchCheck is provided at all', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ai-killswitch-unset@example.com',
    );
    await grantAiConsent(db, account.id);
    const result = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    expect(isOk(result)).toBe(true);
  });
});

describe('AI Gateway -- shared platform-wide budget with OCR (Part 8 Chunk 18/19)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function seedOcrRun(
    documentVersionId: string,
    applicantId: string,
    costUnits: number,
    status: 'SUCCEEDED' | 'IN_FLIGHT' | 'FAILED' = 'SUCCEEDED',
  ) {
    await db.insert(schema.ocrRuns).values({
      documentVersionId,
      applicantId,
      status,
      provider: 'openai',
      modelVersion: 'test-model',
      promptVersion: 'test-v1',
      costUnits,
    });
  }

  it("totalAiCostUnits sums ai_extraction_runs AND ocr_runs together -- OCR spend counts against the same platform-wide cap text extraction does (the user's own shared-cap decision)", async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'shared-budget-total@example.com',
    );
    await grantAiConsent(db, account.id);
    await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ text one',
      budgetLimitUnits: 100,
    });
    expect(await totalAiCostUnits(db)).toBe(3); // stubAi's own fixed per-call cost

    await seedOcrRun(versionId, applicantId, 7);

    expect(await totalAiCostUnits(db)).toBe(10); // 3 (text extraction) + 7 (OCR), combined
  });

  it('documentAiCostUnits sums both tables scoped to one document, for the identical shared-cap reason', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'shared-budget-document@example.com',
    );
    const other = await seedVersion(db, 'shared-budget-other-doc@example.com');
    await grantAiConsent(db, account.id);
    await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ text two',
      budgetLimitUnits: 100,
    });
    await seedOcrRun(versionId, applicantId, 5);
    // A different document's own OCR spend must never leak into this document's total.
    await seedOcrRun(other.versionId, other.applicantId, 999);

    expect(await documentAiCostUnits(db, versionId)).toBe(8); // 3 (text extraction) + 5 (OCR)
  });

  it('a SUCCEEDED text-extraction call still runs even once ocr_runs alone holds real spend -- proves the union query genuinely reads ocr_runs, not just an empty table by construction', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'shared-budget-ocr-only@example.com',
    );
    await seedOcrRun(versionId, applicantId, 50);
    expect(await totalAiCostUnits(db)).toBe(50);
    expect(await documentAiCostUnits(db, versionId)).toBe(50);

    await grantAiConsent(db, account.id);
    // Budget headroom set comfortably above 100, not 100 itself: phase 1's
    // own worst-case reservation (maxObservedCostUnits) now also reads
    // ocr_runs, so it reserves 50 (this seeded OCR row's own cost) for this
    // call even though it will actually only end up costing 3 -- proof the
    // union genuinely feeds the reservation math too, not just the display
    // sum. totalAiCostUnits(50) + (0 in-flight + 1) * worstCase(50) = 100
    // would exhaust an exact 100-unit budget before ever reaching the
    // adapter.
    const result = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ text three',
      budgetLimitUnits: 200,
    });
    expect(isOk(result)).toBe(true);
    expect(await totalAiCostUnits(db)).toBe(53); // 50 (OCR) + 3 (this text-extraction call's real cost)
  });
});

const ocrUsage: AiOcrUsage = {
  costUnits: 4,
  inputUnits: 3,
  outputUnits: 1,
  modelVersion: 'gpt-5.6-terra',
  promptVersion: 'ocr-p1',
  provider: 'openai',
  latencyMs: 55,
};

function stubOcrAi(
  result: AiOcrOutcome = {
    ok: true,
    result: { text: 'MRZ text here', reviewIssues: [], usage: ocrUsage },
  },
): AiOcrPort {
  return {
    async performOcr() {
      return result;
    },
    cacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'ocr-p1' };
    },
  };
}

/** Same shape as stubOcrAi, but counts real adapter invocations - for asserting a cache hit (or a kill-switch refusal) never calls it. */
function countingStubOcrAi(
  result: AiOcrOutcome = {
    ok: true,
    result: { text: 'MRZ text here', reviewIssues: [], usage: ocrUsage },
  },
): { ai: AiOcrPort; callCount: () => number } {
  let calls = 0;
  const ai: AiOcrPort = {
    async performOcr() {
      calls += 1;
      return result;
    },
    cacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'ocr-p1' };
    },
  };
  return { ai, callCount: () => calls };
}

async function grantOcrConsent(db: Db, accountId: string) {
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'AI_OCR',
    granted: true,
  });
}

describe('AI Gateway -- runOcr (Part 8 Chunk 20)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const imageBytes = new TextEncoder().encode('fake-scanned-passport-page-1');

  it('requires AI_OCR consent to run -- AI_EXTRACTION consent alone is not enough, since the two are genuinely distinct disclosures', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-consent@example.com');
    await grantAiConsent(db, account.id); // AI_EXTRACTION only, deliberately not AI_OCR
    const denied = await runOcr(db, stubOcrAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('consent_required');
  });

  it('runs, persists extracted text and review issues directly on the run row, audits, and records a product event', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-run@example.com');
    await grantOcrConsent(db, account.id);

    const result = await runOcr(db, stubOcrAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ocrRun.status).toBe('SUCCEEDED');
    expect(result.value.ocrRun.extractedText).toBe('MRZ text here');
    expect(result.value.ocrRun.reviewIssues).toEqual([]);
    expect(result.value.ocrRun.costUnits).toBe(4);
    expect(result.value.ocrRun.servedFromCacheRunId).toBeNull();

    const productEvents = await db.select().from(schema.productEvents);
    expect(productEvents.some((e) => e.eventType === 'AI_OCR_RUN')).toBe(true);
  });

  it('persists named review issues (directive §9: low_quality/ambiguous_date/unsupported_script/missing_text) exactly as the adapter reports them', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'ocr-review-issues@example.com',
    );
    await grantOcrConsent(db, account.id);

    const result = await runOcr(
      db,
      stubOcrAi({
        ok: true,
        result: { text: '', reviewIssues: ['low_quality', 'missing_text'], usage: ocrUsage },
      }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        imageBytes,
        contentType: 'image/png',
        budgetLimitUnits: 100,
      },
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ocrRun.reviewIssues).toEqual(['low_quality', 'missing_text']);
  });

  it('a failed adapter call is recorded FAILED with the real error code, never silently dropped', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-failed@example.com');
    await grantOcrConsent(db, account.id);

    const result = await runOcr(
      db,
      stubOcrAi({
        ok: false,
        code: 'rate_limited',
        message: 'too many requests',
        provider: 'openai',
        latencyMs: 12,
      }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        imageBytes,
        contentType: 'image/png',
        budgetLimitUnits: 100,
      },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('upstream_error');

    const rows = await db
      .select()
      .from(schema.ocrRuns)
      .where(eq(schema.ocrRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.errorCode).toBe('rate_limited');
    expect(rows[0]?.provider).toBe('openai'); // never null -- ocr_runs.provider is NOT NULL
  });

  it('a second identical call is served from cache -- same cache key, adapter never invoked again, cost is zero', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-cache-hit@example.com');
    await grantOcrConsent(db, account.id);
    const { ai, callCount } = countingStubOcrAi();

    const first = await runOcr(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isOk(first)).toBe(true);
    expect(callCount()).toBe(1);

    const second = await runOcr(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(callCount()).toBe(1); // still 1 -- the adapter was never invoked a second time
    expect(second.value.ocrRun.costUnits).toBe(0);
    expect(second.value.ocrRun.servedFromCacheRunId).not.toBeNull();
    expect(second.value.ocrRun.extractedText).toBe('MRZ text here');
  });

  it('different image bytes never collide in the cache -- a second, genuinely different scan is billed again', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-cache-miss@example.com');
    await grantOcrConsent(db, account.id);
    const { ai, callCount } = countingStubOcrAi();

    await runOcr(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    const second = await runOcr(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes: new TextEncoder().encode('a-genuinely-different-scanned-page'),
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(callCount()).toBe(2);
    expect(second.value.ocrRun.servedFromCacheRunId).toBeNull();
  });

  it('OCR has its own attempt counter, separate from countAiExtractionAttempts -- exhausting it refuses further genuine OCR calls on the same document', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-attempts@example.com');
    await grantOcrConsent(db, account.id);

    // Two genuinely different (never-cached) calls exhaust a limit of 2.
    await runOcr(db, stubOcrAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes: new TextEncoder().encode('scan-a'),
      contentType: 'image/png',
      budgetLimitUnits: 100,
      maxAttemptsPerDocument: 2,
    });
    await runOcr(db, stubOcrAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes: new TextEncoder().encode('scan-b'),
      contentType: 'image/png',
      budgetLimitUnits: 100,
      maxAttemptsPerDocument: 2,
    });
    const third = await runOcr(db, stubOcrAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes: new TextEncoder().encode('scan-c'),
      contentType: 'image/png',
      budgetLimitUnits: 100,
      maxAttemptsPerDocument: 2,
    });
    expect(isErr(third)).toBe(true);
    if (isErr(third)) expect(third.error.code).toBe('invalid');
  });

  it('the kill switch, rechecked immediately before dispatch, refuses the call without ever invoking the adapter', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-killswitch@example.com');
    await grantOcrConsent(db, account.id);
    const { ai, callCount } = countingStubOcrAi();

    const result = await runOcr(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
      killSwitchCheck: async () => false,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
    expect(callCount()).toBe(0);

    const rows = await db
      .select()
      .from(schema.ocrRuns)
      .where(eq(schema.ocrRuns.documentVersionId, versionId));
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.errorCode).toBe('disabled');
    expect(rows[0]?.provider).toBe('unknown'); // no provider on a synthesized disabled outcome -- never null
  });

  it('refuses once the shared platform-wide budget is exhausted -- the same ledger runExtraction reads', async () => {
    const seeded = await seedVersion(db, 'ocr-budget-seed@example.com');
    await grantOcrConsent(db, seeded.account.id);
    const seedCall = await runOcr(db, stubOcrAi(), {
      actorAccountId: seeded.account.id,
      applicantId: seeded.applicantId,
      documentVersionId: seeded.versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isOk(seedCall)).toBe(true); // real cost 4; totalAiCostUnits and worstCase are now both 4

    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-budget@example.com');
    await grantOcrConsent(db, account.id);
    const result = await runOcr(db, stubOcrAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      imageBytes: new TextEncoder().encode('a-different-document-scan'),
      contentType: 'image/png',
      // totalAiCostUnits(4) + (0 in-flight + 1) * worstCase(4) = 8 >= 4.
      budgetLimitUnits: 4,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('is not authorized for an applicant the actor does not own', async () => {
    const owner = await seedVersion(db, 'ocr-owner@example.com');
    const stranger = await provisionAccount(db, { email: 'ocr-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    await grantOcrConsent(db, owner.account.id);

    const result = await runOcr(db, stubOcrAi(), {
      actorAccountId: stranger.value.id,
      applicantId: owner.applicantId,
      documentVersionId: owner.versionId,
      imageBytes,
      contentType: 'image/png',
      budgetLimitUnits: 100,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('getLatestOcrRun returns the full row (text and review issues), not just text -- for display', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'ocr-latest-run@example.com');
    await grantOcrConsent(db, account.id);
    await runOcr(
      db,
      stubOcrAi({
        ok: true,
        result: { text: 'passport MRZ line', reviewIssues: ['ambiguous_date'], usage: ocrUsage },
      }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        imageBytes,
        contentType: 'image/png',
        budgetLimitUnits: 100,
      },
    );

    const latest = await getLatestOcrRun(db, versionId);
    expect(latest?.extractedText).toBe('passport MRZ line');
    expect(latest?.reviewIssues).toEqual(['ambiguous_date']);
    expect(latest?.status).toBe('SUCCEEDED');
  });

  it('getLatestOcrRun returns undefined when no OCR run has ever succeeded for this document', async () => {
    const { versionId } = await seedVersion(db, 'ocr-latest-run-none@example.com');
    expect(await getLatestOcrRun(db, versionId)).toBeUndefined();
  });
});

/** A second stub adapter with a genuinely different cache-key model, standing in for a designated fallback provider. */
function fallbackStubAi(
  result: AiExtractionOutcome = {
    ok: true,
    result: {
      proposals,
      usage: { ...usage, provider: 'anthropic', modelVersion: 'claude-sonnet-5' },
    },
  },
): AiExtractionPort {
  return {
    async extract() {
      return result;
    },
    cacheKeyComponents() {
      return { model: 'claude-sonnet-5', promptVersion: 'p1', schemaVersion: 's1' };
    },
  };
}

function fallbackStubOcrAi(
  result: AiOcrOutcome = {
    ok: true,
    result: {
      text: 'MRZ text from fallback',
      reviewIssues: [],
      usage: { ...ocrUsage, provider: 'anthropic', modelVersion: 'claude-sonnet-5' },
    },
  },
): AiOcrPort {
  return {
    async performOcr() {
      return result;
    },
    cacheKeyComponents() {
      return { model: 'claude-sonnet-5', promptVersion: 'ocr-p1' };
    },
  };
}

describe('AI Gateway -- cross-provider fallback (Part 8 §13, Chunk 25)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("triggers the fallback adapter on a timeout, writing a second row linked via triggeredByRunId, and returns the fallback adapter's own outcome", async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-timeout@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'timeout', message: 'timed out' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
        fallback: { ai: fallbackStubAi() },
      },
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const rows = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(2);
    const primaryRow = rows.find((r) => r.status === 'FAILED');
    const fallbackRow = rows.find((r) => r.status === 'SUCCEEDED');
    expect(primaryRow?.errorCode).toBe('timeout');
    expect(fallbackRow?.triggeredByRunId).toBe(primaryRow?.id);
    expect(fallbackRow?.provider).toBe('anthropic');
    expect(result.value.aiExtractionRunId).toBe(fallbackRow?.id);
  });

  it('triggers the fallback adapter on rate_limited, the other directive-named recoverable code', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-rate-limited@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'rate_limited', message: 'too many requests' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
        fallback: { ai: fallbackStubAi() },
      },
    );
    expect(isOk(result)).toBe(true);

    const rows = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(2);
  });

  it('never triggers the fallback on a refused outcome -- Part 8 §13: never "shop for a desired answer" after a refusal', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-refused@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai: fallback, callCount } = countingStubAi();

    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'refused', message: 'the model declined' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
        fallback: { ai: fallback },
      },
    );
    expect(isErr(result)).toBe(true);
    expect(callCount()).toBe(0);

    const rows = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['auth_failed', 'the key is bad'],
    ['invalid_response', 'unparseable'],
    ['truncated', 'ran out of budget'],
    ['disabled', 'AI extraction is currently disabled'],
  ] as const)(
    'never triggers the fallback on a non-recoverable %s outcome',
    async (code, message) => {
      const { account, applicantId, versionId } = await seedVersion(
        db,
        `fallback-non-recoverable-${code}@example.com`,
      );
      await grantAiConsent(db, account.id);
      const { ai: fallback, callCount } = countingStubAi();

      await runExtraction(db, stubAi({ ok: false, code, message }), {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
        fallback: { ai: fallback },
      });
      expect(callCount()).toBe(0);
    },
  );

  it('never attempts a fallback when none was given, even on an otherwise-recoverable timeout -- unchanged default behavior', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-not-given@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'timeout', message: 'timed out' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
      },
    );
    expect(isErr(result)).toBe(true);

    const rows = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(1);
  });

  it("returns the fallback's own FAILED result, with no third attempt, when the fallback also fails", async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-also-fails@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'timeout', message: 'timed out' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
        fallback: {
          ai: fallbackStubAi({ ok: false, code: 'timeout', message: 'fallback also timed out' }),
        },
      },
    );
    expect(isErr(result)).toBe(true);

    const rows = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'FAILED')).toBe(true);
  });

  it('the fallback attempt is refused once the SAME attempt limit is already reached -- it composes with existing caps, not a separate budget', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-attempt-cap@example.com',
    );
    await grantAiConsent(db, account.id);
    // Exhaust the (shared) attempt cap of 1 with a prior FAILED run first.
    await runExtraction(db, stubAi({ ok: false, code: 'auth_failed', message: 'bad key' }), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ text',
      budgetLimitUnits: 100,
      maxAttemptsPerDocument: 1,
    });

    const { ai: fallback, callCount } = countingStubAi();
    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'timeout', message: 'timed out' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 100,
        maxAttemptsPerDocument: 1,
        fallback: { ai: fallback },
      },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('attempt limit');
    expect(callCount()).toBe(0);
  });

  it('OCR: triggers the fallback adapter on a timeout, writing a second ocr_runs row linked via triggeredByRunId', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-ocr-timeout@example.com',
    );
    await grantOcrConsent(db, account.id);
    const imageBytes = new TextEncoder().encode('fake-scanned-passport-page-1');

    const result = await runOcr(
      db,
      stubOcrAi({ ok: false, code: 'timeout', message: 'timed out' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        imageBytes,
        contentType: 'image/png',
        budgetLimitUnits: 100,
        fallback: { ai: fallbackStubOcrAi() },
      },
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.ocrRun.provider).toBe('anthropic');
    expect(result.value.ocrRun.extractedText).toBe('MRZ text from fallback');

    const rows = await db
      .select()
      .from(schema.ocrRuns)
      .where(eq(schema.ocrRuns.documentVersionId, versionId));
    expect(rows).toHaveLength(2);
    const primaryRow = rows.find((r) => r.status === 'FAILED');
    expect(rows.find((r) => r.status === 'SUCCEEDED')?.triggeredByRunId).toBe(primaryRow?.id);
  });

  it('OCR: never triggers the fallback on a refused outcome', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'fallback-ocr-refused@example.com',
    );
    await grantOcrConsent(db, account.id);
    const imageBytes = new TextEncoder().encode('fake-scanned-passport-page-1');
    const { ai: fallback, callCount } = countingStubOcrAi();

    const result = await runOcr(
      db,
      stubOcrAi({ ok: false, code: 'refused', message: 'the model declined' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        imageBytes,
        contentType: 'image/png',
        budgetLimitUnits: 100,
        fallback: { ai: fallback },
      },
    );
    expect(isErr(result)).toBe(true);
    expect(callCount()).toBe(0);
  });
});

const classifyUsage = {
  costUnits: 2,
  inputUnits: 1,
  outputUnits: 1,
  cachedUnits: 0,
  modelVersion: 'gpt-5.6-terra',
  promptVersion: 'classify-p1',
  schemaVersion: 'classify-s1',
  provider: 'openai',
  latencyMs: 20,
};

function stubClassifyAi(
  result: AiClassifyOutcome = {
    ok: true,
    result: {
      suggestedType: 'BANK_STATEMENT',
      confidence: 0.9,
      rationale: 'looks like one',
      usage: classifyUsage,
    },
  },
): AiClassifyPort {
  return {
    async classify() {
      return result;
    },
    classifyCacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'classify-p1', schemaVersion: 'classify-s1' };
    },
  };
}

function countingStubClassifyAi(
  result: AiClassifyOutcome = {
    ok: true,
    result: {
      suggestedType: 'BANK_STATEMENT',
      confidence: 0.9,
      rationale: 'looks like one',
      usage: classifyUsage,
    },
  },
): { ai: AiClassifyPort; callCount: () => number } {
  let calls = 0;
  const ai: AiClassifyPort = {
    async classify() {
      calls += 1;
      return result;
    },
    classifyCacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'classify-p1', schemaVersion: 'classify-s1' };
    },
  };
  return { ai, callCount: () => calls };
}

/** Inserts a COMPLETED processingRuns row plus a SUCCEEDED extractionRuns row for it -- the deterministic prerequisite `approveDocumentTypeProposal` looks up to satisfy `document_classifications.extraction_run_id`'s FK. */
async function seedExtractionRun(db: Db, versionId: string): Promise<void> {
  const [run] = await db
    .insert(schema.processingRuns)
    .values({ documentVersionId: versionId, pipelineVersion: '1.0.0', status: 'COMPLETED' })
    .returning();
  await db.insert(schema.extractionRuns).values({
    processingRunId: (run as { id: string }).id,
    documentVersionId: versionId,
    parserName: 'test',
    parserVersion: '1.0.0',
    status: 'SUCCEEDED',
    extractedText: 'some deterministically-extracted text',
  });
}

describe('AI Gateway -- document type classification (Part 8 AI-01 item 2)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('produces a PENDING document-type proposal on a genuine gap', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'classify-basic@example.com');
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const result = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.proposal?.suggestedType).toBe('BANK_STATEMENT');
    expect(result.value.proposal?.status).toBe('PENDING');

    const pending = await listPendingDocumentTypeProposals(db, applicantId);
    expect(pending).toHaveLength(1);
  });

  it('refuses to run when the deterministic classifier already reached a confident result', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-already-confident@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);
    const [existingRun] = await db
      .select()
      .from(schema.extractionRuns)
      .where(eq(schema.extractionRuns.documentVersionId, versionId));
    await db.insert(schema.documentClassifications).values({
      extractionRunId: (existingRun as { id: string }).id,
      documentVersionId: versionId,
      classifiedType: 'PASSPORT',
      confidence: 100,
      reviewRequired: false,
      rationale: 'valid TD3 MRZ',
    });

    const result = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
    });
    expect(isErr(result)).toBe(true);
  });

  it('runs when the deterministic classifier left reviewRequired true, even with a non-null type', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-review-required@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);
    const [existingRun] = await db
      .select()
      .from(schema.extractionRuns)
      .where(eq(schema.extractionRuns.documentVersionId, versionId));
    await db.insert(schema.documentClassifications).values({
      extractionRunId: (existingRun as { id: string }).id,
      documentVersionId: versionId,
      classifiedType: null,
      confidence: 40,
      reviewRequired: true,
      rationale: 'below threshold',
    });

    const result = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isOk(result)).toBe(true);
  });

  it('refuses to run a second time while a suggestion is already pending', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-already-pending@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const first = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);

    const second = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isErr(second)).toBe(true);
  });

  it('requires AI_EXTRACTION consent', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-consent@example.com',
    );
    await seedExtractionRun(db, versionId);

    const result = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('consent_required');
  });

  it('fails closed once the platform-wide budget is exhausted', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-budget@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const result = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 0,
    });
    expect(isErr(result)).toBe(true);
  });

  it('never writes a proposal when the model itself could not confidently classify', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'classify-null@example.com');
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const result = await runClassification(
      db,
      stubClassifyAi({
        ok: true,
        result: { suggestedType: null, confidence: 0.2, usage: classifyUsage },
      }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'ambiguous text',
        budgetLimitUnits: 1000,
      },
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.proposal).toBeNull();
  });

  it('never writes a proposal for a type outside the allowed vocabulary', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-outofvocab@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const result = await runClassification(
      db,
      stubClassifyAi({
        ok: true,
        result: { suggestedType: 'DRIVERS_LICENSE', confidence: 0.9, usage: classifyUsage },
      }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'some text',
        budgetLimitUnits: 1000,
      },
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.proposal).toBeNull();
  });

  it('a cache hit never calls the adapter again and still produces a proposal', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-cache-a@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);
    const { ai, callCount } = countingStubClassifyAi();

    const first = await runClassification(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);
    if (isOk(first) && first.value.proposal) {
      await rejectDocumentTypeProposal(db, {
        actorAccountId: account.id,
        proposalId: first.value.proposal.id,
      });
    }

    const {
      account: account2,
      applicantId: applicantId2,
      versionId: versionId2,
    } = await seedVersion(db, 'classify-cache-b@example.com');
    await grantAiConsent(db, account2.id);
    await seedExtractionRun(db, versionId2);

    const second = await runClassification(db, ai, {
      actorAccountId: account2.id,
      applicantId: applicantId2,
      documentVersionId: versionId2,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.proposal?.suggestedType).toBe('BANK_STATEMENT');
    expect(callCount()).toBe(1);
  });

  it('approving a proposal writes an AI_APPROVED classification, fills docType, and proposes a name', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-approve@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const run = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    expect(isOk(run)).toBe(true);
    if (!isOk(run) || !run.value.proposal) throw new Error('expected a proposal');

    const approved = await approveDocumentTypeProposal(db, {
      actorAccountId: account.id,
      proposalId: run.value.proposal.id,
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.status).toBe('APPROVED');
    expect(approved.value.classificationId).not.toBeNull();

    const [classification] = await db
      .select()
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, versionId));
    expect((classification as { source: string }).source).toBe('AI_APPROVED');
    expect((classification as { classifiedType: string }).classifiedType).toBe('BANK_STATEMENT');

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, applicantId));
    expect((doc as { docType: string | null }).docType).toBe('BANK_STATEMENT');

    const [nameVersion] = await db
      .select()
      .from(schema.documentNameVersions)
      .where(eq(schema.documentNameVersions.documentId, (doc as { id: string }).id));
    expect(nameVersion).toBeDefined();
  });

  it('approving never overwrites an already-set docType', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-approve-preserve@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);
    await db
      .update(schema.documents)
      .set({ docType: 'SOMETHING_ELSE' })
      .where(eq(schema.documents.applicantId, applicantId));

    const run = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    if (!isOk(run) || !run.value.proposal) throw new Error('expected a proposal');

    await approveDocumentTypeProposal(db, {
      actorAccountId: account.id,
      proposalId: run.value.proposal.id,
    });

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, applicantId));
    expect((doc as { docType: string | null }).docType).toBe('SOMETHING_ELSE');
  });

  it('rejecting a proposal marks it REJECTED and writes no classification row', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-reject@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const run = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
    });
    if (!isOk(run) || !run.value.proposal) throw new Error('expected a proposal');

    const rejected = await rejectDocumentTypeProposal(db, {
      actorAccountId: account.id,
      proposalId: run.value.proposal.id,
      reason: 'looks wrong',
    });
    expect(isOk(rejected)).toBe(true);
    if (isOk(rejected)) expect(rejected.value.status).toBe('REJECTED');

    const classifications = await db
      .select()
      .from(schema.documentClassifications)
      .where(eq(schema.documentClassifications.documentVersionId, versionId));
    expect(classifications).toHaveLength(0);
  });

  it('enforces its own attempt limit independently of the extraction attempt counter', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'classify-attempts@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);

    const failing = stubClassifyAi({ ok: false, code: 'upstream_error', message: 'boom' });
    const first = await runClassification(db, failing, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isErr(first)).toBe(true);

    const second = await runClassification(db, failing, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'statement of account, opening balance, closing balance',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('attempt limit');
  });
});

/** Explanation is not applicant-scoped, so there is no real account behind it; any stable string works as the rate-limit subject. */
const EXPLAIN_ACTOR = 'explain-test-actor';

const explainUsage = {
  costUnits: 1,
  inputUnits: 1,
  outputUnits: 1,
  cachedUnits: 0,
  modelVersion: 'gpt-5.6-terra',
  promptVersion: 'explain-p1',
  schemaVersion: 'explain-s1',
  provider: 'openai',
  latencyMs: 10,
};

function stubExplainAi(
  result: AiExplainOutcome = {
    ok: true,
    result: { explanation: 'A bank statement proves ongoing funds.', usage: explainUsage },
  },
): AiExplainPort {
  return {
    async explain() {
      return result;
    },
    explainCacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'explain-p1', schemaVersion: 'explain-s1' };
    },
  };
}

function countingStubExplainAi(
  result: AiExplainOutcome = {
    ok: true,
    result: { explanation: 'A bank statement proves ongoing funds.', usage: explainUsage },
  },
): { ai: AiExplainPort; callCount: () => number } {
  let calls = 0;
  const ai: AiExplainPort = {
    async explain() {
      calls += 1;
      return result;
    },
    explainCacheKeyComponents() {
      return { model: 'gpt-5.6-terra', promptVersion: 'explain-p1', schemaVersion: 'explain-s1' };
    },
  };
  return { ai, callCount: () => calls };
}

/** Seeds a minimal packs -> packVersions -> packRequirements chain, bypassing the full pack-authoring service layer (irrelevant to these tests) -- returns the requirement's id. */
async function seedPackRequirement(
  db: Db,
  overrides: { readonly citation?: string; readonly optional?: boolean } = {},
): Promise<string> {
  const [pack] = await db
    .insert(schema.packs)
    .values({ key: `test-pack-${randomBytes(8).toString('hex')}`, name: 'Test Pack' })
    .returning();
  const [version] = await db
    .insert(schema.packVersions)
    .values({ packId: (pack as { id: string }).id, version: 1 })
    .returning();
  const [requirement] = await db
    .insert(schema.packRequirements)
    .values({
      packVersionId: (version as { id: string }).id,
      kind: 'DOCUMENT',
      docType: 'BANK_STATEMENT',
      citation: overrides.citation ?? 'Route guide §4.2: proof of funds required.',
      optional: overrides.optional ?? false,
    })
    .returning();
  return (requirement as { id: string }).id;
}

describe('AI Gateway -- readiness-gap explanation (Part 8 AI-01 item 5)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('produces an explanation grounded in the requirement citation', async () => {
    const packRequirementId = await seedPackRequirement(db);
    const result = await explainReadinessGap(db, stubExplainAi(), {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId,
      requirementKind: 'DOCUMENT',
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP',
      citation: 'Route guide §4.2: proof of funds required.',
      optional: false,
      budgetLimitUnits: 1000,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.explanation).toContain('bank statement');
  });

  it('requires no consent -- no applicant-specific data is ever sent', async () => {
    const packRequirementId = await seedPackRequirement(db);
    // Deliberately no setConsent call anywhere in this test -- proves the
    // call succeeds without any consent grant existing at all.
    const result = await explainReadinessGap(db, stubExplainAi(), {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId,
      requirementKind: 'DOCUMENT',
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP',
      citation: 'Route guide §4.2: proof of funds required.',
      optional: false,
      budgetLimitUnits: 1000,
    });
    expect(isOk(result)).toBe(true);
  });

  it('fails closed once the platform-wide budget is exhausted', async () => {
    const packRequirementId = await seedPackRequirement(db);
    const result = await explainReadinessGap(db, stubExplainAi(), {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId,
      requirementKind: 'DOCUMENT',
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP',
      citation: 'Route guide §4.2: proof of funds required.',
      optional: false,
      budgetLimitUnits: 0,
    });
    expect(isErr(result)).toBe(true);
  });

  it('a second identical gap (same kind/key/state/citation) is served from cache, at zero cost, without invoking the adapter again', async () => {
    const requirementA = await seedPackRequirement(db);
    const requirementB = await seedPackRequirement(db); // a DIFFERENT requirement row, identical content
    const { ai, callCount } = countingStubExplainAi();
    const shared = {
      requirementKind: 'DOCUMENT' as const,
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP' as const,
      citation: 'Route guide §4.2: proof of funds required.',
      optional: false,
      budgetLimitUnits: 1000,
    };

    const first = await explainReadinessGap(db, ai, {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId: requirementA,
      ...shared,
    });
    expect(isOk(first)).toBe(true);

    const second = await explainReadinessGap(db, ai, {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId: requirementB,
      ...shared,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second))
      expect(second.value.explanation).toBe(first.ok ? first.value.explanation : '');
    expect(callCount()).toBe(1);
  });

  it('does not serve from cache when the citation text differs, even for the identical requirement key/state', async () => {
    const requirementA = await seedPackRequirement(db, { citation: 'Citation A' });
    const requirementB = await seedPackRequirement(db, { citation: 'Citation B' });
    const { ai, callCount } = countingStubExplainAi();
    const shared = {
      requirementKind: 'DOCUMENT' as const,
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP' as const,
      optional: false,
      budgetLimitUnits: 1000,
    };

    await explainReadinessGap(db, ai, {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId: requirementA,
      citation: 'Citation A',
      ...shared,
    });
    await explainReadinessGap(db, ai, {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId: requirementB,
      citation: 'Citation B',
      ...shared,
    });
    expect(callCount()).toBe(2);
  });

  it('a failed adapter call is recorded FAILED with the real error code, never silently dropped', async () => {
    const packRequirementId = await seedPackRequirement(db);
    const result = await explainReadinessGap(
      db,
      stubExplainAi({ ok: false, code: 'upstream_error', message: 'boom' }),
      {
        actorAccountId: EXPLAIN_ACTOR,
        packRequirementId,
        requirementKind: 'DOCUMENT',
        requirementKey: 'BANK_STATEMENT',
        state: 'CRITICAL_GAP',
        citation: 'Route guide §4.2: proof of funds required.',
        optional: false,
        budgetLimitUnits: 1000,
      },
    );
    expect(isErr(result)).toBe(true);
  });

  it('the kill switch, rechecked immediately before dispatch, refuses the call without ever invoking the adapter', async () => {
    const packRequirementId = await seedPackRequirement(db);
    const { ai, callCount } = countingStubExplainAi();
    const result = await explainReadinessGap(db, ai, {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId,
      requirementKind: 'DOCUMENT',
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP',
      citation: 'Route guide §4.2: proof of funds required.',
      optional: false,
      budgetLimitUnits: 1000,
      killSwitchCheck: async () => false,
    });
    expect(isErr(result)).toBe(true);
    expect(callCount()).toBe(0);
  });

  it('counts against the SAME shared platform-wide budget extraction/OCR/classification already share', async () => {
    const packRequirementId = await seedPackRequirement(db);
    await explainReadinessGap(db, stubExplainAi(), {
      actorAccountId: EXPLAIN_ACTOR,
      packRequirementId,
      requirementKind: 'DOCUMENT',
      requirementKey: 'BANK_STATEMENT',
      state: 'CRITICAL_GAP',
      citation: 'Route guide §4.2: proof of funds required.',
      optional: false,
      budgetLimitUnits: 1000,
    });
    expect(await totalAiCostUnits(db)).toBe(explainUsage.costUnits);
  });
});

const inconsistencyUsage = {
  costUnits: 4,
  inputUnits: 3,
  outputUnits: 1,
  cachedUnits: 0,
  modelVersion: 'gpt-5.6-terra',
  promptVersion: 'inconsistency-p1',
  schemaVersion: 'inconsistency-s1',
  provider: 'openai',
  latencyMs: 12,
};

const oneFlag = [
  {
    description: 'The document spells the given name "Mohammed" but the profile has "Mohammad".',
    confidence: 0.7,
    rationale: 'Name spelling differs between document and profile.',
  },
];

function stubInconsistencyAi(
  result: AiInconsistencyOutcome = {
    ok: true,
    result: { flags: oneFlag, usage: inconsistencyUsage },
  },
): AiInconsistencyPort {
  return {
    async checkConsistency() {
      return result;
    },
    inconsistencyCacheKeyComponents() {
      return {
        model: 'gpt-5.6-terra',
        promptVersion: 'inconsistency-p1',
        schemaVersion: 'inconsistency-s1',
      };
    },
  };
}

function countingStubInconsistencyAi(
  result: AiInconsistencyOutcome = {
    ok: true,
    result: { flags: oneFlag, usage: inconsistencyUsage },
  },
): { ai: AiInconsistencyPort; callCount: () => number } {
  let calls = 0;
  const ai: AiInconsistencyPort = {
    async checkConsistency() {
      calls += 1;
      return result;
    },
    inconsistencyCacheKeyComponents() {
      return {
        model: 'gpt-5.6-terra',
        promptVersion: 'inconsistency-p1',
        schemaVersion: 'inconsistency-s1',
      };
    },
  };
  return { ai, callCount: () => calls };
}

describe('AI Gateway -- possible inconsistency flag (Part 8 AI-01 item 4)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('produces a PENDING flag when the model finds a possible contradiction', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-basic@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runInconsistencyCheck(db, stubInconsistencyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.flags).toHaveLength(1);
    expect(result.value.flags[0]?.status).toBe('PENDING');

    const pending = await listPendingInconsistencyFlags(db, applicantId);
    expect(pending).toHaveLength(1);
  });

  it('sends the current TRUSTED profile facts alongside the document text', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-facts@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'applicant.givenName', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'applicant.givenName',
      value: 'Mohammad',
      status: 'APPLICANT_CONFIRMED',
    });
    expect(isOk(edited)).toBe(true);

    let receivedFacts: readonly { fieldKey: string; value: string }[] = [];
    const ai: AiInconsistencyPort = {
      async checkConsistency(input) {
        receivedFacts = input.profileFacts;
        return { ok: true, result: { flags: [], usage: inconsistencyUsage } };
      },
      inconsistencyCacheKeyComponents() {
        return {
          model: 'gpt-5.6-terra',
          promptVersion: 'inconsistency-p1',
          schemaVersion: 'inconsistency-s1',
        };
      },
    };

    await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    expect(receivedFacts).toEqual([{ fieldKey: 'applicant.givenName', value: 'Mohammad' }]);
  });

  it('never sends a SENSITIVE/RESTRICTED field value, even when one is set and TRUSTED', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-protected@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, {
      key: 'applicant.nationalId',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
    });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'applicant.nationalId',
      value: 'SECRET-ID-123',
      status: 'APPLICANT_CONFIRMED',
      encryption: fakeKeyManagementPort(),
    });
    expect(isOk(edited)).toBe(true);

    let receivedFacts: readonly { fieldKey: string; value: string }[] = [];
    const ai: AiInconsistencyPort = {
      async checkConsistency(input) {
        receivedFacts = input.profileFacts;
        return { ok: true, result: { flags: [], usage: inconsistencyUsage } };
      },
      inconsistencyCacheKeyComponents() {
        return {
          model: 'gpt-5.6-terra',
          promptVersion: 'inconsistency-p1',
          schemaVersion: 'inconsistency-s1',
        };
      },
    };

    await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
    });
    expect(receivedFacts.find((f) => f.fieldKey === 'applicant.nationalId')).toBeUndefined();
    expect(JSON.stringify(receivedFacts)).not.toContain('SECRET-ID-123');
  });

  it('requires AI_EXTRACTION consent', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-consent@example.com',
    );

    const result = await runInconsistencyCheck(db, stubInconsistencyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('consent_required');
  });

  it('fails closed once the platform-wide budget is exhausted', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-budget@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runInconsistencyCheck(db, stubInconsistencyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 0,
    });
    expect(isErr(result)).toBe(true);
  });

  it('produces zero flags -- and that is a genuine, valid, good outcome', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-clean@example.com',
    );
    await grantAiConsent(db, account.id);

    const result = await runInconsistencyCheck(
      db,
      stubInconsistencyAi({ ok: true, result: { flags: [], usage: inconsistencyUsage } }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'Name: Mohammad Rahman',
        budgetLimitUnits: 1000,
      },
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.flags).toHaveLength(0);
  });

  it('a second identical check (same text and same facts) is served from cache, at zero cost, without invoking the adapter again', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-cache@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubInconsistencyAi();

    const first = await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    expect(isOk(first)).toBe(true);

    const second = await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.flags).toHaveLength(1);
    expect(callCount()).toBe(1);
  });

  it('does NOT serve from cache once the profile facts have changed, even for the identical document text', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-cache-stale@example.com',
    );
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'applicant.givenName', dataType: 'string' });
    const { ai, callCount } = countingStubInconsistencyAi();

    await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    expect(callCount()).toBe(1);

    // The applicant corrects their profile between the two checks.
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'applicant.givenName',
      value: 'Mohammed',
      status: 'APPLICANT_CONFIRMED',
    });

    await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    expect(callCount()).toBe(2);
  });

  it('a failed adapter call is recorded FAILED with the real error code, never silently dropped', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'inconsist-fail@example.com');
    await grantAiConsent(db, account.id);

    const result = await runInconsistencyCheck(
      db,
      stubInconsistencyAi({ ok: false, code: 'upstream_error', message: 'boom' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'irrelevant',
        budgetLimitUnits: 1000,
      },
    );
    expect(isErr(result)).toBe(true);
  });

  it('the kill switch, rechecked immediately before dispatch, refuses the call without ever invoking the adapter', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-killswitch@example.com',
    );
    await grantAiConsent(db, account.id);
    const { ai, callCount } = countingStubInconsistencyAi();

    const result = await runInconsistencyCheck(db, ai, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
      killSwitchCheck: async () => false,
    });
    expect(isErr(result)).toBe(true);
    expect(callCount()).toBe(0);
  });

  it('enforces its own attempt limit independently of every other task', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-attempts@example.com',
    );
    await grantAiConsent(db, account.id);
    const failing = stubInconsistencyAi({ ok: false, code: 'upstream_error', message: 'boom' });

    const first = await runInconsistencyCheck(db, failing, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isErr(first)).toBe(true);

    const second = await runInconsistencyCheck(db, failing, {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'irrelevant',
      budgetLimitUnits: 1000,
      maxAttemptsPerDocument: 1,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('attempt limit');
  });

  it('acknowledging a flag marks it ACKNOWLEDGED and writes nothing else', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-acknowledge@example.com',
    );
    await grantAiConsent(db, account.id);

    const run = await runInconsistencyCheck(db, stubInconsistencyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    if (!isOk(run) || run.value.flags.length === 0) throw new Error('expected a flag');

    const acknowledged = await acknowledgeInconsistencyFlag(db, {
      actorAccountId: account.id,
      flagId: run.value.flags[0]?.id ?? '',
    });
    expect(isOk(acknowledged)).toBe(true);
    if (isOk(acknowledged)) expect(acknowledged.value.status).toBe('ACKNOWLEDGED');
    // Never touches the facts table -- purely advisory.
    expect(await db.select().from(schema.facts)).toHaveLength(0);
  });

  it('dismissing a flag marks it DISMISSED', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'inconsist-dismiss@example.com',
    );
    await grantAiConsent(db, account.id);

    const run = await runInconsistencyCheck(db, stubInconsistencyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'Name: Mohammed Rahman',
      budgetLimitUnits: 1000,
    });
    if (!isOk(run) || run.value.flags.length === 0) throw new Error('expected a flag');

    const dismissed = await dismissInconsistencyFlag(db, {
      actorAccountId: account.id,
      flagId: run.value.flags[0]?.id ?? '',
      reason: 'legitimate spelling variation',
    });
    expect(isOk(dismissed)).toBe(true);
    if (isOk(dismissed)) expect(dismissed.value.status).toBe('DISMISSED');

    const pending = await listPendingInconsistencyFlags(db, applicantId);
    expect(pending).toHaveLength(0);
  });
});

describe('AI Gateway -- one per-actor rate limit shared across all five tasks (Part 9 SEC-02)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function aiBucketCount(subjectId: string): Promise<number | undefined> {
    const [row] = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.subjectId, subjectId));
    return row?.count;
  }

  /** Each task's own run function, wired to a counting adapter so a refusal can prove no provider call happened. */
  const tasks = {
    extraction: async (
      db: Db,
      ctx: { accountId: string; applicantId: string; versionId: string },
    ) => {
      const { ai, callCount } = countingStubAi();
      await grantAiConsent(db, ctx.accountId);
      const result = await runExtraction(db, ai, {
        actorAccountId: ctx.accountId,
        applicantId: ctx.applicantId,
        documentVersionId: ctx.versionId,
        text: 'MRZ...',
        budgetLimitUnits: 1000,
      });
      return { result: result as Result<unknown, ServiceError>, callCount };
    },
    ocr: async (db: Db, ctx: { accountId: string; applicantId: string; versionId: string }) => {
      const { ai, callCount } = countingStubOcrAi();
      await grantOcrConsent(db, ctx.accountId);
      const result = await runOcr(db, ai, {
        actorAccountId: ctx.accountId,
        applicantId: ctx.applicantId,
        documentVersionId: ctx.versionId,
        imageBytes: new TextEncoder().encode('fake-scan'),
        contentType: 'image/png',
        budgetLimitUnits: 1000,
      });
      return { result: result as Result<unknown, ServiceError>, callCount };
    },
    classification: async (
      db: Db,
      ctx: { accountId: string; applicantId: string; versionId: string },
    ) => {
      const { ai, callCount } = countingStubClassifyAi();
      await grantAiConsent(db, ctx.accountId);
      const result = await runClassification(db, ai, {
        actorAccountId: ctx.accountId,
        applicantId: ctx.applicantId,
        documentVersionId: ctx.versionId,
        text: 'statement of account, opening balance, closing balance',
        budgetLimitUnits: 1000,
      });
      return { result: result as Result<unknown, ServiceError>, callCount };
    },
    explanation: async (db: Db, ctx: { accountId: string }) => {
      const { ai, callCount } = countingStubExplainAi();
      const packRequirementId = await seedPackRequirement(db);
      const result = await explainReadinessGap(db, ai, {
        actorAccountId: ctx.accountId,
        packRequirementId,
        requirementKind: 'DOCUMENT',
        requirementKey: 'BANK_STATEMENT',
        state: 'CRITICAL_GAP',
        citation: 'Route guide §4.2: proof of funds required.',
        optional: false,
        budgetLimitUnits: 1000,
      });
      return { result: result as Result<unknown, ServiceError>, callCount };
    },
    inconsistency: async (
      db: Db,
      ctx: { accountId: string; applicantId: string; versionId: string },
    ) => {
      const { ai, callCount } = countingStubInconsistencyAi();
      await grantAiConsent(db, ctx.accountId);
      const result = await runInconsistencyCheck(db, ai, {
        actorAccountId: ctx.accountId,
        applicantId: ctx.applicantId,
        documentVersionId: ctx.versionId,
        text: 'Name: Mohammed Rahman',
        budgetLimitUnits: 1000,
      });
      return { result: result as Result<unknown, ServiceError>, callCount };
    },
  } as const;

  for (const name of Object.keys(tasks) as (keyof typeof tasks)[]) {
    it(`${name}: refuses with rate_limited once the actor's shared AI bucket is full, never calling the provider or spending budget`, async () => {
      const { account, applicantId, versionId } = await seedVersion(db, `rl-${name}@example.com`);
      await exhaustRateLimit(db, account.id, 'ai.run', RATE_LIMITS.AI_RUN);

      const { result, callCount } = await tasks[name](db, {
        accountId: account.id,
        applicantId,
        versionId,
      });

      expect(isErr(result)).toBe(true);
      if (isOk(result)) return;
      expect(result.error.code).toBe('rate_limited');
      expect(result.error.message).toContain('AI');
      expect(result.error.message).not.toContain('ai.run');
      expect(callCount()).toBe(0);
      expect(await totalAiCostUnits(db)).toBe(0);
    });
  }

  it('is ONE bucket across tasks: an extraction and an OCR run by the same actor both count against the same counter', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'rl-shared@example.com');
    const ctx = { accountId: account.id, applicantId, versionId };

    expect(isOk((await tasks.extraction(db, ctx)).result)).toBe(true);
    expect(isOk((await tasks.ocr(db, ctx)).result)).toBe(true);

    expect(await aiBucketCount(account.id)).toBe(2);
  });

  it("another actor's AI runs are unaffected by this actor being limited", async () => {
    const limited = await seedVersion(db, 'rl-limited@example.com');
    const other = await seedVersion(db, 'rl-other@example.com');
    await exhaustRateLimit(db, limited.account.id, 'ai.run', RATE_LIMITS.AI_RUN);

    const refused = await tasks.extraction(db, {
      accountId: limited.account.id,
      applicantId: limited.applicantId,
      versionId: limited.versionId,
    });
    expect(isErr(refused.result) && refused.result.error.code).toBe('rate_limited');
    const allowed = await tasks.extraction(db, {
      accountId: other.account.id,
      applicantId: other.applicantId,
      versionId: other.versionId,
    });

    expect(isOk(allowed.result)).toBe(true);
  });

  it('consent is checked before the limit: no consent still gets consent_required, and spends nothing', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'rl-noconsent@example.com');
    await exhaustRateLimit(db, account.id, 'ai.run', RATE_LIMITS.AI_RUN);

    const denied = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 1000,
    });

    expect(isErr(denied) && denied.error.code).toBe('consent_required');
  });

  it('classification no-op refusals ("already confident") do not spend the allowance', async () => {
    const { account, applicantId, versionId } = await seedVersion(
      db,
      'rl-classify-noop@example.com',
    );
    await grantAiConsent(db, account.id);
    await seedExtractionRun(db, versionId);
    const [existingRun] = await db
      .select()
      .from(schema.extractionRuns)
      .where(eq(schema.extractionRuns.documentVersionId, versionId));
    await db.insert(schema.documentClassifications).values({
      extractionRunId: (existingRun as { id: string }).id,
      documentVersionId: versionId,
      classifiedType: 'PASSPORT',
      confidence: 100,
      reviewRequired: false,
      rationale: 'valid TD3 MRZ',
    });

    const result = await runClassification(db, stubClassifyAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'anything',
      budgetLimitUnits: 1000,
    });

    expect(isErr(result) && result.error.code).toBe('invalid');
    expect(await aiBucketCount(account.id)).toBeUndefined();
  });

  it('a cross-provider fallback inside one run is NOT counted a second time', async () => {
    const { account, applicantId, versionId } = await seedVersion(db, 'rl-fallback@example.com');
    await grantAiConsent(db, account.id);

    const result = await runExtraction(
      db,
      stubAi({ ok: false, code: 'timeout', message: 'timed out' }),
      {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'MRZ text',
        budgetLimitUnits: 1000,
        fallback: { ai: fallbackStubAi() },
      },
    );

    expect(isOk(result)).toBe(true);
    // Two real provider attempts (primary + fallback) happened, but one user action: one count.
    expect(await aiBucketCount(account.id)).toBe(1);
  });
});

describe('OPS-04 (Commercial V1 Part 9): AI decision analytics', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function decisions() {
    return (await db.select().from(schema.productEvents)).filter((e) =>
      ['AI_PROPOSAL_ACCEPTED', 'AI_PROPOSAL_CORRECTED', 'AI_PROPOSAL_REJECTED'].includes(
        e.eventType,
      ),
    );
  }

  /** The event types a single action added to the log. */
  async function eventsAddedBy(action: () => Promise<unknown>) {
    const before = new Set((await decisions()).map((e) => e.id));
    await action();
    return (await decisions()).filter((e) => !before.has(e.id)).map((e) => e.eventType);
  }

  /** An extraction run on a fresh document, with its passport-number proposal. */
  async function extractionProposal(email: string) {
    const { account, applicantId, versionId } = await seedVersion(db, email);
    await grantAiConsent(db, account.id);
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const run = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run failed');
    const proposalId = run.value.proposals.find((p) => p.fieldKey === 'passport.number')
      ?.id as string;
    return { account, proposalId };
  }

  it('records an extraction proposal taken as proposed as accepted, without the value', async () => {
    const { account, proposalId } = await extractionProposal('ops04-accept@example.com');
    expect(isOk(await approveProposal(db, { actorAccountId: account.id, proposalId }))).toBe(true);

    expect(await decisions()).toMatchObject([
      {
        eventType: 'AI_PROPOSAL_ACCEPTED',
        accountId: account.id,
        organizationId: null,
        dimension: 'EXTRACTION',
        metricValue: null,
      },
    ]);
    expect(JSON.stringify(await decisions())).not.toContain('L898902C3');
  });

  it('records a proposal the reviewer changed before approving as corrected, never either value', async () => {
    const { account, proposalId } = await extractionProposal('ops04-correct@example.com');
    const approved = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId,
      correctedValue: 'Z9999999-FIXED',
    });
    expect(isOk(approved)).toBe(true);

    expect(await decisions()).toMatchObject([
      { eventType: 'AI_PROPOSAL_CORRECTED', dimension: 'EXTRACTION' },
    ]);
    const stored = JSON.stringify(await decisions());
    expect(stored).not.toContain('L898902C3');
    expect(stored).not.toContain('Z9999999');
  });

  it('counts a "correction" that equals the proposal as accepted, not corrected', async () => {
    const { account, proposalId } = await extractionProposal('ops04-same@example.com');
    const approved = await approveProposal(db, {
      actorAccountId: account.id,
      proposalId,
      correctedValue: 'L898902C3',
    });
    expect(isOk(approved)).toBe(true);
    expect((await decisions()).map((e) => e.eventType)).toEqual(['AI_PROPOSAL_ACCEPTED']);
  });

  it('records a rejected extraction proposal without the reason given', async () => {
    const { account, proposalId } = await extractionProposal('ops04-reject@example.com');
    const rejected = await rejectProposal(db, {
      actorAccountId: account.id,
      proposalId,
      reason: 'the scan is of my brother Tariq, not me',
    });
    expect(isOk(rejected)).toBe(true);

    expect(await decisions()).toMatchObject([
      { eventType: 'AI_PROPOSAL_REJECTED', accountId: account.id, dimension: 'EXTRACTION' },
    ]);
    expect(JSON.stringify(await decisions())).not.toContain('Tariq');
  });

  it('records nothing for a decision that is refused, or repeated on a proposal already decided', async () => {
    const { account, proposalId } = await extractionProposal('ops04-refused@example.com');
    expect(isOk(await approveProposal(db, { actorAccountId: account.id, proposalId }))).toBe(true);
    const again = await approveProposal(db, { actorAccountId: account.id, proposalId });
    const rejectAfter = await rejectProposal(db, {
      actorAccountId: account.id,
      proposalId,
      reason: 'changed my mind',
    });
    expect([isErr(again), isErr(rejectAfter)]).toEqual([true, true]);
    expect(await decisions()).toHaveLength(1);
  });

  it('records a document-type proposal accepted or rejected, under the classification label', async () => {
    for (const verdict of ['accept', 'reject'] as const) {
      const { account, applicantId, versionId } = await seedVersion(
        db,
        `ops04-classify-${verdict}@example.com`,
      );
      await grantAiConsent(db, account.id);
      await seedExtractionRun(db, versionId);
      const run = await runClassification(db, stubClassifyAi(), {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'statement of account, opening balance, closing balance',
        budgetLimitUnits: 1000,
      });
      if (!isOk(run) || !run.value.proposal) throw new Error('expected a proposal');
      const proposalId = run.value.proposal.id;
      const added = await eventsAddedBy(async () => {
        const decided =
          verdict === 'accept'
            ? await approveDocumentTypeProposal(db, { actorAccountId: account.id, proposalId })
            : await rejectDocumentTypeProposal(db, {
                actorAccountId: account.id,
                proposalId,
                reason: 'not a bank statement',
              });
        expect(isOk(decided), verdict).toBe(true);
      });
      expect(added).toEqual([
        verdict === 'accept' ? 'AI_PROPOSAL_ACCEPTED' : 'AI_PROPOSAL_REJECTED',
      ]);
    }

    expect((await decisions()).map((e) => [e.eventType, e.dimension]).sort()).toEqual([
      ['AI_PROPOSAL_ACCEPTED', 'CLASSIFICATION'],
      ['AI_PROPOSAL_REJECTED', 'CLASSIFICATION'],
    ]);
  });

  it('records an acknowledged inconsistency flag as accepted and a dismissed one as rejected', async () => {
    for (const verdict of ['acknowledge', 'dismiss'] as const) {
      const { account, applicantId, versionId } = await seedVersion(
        db,
        `ops04-flag-${verdict}@example.com`,
      );
      await grantAiConsent(db, account.id);
      const run = await runInconsistencyCheck(db, stubInconsistencyAi(), {
        actorAccountId: account.id,
        applicantId,
        documentVersionId: versionId,
        text: 'Name: Mohammed Rahman',
        budgetLimitUnits: 1000,
      });
      if (!isOk(run) || run.value.flags.length === 0) throw new Error('expected a flag');
      const flagId = run.value.flags[0]?.id ?? '';
      const added = await eventsAddedBy(async () => {
        const decided =
          verdict === 'acknowledge'
            ? await acknowledgeInconsistencyFlag(db, { actorAccountId: account.id, flagId })
            : await dismissInconsistencyFlag(db, {
                actorAccountId: account.id,
                flagId,
                reason: 'legitimate spelling variation of Rahman',
              });
        expect(isOk(decided), verdict).toBe(true);
      });
      expect(added).toEqual([
        verdict === 'acknowledge' ? 'AI_PROPOSAL_ACCEPTED' : 'AI_PROPOSAL_REJECTED',
      ]);
    }

    const events = await decisions();
    expect(events.map((e) => [e.eventType, e.dimension]).sort()).toEqual([
      ['AI_PROPOSAL_ACCEPTED', 'INCONSISTENCY'],
      ['AI_PROPOSAL_REJECTED', 'INCONSISTENCY'],
    ]);
    expect(JSON.stringify(events)).not.toContain('Rahman');
  });
});
