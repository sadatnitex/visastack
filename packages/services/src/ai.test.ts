import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiExtractionOutcome,
  type AiExtractionPort,
  type FieldProposal,
  approveProposal,
  listPendingProposals,
  rejectProposal,
  runExtraction,
  totalAiCostUnits,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { editFact, getCurrentFactVersion, registerFieldDefinition } from './profile';

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

async function grantAiConsent(db: Db, accountId: string) {
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'AI_EXTRACTION',
    granted: true,
  });
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
  modelVersion: 'gpt-5.6-terra',
  promptVersion: 'p1',
  schemaVersion: 's1',
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

    const second = await runExtraction(db, stubAi(), {
      actorAccountId: account.id,
      applicantId,
      documentVersionId: versionId,
      text: 'MRZ...',
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
