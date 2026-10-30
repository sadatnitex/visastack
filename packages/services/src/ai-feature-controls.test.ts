import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isOk } from '@visastack/core';
import {
  AI_FEATURE_KEYS,
  AI_FEATURE_OFF_HINT,
  type AiFeatureKey,
} from '@visastack/core/ai-features';
import { schema } from '@visastack/db';
import { and, eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountPrincipal } from './access/principal';
import { requireAccess } from './access/require-access';
import { provisionAccount } from './accounts';
import {
  type AiClassifyPort,
  type AiExplainPort,
  type AiInconsistencyPort,
  approveProposal,
  explainReadinessGap,
  rejectProposal,
  runExtraction,
  runInconsistencyCheck,
  runOcr,
  suggestDocumentKind,
} from './ai';
import {
  AI_FEATURE_WINDOW_MS,
  aiEntitlementFor,
  aiFeatureDay,
  aiOwnerContext,
  chargeAiFeatureUse,
  getAiFeatureState,
  getAiFeatureStates,
  getAiUsageToday,
  isAiFeatureRefusal,
  openAiFeatureGate,
  refundAiFeatureUse,
  updateAiFeatureSetting,
} from './ai-feature-settings';
import { processAiReading } from './ai-reading';
import {
  LETTER_TEXT,
  type Reader,
  SCAN_TEXT,
  countingPorts,
  extractorFor,
  freshDb,
  jobsOf,
  noTextExtractor,
  proposalsOf,
  runIntake,
  scope,
  seedReader,
  switchAiOff,
} from './ai-reading.test-support';
import { createClientInvitation } from './client-invitations';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { runAiReadingWorker } from './jobs';
import { attachPackVersion, computeReadiness, createMission } from './missions';
import type { AiOcrPort } from './ocr';
import { createOrganization, reviewOrganization } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';
import { editFact, registerFieldDefinition } from './profile';
import { windowStartFor } from './rate-limit';
import { acceptGrant, createGrant } from './sharing';

/*
 * S28: every AI feature has a switch, a plan rule and a daily limit, and VisaStack works fully
 * with all of them off. These tests run the real services against an in-memory database, with AI
 * providers that count every call, so "no AI call was made" is a fact the test can see.
 */

const TIMEOUT = 60_000;

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  staffScope = null;
});

let staffScope: Awaited<ReturnType<typeof staffScopeFor<'AI_FEATURES_MANAGE'>>> | null = null;
async function platformOwner() {
  if (staffScope) return staffScope;
  const actor = await seedStaffAccount(db, 'PLATFORM_OWNER', 'owner@platform.example.com');
  staffScope = await staffScopeFor(db, actor, 'AI_FEATURES_MANAGE');
  return staffScope;
}

async function setFeature(feature: AiFeatureKey, enabled: boolean, dailyLimit: number | null) {
  const saved = await updateAiFeatureSetting(db, await platformOwner(), {
    feature,
    enabled,
    dailyLimit,
    stepUpSatisfied: true,
  });
  if (!isOk(saved)) throw new Error('setting');
}

async function allOff() {
  const staff = await platformOwner();
  for (const feature of AI_FEATURE_KEYS) {
    const saved = await updateAiFeatureSetting(db, staff, {
      feature,
      enabled: false,
      dailyLimit: null,
      stepUpSatisfied: true,
    });
    if (!isOk(saved)) throw new Error('setting');
  }
}

/** A rule on the Traveller Free plan for one AI feature, as the Plans page saves it. */
async function planRule(feature: AiFeatureKey, included: boolean, limit: number | null) {
  const plan = (
    await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, 'traveller_free'))
  )[0];
  if (!plan) throw new Error('traveller plan');
  await db
    .insert(schema.planEntitlements)
    .values({ planId: plan.id, key: `ai.${feature}`, included, limitValue: limit, per: 'DAY' })
    .onConflictDoUpdate({
      target: [schema.planEntitlements.planId, schema.planEntitlements.key],
      set: { included, limitValue: limit },
    });
}

/** A published pack requiring one detail (passport.number); returns its version and requirement. */
async function publishedFieldPack(actor: string) {
  const pack = await createPack(db, { actorAccountId: actor, key: 's28.pack', name: 'S28 Pack' });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    kind: 'FIELD',
    fieldKey: 'passport.number',
    citation: 'rule 1',
  });
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  const requirement = (
    await db
      .select({ id: schema.packRequirements.id })
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, version.value.id))
  )[0];
  if (!requirement) throw new Error('requirement');
  return { packVersionId: version.value.id, requirementId: requirement.id };
}

async function shareConsent(accountId: string) {
  await setConsent(db, { actorAccountId: accountId, accountId, type: 'SHARING', granted: true });
}

async function ownerProof(reader: Reader) {
  const proof = await requireAccess(
    db,
    accountPrincipal(reader.accountId),
    'VIEW_METADATA',
    { applicantId: reader.applicantId },
    { purpose: 'ai_features' },
  );
  if (!isOk(proof)) throw new Error('proof');
  return proof.value;
}

async function bucketCount(subjectId: string, feature: AiFeatureKey): Promise<number> {
  const rows = await db
    .select({ count: schema.rateLimitBuckets.count })
    .from(schema.rateLimitBuckets)
    .where(
      and(
        eq(schema.rateLimitBuckets.subjectId, subjectId),
        eq(schema.rateLimitBuckets.action, `ai_feature.${feature}`),
      ),
    );
  return rows.reduce((sum, row) => sum + row.count, 0);
}

function readInput(reader: Reader, text: string) {
  return {
    actorAccountId: reader.accountId,
    applicantId: reader.applicantId,
    documentVersionId: reader.versionId,
    text,
    budgetLimitUnits: 1000,
    feature: 'ai_document_reading' as const,
  };
}

const neverClassify: { ai: AiClassifyPort; calls: number } = {
  calls: 0,
  ai: {
    async classify() {
      neverClassify.calls += 1;
      throw new Error('the model must not be called');
    },
    classifyCacheKeyComponents: () => ({ model: 'm', promptVersion: 'p', schemaVersion: 's' }),
  },
};
const neverExplain: AiExplainPort = {
  async explain() {
    throw new Error('the model must not be called');
  },
  explainCacheKeyComponents: () => ({ model: 'm', promptVersion: 'p', schemaVersion: 's' }),
};
const neverCheck: AiInconsistencyPort = {
  async checkConsistency() {
    throw new Error('the model must not be called');
  },
  inconsistencyCacheKeyComponents: () => ({ model: 'm', promptVersion: 'p', schemaVersion: 's' }),
};

describe('which reason wins when several apply (the precedence)', () => {
  it(
    'platform off, then turned off, then not in the plan, then the daily limit, then consent, then the limits',
    async () => {
      const reader = await seedReader(db, 'order@example.com');
      const proof = await ownerProof(reader);
      const state = async (options = {}) =>
        (await getAiFeatureState(db, 'ai_explanations', { proof }, options)).reason;

      // All four apply at once.
      await setFeature('ai_explanations', false, 1);
      await planRule('ai_explanations', false, null);
      await chargeAiFeatureUse(db, {
        feature: 'ai_explanations',
        dailyLimit: null,
        subject: { kind: 'account', id: reader.accountId },
      });
      expect(await state({ platform: { model: false } })).toBe('platform_off');
      // The provider kill switch is the platform too.
      await switchAiOff(db);
      expect(await state()).toBe('platform_off');
      await db.delete(schema.aiProviderConfigs);
      expect(await state()).toBe('turned_off');
      await setFeature('ai_explanations', true, 1);
      expect(await state()).toBe('not_in_plan');
      await planRule('ai_explanations', true, null);
      expect(await state()).toBe('daily_limit');
      await setFeature('ai_explanations', true, null);
      expect(await state()).toBeNull();

      // In a service: the feature before consent, consent before the spend limits.
      await setFeature('ai_document_reading', false, null);
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type: 'AI_EXTRACTION',
        granted: false,
      });
      const { ports, calls } = countingPorts();
      const extraction = await ports.extraction();
      if (!extraction) throw new Error('ports');
      const off = await runExtraction(db, extraction.ai, {
        ...readInput(reader, LETTER_TEXT),
        budgetLimitUnits: 0,
      });
      expect(!off.ok && off.error.reason).toBe('ai_feature_off');
      expect(!off.ok && off.error.message).toBe(AI_FEATURE_OFF_HINT);
      await setFeature('ai_document_reading', true, null);
      const noConsent = await runExtraction(db, extraction.ai, {
        ...readInput(reader, LETTER_TEXT),
        budgetLimitUnits: 0,
      });
      expect(!noConsent.ok && noConsent.error.code).toBe('consent_required');
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type: 'AI_EXTRACTION',
        granted: true,
      });
      const budget = await runExtraction(db, extraction.ai, {
        ...readInput(reader, LETTER_TEXT),
        budgetLimitUnits: 0,
      });
      expect(!budget.ok && budget.error.message).toBe('AI budget exhausted');
      expect(!budget.ok && isAiFeatureRefusal(budget.error)).toBe(false);
      expect(calls.extract).toBe(0);
    },
    TIMEOUT,
  );

  it('a forged context is simply off, never an error', async () => {
    const reader = await seedReader(db, 'forged@example.com');
    const proof = await ownerProof(reader);
    expect(
      (await getAiFeatureState(db, 'ai_explanations', { proof: { ...proof } as never })).reason,
    ).toBe('turned_off');
    expect(
      (await getAiFeatureState(db, 'ai_explanations', { owner: { accountId: reader.accountId } }))
        .reason,
    ).toBe('turned_off');
    expect(
      (
        await getAiFeatureState(db, 'ai_automatic_reading', {
          system: { job: 'process-ai-reading' } as never,
          accountId: reader.accountId,
        })
      ).reason,
    ).toBe('turned_off');
    expect(
      (await getAiFeatureState(db, 'ai_explanations', aiOwnerContext(reader.accountId))).available,
    ).toBe(true);
  });
});

describe('what a plan gives', () => {
  it('uses the registry default when the plan has no rule, and the plan rule when it has one', async () => {
    const reader = await seedReader(db, 'plan@example.com');
    const proof = await ownerProof(reader);
    expect((await aiEntitlementFor(db, { accountId: reader.accountId })).features).toMatchObject({
      ai_automatic_reading: { included: true, dailyLimit: null },
      ai_app_suggestions: { included: true, dailyLimit: 15 },
    });
    expect(await getAiFeatureState(db, 'ai_consistency_checks', { proof })).toEqual({
      feature: 'ai_consistency_checks',
      available: true,
      reason: null,
      dailyLimit: null,
    });
    await planRule('ai_consistency_checks', true, 3);
    expect((await getAiFeatureState(db, 'ai_consistency_checks', { proof })).dailyLimit).toBe(3);
    // The admin can only lower it.
    await setFeature('ai_consistency_checks', true, 2);
    expect((await getAiFeatureState(db, 'ai_consistency_checks', { proof })).dailyLimit).toBe(2);
    await setFeature('ai_consistency_checks', true, 50);
    expect((await getAiFeatureState(db, 'ai_consistency_checks', { proof })).dailyLimit).toBe(3);
  });

  it('reads an agency member through the agency: its plan (registry default today) and its own count', async () => {
    const reader = await seedReader(db, 'agency-owner@example.com');
    const agent = await provisionAccount(db, { email: 'agent@example.com' });
    if (!isOk(agent)) throw new Error('agent');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await provisionAccount(db, { email: 'reviewer@example.com' });
    if (!isOk(reviewer)) throw new Error('reviewer');
    await reviewOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    await shareConsent(reader.accountId);
    const grant = await createGrant(db, {
      actorAccountId: reader.accountId,
      applicantId: reader.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error(`grant ${JSON.stringify(grant.error)}`);
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });
    const member = await requireAccess(
      db,
      accountPrincipal(agent.value.id),
      'VIEW_METADATA',
      { applicantId: reader.applicantId },
      { purpose: 'case_management' },
    );
    if (!isOk(member)) throw new Error('member');
    const opened = await openAiFeatureGate(db, 'ai_explanations', { agency: member.value });
    expect(isOk(opened) && opened.value.subject).toEqual({
      kind: 'organization',
      id: org.value.id,
    });
    if (!isOk(opened)) throw new Error('gate');
    expect((await chargeAiFeatureUse(db, opened.value))?.counted).toBe(true);
    expect(await bucketCount(org.value.id, 'ai_explanations')).toBe(1);
    expect(await bucketCount(reader.accountId, 'ai_explanations')).toBe(0);
    // An owner's proof is not an agency context.
    const own = await ownerProof(reader);
    expect((await getAiFeatureState(db, 'ai_explanations', { agency: own })).reason).toBe(
      'turned_off',
    );
  });
});

describe('counting each use against the daily limit', () => {
  it(
    'counts a real reading, never a cache hit or a refusal, and stops at the limit without calling the model',
    async () => {
      const reader = await seedReader(db, 'count@example.com');
      const { ports, calls } = countingPorts();
      const extraction = await ports.extraction();
      if (!extraction) throw new Error('ports');
      await setFeature('ai_document_reading', true, 2);

      // A refusal (no consent) is free.
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type: 'AI_EXTRACTION',
        granted: false,
      });
      expect((await runExtraction(db, extraction.ai, readInput(reader, LETTER_TEXT))).ok).toBe(
        false,
      );
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(0);
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type: 'AI_EXTRACTION',
        granted: true,
      });

      expect((await runExtraction(db, extraction.ai, readInput(reader, LETTER_TEXT))).ok).toBe(
        true,
      );
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);
      // The same text again is served from the cache: free.
      expect((await runExtraction(db, extraction.ai, readInput(reader, LETTER_TEXT))).ok).toBe(
        true,
      );
      expect(calls.extract).toBe(1);
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);

      expect(
        (await runExtraction(db, extraction.ai, readInput(reader, `${LETTER_TEXT} 2`))).ok,
      ).toBe(true);
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(2);
      const third = await runExtraction(db, extraction.ai, readInput(reader, `${LETTER_TEXT} 3`));
      expect(!third.ok && third.error.reason).toBe('ai_daily_limit');
      expect(calls.extract).toBe(2);
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(2);

      // AI Use Today says the same, and when it starts again.
      const today = await getAiUsageToday(db, { accountId: reader.accountId });
      expect(today.features.find((f) => f.feature === 'ai_document_reading')).toMatchObject({
        name: 'Read with AI',
        unit: 'files',
        used: 2,
        dailyLimit: 2,
        available: false,
        reason: 'daily_limit',
      });
      expect(today.features.map((f) => f.feature)).toEqual(AI_FEATURE_KEYS);
      expect(today.startsAgainAt.toISOString()).toMatch(/T00:00:00\.000Z$/);
      // The next UTC day starts afresh.
      const tomorrow = aiFeatureDay().to;
      expect(
        (
          await getAiFeatureState(db, 'ai_document_reading', aiOwnerContext(reader.accountId), {
            now: tomorrow,
          })
        ).available,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it('never lets the count pass the limit, even when asked again at the limit', async () => {
    const gate = {
      feature: 'ai_consistency_checks' as const,
      dailyLimit: 1,
      subject: { kind: 'account' as const, id: 'someone' },
    };
    expect((await chargeAiFeatureUse(db, gate))?.counted).toBe(true);
    expect(await chargeAiFeatureUse(db, gate)).toBeNull();
    expect(await chargeAiFeatureUse(db, gate)).toBeNull();
    expect(await bucketCount('someone', 'ai_consistency_checks')).toBe(1);
  });

  it(
    'stops automatic reading with a reason the document page can word, and still queues the job',
    async () => {
      const reader = await seedReader(db, 'auto@example.com', { docType: 'HOTEL_BOOKING' });
      const { ports, calls } = countingPorts();
      await setFeature('ai_automatic_reading', false, null);
      await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
      expect(await jobsOf(db, reader.versionId)).toHaveLength(1);
      expect(await runAiReadingWorker(db, scope(), ports)).toEqual({
        processed: 0,
        stopped: 1,
        failed: 0,
      });
      expect((await jobsOf(db, reader.versionId))[0]?.errorCode).toBe('FEATURE_OFF');
      expect(calls).toMatchObject({ extract: 0, ocr: 0, render: 0, prepare: 0 });

      // On, with a limit of one file a day: the first file is read, the second waits.
      await setFeature('ai_automatic_reading', true, 1);
      const second = await addDocumentVersionFor(reader, 'second');
      await runIntake(db, second, extractorFor(`${LETTER_TEXT} again`));
      const third = await addDocumentVersionFor(reader, 'third');
      await runIntake(db, third, extractorFor(`${LETTER_TEXT} once more`));
      await runAiReadingWorker(db, scope(), ports);
      const codes = [
        (await jobsOf(db, second))[0]?.errorCode ?? null,
        (await jobsOf(db, third))[0]?.errorCode ?? null,
      ].sort();
      expect(codes).toEqual(['DAILY_LIMIT', null]);
      expect(calls.extract).toBe(1);
      expect(await bucketCount(reader.accountId, 'ai_automatic_reading')).toBe(1);
    },
    TIMEOUT,
  );
});

async function addDocumentVersionFor(reader: Reader, name: string): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: reader.accountId,
    applicantId: reader.applicantId,
    originalName: `${name}.pdf`,
    docType: 'HOTEL_BOOKING',
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: reader.accountId,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${name}-${reader.accountId}`,
  });
  if (!isOk(version)) throw new Error('version');
  return version.value.version.id;
}

describe('VisaStack works fully with every AI feature off (the all-off journey)', () => {
  it(
    'profile, upload, case and readiness, sharing, agency invitation and view, earlier suggestions and drafts',
    async () => {
      const reader = await seedReader(db, 'journey@example.com', { docType: 'HOTEL_BOOKING' });
      // Before the switches change: an automatic reading leaves suggestions waiting.
      const { ports, calls } = countingPorts();
      await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
      await runAiReadingWorker(db, scope(), ports);
      const earlier = await proposalsOf(db, reader.versionId);
      expect(earlier.length).toBeGreaterThan(0);
      const [draftRow] = await db
        .insert(schema.aiDrafts)
        .values({
          applicantId: reader.applicantId,
          clientName: 'Claude',
          clientHost: 'claude.ai',
          title: 'Cover letter',
          body: 'A draft an AI app left earlier.',
        })
        .returning();

      await allOff();
      const proof = await ownerProof(reader);
      const states = await getAiFeatureStates(db, AI_FEATURE_KEYS, { proof });
      expect(Object.values(states).every((s) => !s.available)).toBe(true);
      const callsBefore = { ...calls };

      // The profile: a person types their own details.
      await registerFieldDefinition(db, { key: 'given_name', dataType: 'string' });
      await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
      const fact = await editFact(db, {
        actorAccountId: reader.accountId,
        applicantId: reader.applicantId,
        fieldKey: 'passport.number',
        value: 'X1234567',
      });
      expect(isOk(fact)).toBe(true);

      // Earlier suggestions stay to decide: one accepted, one skipped.
      const [first, ...rest] = earlier;
      if (!first) throw new Error('proposal');
      const approved = await approveProposal(db, {
        actorAccountId: reader.accountId,
        proposalId: first.id,
      });
      expect(approved).toMatchObject({ ok: true });
      for (const other of rest) {
        expect(
          isOk(
            await rejectProposal(db, { actorAccountId: reader.accountId, proposalId: other.id }),
          ),
        ).toBe(true);
      }

      // An upload is checked and opens for review; its reading stops calmly.
      const upload = await addDocumentVersionFor(reader, 'visa-letter');
      const intake = await runIntake(db, upload, extractorFor(`${LETTER_TEXT} new`));
      expect(intake).toBeDefined();
      const uploaded = await db
        .select({ status: schema.documentVersions.processingStatus })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, upload));
      expect(uploaded[0]?.status).toBe('AWAITING_REVIEW');
      await runAiReadingWorker(db, scope(), ports);
      expect((await jobsOf(db, upload))[0]).toMatchObject({
        status: 'DONE',
        errorCode: 'FEATURE_OFF',
      });

      // Asking for AI by hand is refused plainly, with no model call.
      const extraction = await ports.extraction();
      if (!extraction) throw new Error('ports');
      const read = await runExtraction(db, extraction.ai, {
        ...readInput(reader, `${LETTER_TEXT} new`),
        documentVersionId: upload,
      });
      expect(!read.ok && read.error.reason).toBe('ai_feature_off');
      const manage = await requireAccess(
        db,
        accountPrincipal(reader.accountId),
        'MANAGE',
        { applicantId: reader.applicantId },
        { purpose: 'owner_document_suggestion' },
      );
      if (!isOk(manage)) throw new Error('manage');
      const kind = await suggestDocumentKind(manage.value, neverClassify.ai, {
        documentVersionId: upload,
        budgetLimitUnits: 1000,
      });
      expect(!kind.ok && kind.error.reason).toBe('ai_feature_off');
      const check = await runInconsistencyCheck(db, neverCheck, {
        ...readInput(reader, LETTER_TEXT),
        documentVersionId: upload,
      });
      expect(!check.ok && check.error.reason).toBe('ai_feature_off');

      // A case, its readiness and the explanation button's refusal.
      const mission = await createMission(db, {
        actorAccountId: reader.accountId,
        applicantId: reader.applicantId,
        title: 'UK Visa',
      });
      if (!isOk(mission)) throw new Error('mission');
      const pack = await publishedFieldPack(reader.accountId);
      expect(
        isOk(
          await attachPackVersion(db, {
            actorAccountId: reader.accountId,
            missionId: mission.value.id,
            packVersionId: pack.packVersionId,
          }),
        ),
      ).toBe(true);
      const readiness = await computeReadiness(db, mission.value.id);
      expect(readiness).toMatchObject({ ok: true });
      const explained = await explainReadinessGap(db, neverExplain, {
        actorAccountId: reader.accountId,
        packRequirementId: pack.requirementId,
        requirementKind: 'FIELD',
        requirementKey: 'passport.number',
        state: 'CRITICAL_GAP',
        citation: 'rule 1',
        optional: false,
        budgetLimitUnits: 1000,
      });
      expect(!explained.ok && explained.error.reason).toBe('ai_feature_off');

      // Sharing with an agency, the agency inviting a client and viewing the shared record.
      const agent = await provisionAccount(db, { email: 'journey-agent@example.com' });
      if (!isOk(agent)) throw new Error('agent');
      const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
      if (!isOk(org)) throw new Error('org');
      const reviewer = await provisionAccount(db, { email: 'journey-reviewer@example.com' });
      if (!isOk(reviewer)) throw new Error('reviewer');
      await reviewOrganization(db, {
        reviewerAccountId: reviewer.value.id,
        organizationId: org.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      await shareConsent(reader.accountId);
      const grant = await createGrant(db, {
        actorAccountId: reader.accountId,
        applicantId: reader.applicantId,
        recipientOrganizationId: org.value.id,
        actions: ['VIEW_METADATA'],
        purpose: 'case_management',
      });
      expect(isOk(grant)).toBe(true);
      if (!isOk(grant)) throw new Error('grant');
      expect(
        isOk(await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id })),
      ).toBe(true);
      const invited = await createClientInvitation(db, {
        actorAccountId: agent.value.id,
        organizationId: org.value.id,
        caseOwnerAccountId: agent.value.id,
        displayName: 'Jane Traveller',
        contactDestination: 'jane@example.com',
        requestedRoute: 'UK visitor visa',
      });
      expect(isOk(invited)).toBe(true);
      const view = await requireAccess(
        db,
        accountPrincipal(agent.value.id),
        'VIEW_METADATA',
        { applicantId: reader.applicantId },
        { purpose: 'case_management' },
      );
      expect(isOk(view)).toBe(true);

      // A draft an AI app left earlier is still the person's to remove.
      if (!draftRow) throw new Error('draft');
      const { deleteAiDraft } = await import('./ai-suggestions');
      expect(isOk(await deleteAiDraft(manage.value, draftRow.id))).toBe(true);

      // Not one model call, and nothing counted.
      expect(calls).toEqual(callsBefore);
      expect(neverClassify.calls).toBe(0);
      expect(
        await db
          .select()
          .from(schema.rateLimitBuckets)
          .where(like(schema.rateLimitBuckets.action, 'ai_feature.%')),
      ).toEqual(
        // Only the reading made before the switches changed.
        [expect.objectContaining({ action: 'ai_feature.ai_automatic_reading', count: 1 })],
      );
    },
    TIMEOUT,
  );
});

describe('one file is one use, and only real calls count (round 2)', () => {
  function scanInput(reader: Reader, feature: 'ai_document_reading' | 'ai_automatic_reading') {
    return {
      actorAccountId: reader.accountId,
      applicantId: reader.applicantId,
      documentVersionId: reader.versionId,
      imageBytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png' as const,
      feature,
      budgetLimitUnits: 1000,
    };
  }

  it(
    'counts the details of a file whose scan came from earlier work, which counted nothing',
    async () => {
      const reader = await seedReader(db, 'cached-scan@example.com', { docType: 'HOTEL_BOOKING' });
      const { ports, calls } = countingPorts();
      // The first file: no text of its own, so a scan (counted) and then its details (not again).
      await runIntake(db, reader.versionId, noTextExtractor);
      await runAiReadingWorker(db, scope(), ports);
      expect(calls).toMatchObject({ ocr: 1, extract: 1 });
      expect(await bucketCount(reader.accountId, 'ai_automatic_reading')).toBe(1);
      // The details read from it are older than the reuse window now; the scan is not.
      await db
        .update(schema.aiExtractionRuns)
        .set({ createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
        .where(eq(schema.aiExtractionRuns.documentVersionId, reader.versionId));
      // The same picture again: the scan is served from the first one (free), the details are a
      // real call, so they are counted.
      const second = await addDocumentVersionFor(reader, 'same-picture');
      await runIntake(db, second, noTextExtractor);
      await runAiReadingWorker(db, scope(), ports);
      expect(calls).toMatchObject({ ocr: 1, extract: 2 });
      expect(await bucketCount(reader.accountId, 'ai_automatic_reading')).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'keeps a scan counted when its details are refused as busy, and a retry in a new process counts the file once',
    async () => {
      const reader = await seedReader(db, 'retry@example.com', { docType: 'HOTEL_BOOKING' });
      const { ports, calls } = countingPorts();
      await runIntake(db, reader.versionId, noTextExtractor);
      // One AI call left this hour: the scan takes it, the details are refused as busy.
      const hour = 60 * 60 * 1000;
      await db.insert(schema.rateLimitBuckets).values({
        subjectId: reader.accountId,
        action: 'ai.run',
        windowStart: windowStartFor(new Date(), hour),
        count: 149,
      });
      await expect(
        processAiReading(db, scope(), ports, { documentVersionId: reader.versionId }),
      ).rejects.toThrow('busy');
      // A real scan was made, so it stays counted.
      expect(calls.ocr).toBe(1);
      expect(await bucketCount(reader.accountId, 'ai_automatic_reading')).toBe(1);
      // The queue's retry runs later, in another process: nothing is remembered in memory.
      await db.delete(schema.rateLimitBuckets).where(eq(schema.rateLimitBuckets.action, 'ai.run'));
      vi.resetModules();
      const fresh = await import('./ai-reading');
      const { systemScopeForTest } = await import('./access/system-scope.test-support');
      const retried = await fresh.processAiReading(
        db,
        systemScopeForTest('process-ai-reading'),
        ports,
        {
          documentVersionId: reader.versionId,
        },
      );
      expect(retried.outcome).toBe('READ');
      expect(calls).toMatchObject({ ocr: 1, extract: 1 });
      expect(await bucketCount(reader.accountId, 'ai_automatic_reading')).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'counts one file once when a person reads the scan, then the details, in two separate clicks',
    async () => {
      const reader = await seedReader(db, 'two-clicks@example.com');
      const { ports, calls } = countingPorts();
      const ocr = await ports.ocr();
      const extraction = await ports.extraction();
      if (!ocr || !extraction) throw new Error('ports');
      expect((await runOcr(db, ocr.ai, scanInput(reader, 'ai_document_reading'))).ok).toBe(true);
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);
      // A refused details step is never counted.
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type: 'AI_EXTRACTION',
        granted: false,
      });
      expect((await runExtraction(db, extraction.ai, readInput(reader, SCAN_TEXT))).ok).toBe(false);
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type: 'AI_EXTRACTION',
        granted: true,
      });
      // The second click (or Read Again) finds the counted scan and does not count again.
      expect((await runExtraction(db, extraction.ai, readInput(reader, SCAN_TEXT))).ok).toBe(true);
      expect(calls).toMatchObject({ ocr: 1, extract: 1 });
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);
      // Another file's details are counted as usual.
      const other = await addDocumentVersionFor(reader, 'other-file');
      await runExtraction(db, extraction.ai, {
        ...readInput(reader, LETTER_TEXT),
        documentVersionId: other,
      });
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(2);
    },
    TIMEOUT,
  );

  it(
    'counts once when the scan timed out and a second provider answered from earlier work',
    async () => {
      const reader = await seedReader(db, 'fallback@example.com');
      const { ports, calls } = countingPorts();
      const ocr = await ports.ocr();
      const extraction = await ports.extraction();
      if (!ocr || !extraction) throw new Error('ports');
      const second: AiOcrPort = {
        async performOcr() {
          return {
            ok: true,
            result: {
              text: SCAN_TEXT,
              reviewIssues: [],
              usage: {
                costUnits: 2,
                inputUnits: 2,
                outputUnits: 1,
                modelVersion: 'f',
                promptVersion: 'f1',
                provider: 'anthropic',
                latencyMs: 1,
              },
            },
          };
        },
        cacheKeyComponents: () => ({ model: 'f', promptVersion: 'f1' }),
      };
      // Earlier work by the second provider on the same picture (another file, other feature).
      const earlier = await addDocumentVersionFor(reader, 'earlier');
      expect(
        (
          await runOcr(db, second, {
            ...scanInput(reader, 'ai_automatic_reading'),
            documentVersionId: earlier,
          })
        ).ok,
      ).toBe(true);
      const timesOut: AiOcrPort = {
        async performOcr() {
          calls.ocr += 1;
          return { ok: false, code: 'timeout', message: 'took too long' };
        },
        cacheKeyComponents: () => ({ model: 'm', promptVersion: 'o1' }),
      };
      const scan = await runOcr(db, timesOut, {
        ...scanInput(reader, 'ai_document_reading'),
        fallback: { ai: second },
      });
      expect(isOk(scan) && scan.value.ocrRun.servedFromCacheRunId).not.toBeNull();
      // The timed-out call was real, so it is counted; the answer from earlier work is free.
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);
      expect((await runExtraction(db, extraction.ai, readInput(reader, SCAN_TEXT))).ok).toBe(true);
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'counts once when the scan is at 23:59:59 UTC and its details at 00:00:01',
    async () => {
      const reader = await seedReader(db, 'midnight@example.com');
      const { ports } = countingPorts();
      const ocr = await ports.ocr();
      const extraction = await ports.extraction();
      if (!ocr || !extraction) throw new Error('ports');
      const midnight = aiFeatureDay().to;
      const before = new Date(midnight.getTime() - 1000);
      const after = new Date(midnight.getTime() + 1000);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(before);
        expect((await runOcr(db, ocr.ai, scanInput(reader, 'ai_document_reading'))).ok).toBe(true);
        // The scan's record carries the time it was made.
        await db
          .update(schema.ocrRuns)
          .set({ createdAt: before })
          .where(eq(schema.ocrRuns.documentVersionId, reader.versionId));
        vi.setSystemTime(after);
        expect((await runExtraction(db, extraction.ai, readInput(reader, SCAN_TEXT))).ok).toBe(
          true,
        );
      } finally {
        vi.useRealTimers();
      }
      // One count, in the day the scan was made.
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'gives back the use of a call the kill switch stopped after it was counted',
    async () => {
      const reader = await seedReader(db, 'stopped@example.com');
      const { ports, calls } = countingPorts();
      const ocr = await ports.ocr();
      const extraction = await ports.extraction();
      if (!ocr || !extraction) throw new Error('ports');
      const stopped = { killSwitchCheck: async () => false };
      const details = await runExtraction(db, extraction.ai, {
        ...readInput(reader, LETTER_TEXT),
        ...stopped,
      });
      expect(details.ok).toBe(false);
      const scan = await runOcr(db, ocr.ai, {
        ...scanInput(reader, 'ai_document_reading'),
        ...stopped,
      });
      expect(scan.ok).toBe(false);
      expect(calls).toMatchObject({ extract: 0, ocr: 0 });
      expect(await bucketCount(reader.accountId, 'ai_document_reading')).toBe(0);
    },
    TIMEOUT,
  );

  it('gives a use back only once, even when asked twice at the same time', async () => {
    const gate = {
      feature: 'ai_consistency_checks' as const,
      dailyLimit: null,
      subject: { kind: 'account' as const, id: 'refund-once' },
    };
    const first = await chargeAiFeatureUse(db, gate);
    await chargeAiFeatureUse(db, gate);
    expect(await bucketCount('refund-once', 'ai_consistency_checks')).toBe(2);
    await Promise.all([refundAiFeatureUse(db, first), refundAiFeatureUse(db, first)]);
    await refundAiFeatureUse(db, first);
    expect(await bucketCount('refund-once', 'ai_consistency_checks')).toBe(1);
    // A made-up charge gives nothing back.
    await refundAiFeatureUse(db, { feature: 'ai_consistency_checks', counted: true });
    expect(await bucketCount('refund-once', 'ai_consistency_checks')).toBe(1);
  });

  it('keeps a charge open when giving it back failed, so it can be given back later', async () => {
    const gate = {
      feature: 'ai_consistency_checks' as const,
      dailyLimit: null,
      subject: { kind: 'account' as const, id: 'refund-retry' },
    };
    const charge = await chargeAiFeatureUse(db, gate);
    const broken = {
      update: () => {
        throw new Error('database unavailable');
      },
    } as unknown as Db;
    await expect(refundAiFeatureUse(broken, charge)).rejects.toThrow('database unavailable');
    await refundAiFeatureUse(db, charge);
    expect(await bucketCount('refund-retry', 'ai_consistency_checks')).toBe(0);
  });

  it('every kind of AI call gives back a use the kill switch stopped, through one helper', () => {
    const source = readFileSync(fileURLToPath(new URL('./ai.ts', import.meta.url)), 'utf8');
    // Extraction, OCR, classification (twice: its own call and the document kind suggestion),
    // explanation and the consistency check.
    expect(source.match(/await refundIfSwitchedOff\(db, reservation\.charge, /g)).toHaveLength(6);
  });
});

describe('AI Use Today shows every limit that is used up (round 2)', () => {
  it(
    'says Limit Reached for AI App Suggestions and AI App Original Files, which count their own way',
    async () => {
      const reader = await seedReader(db, 'usage@example.com');
      await setFeature('ai_app_suggestions', true, null);
      await setFeature('ai_app_original_files', true, 3);
      const day = windowStartFor(new Date(), AI_FEATURE_WINDOW_MS);
      await db.insert(schema.rateLimitBuckets).values([
        { subjectId: reader.accountId, action: 'ai_write.account', windowStart: day, count: 15 },
        { subjectId: reader.accountId, action: 'ai_file.account', windowStart: day, count: 3 },
        {
          subjectId: reader.accountId,
          action: 'ai_feature.ai_explanations',
          windowStart: day,
          count: 2,
        },
      ]);
      const today = await getAiUsageToday(db, { accountId: reader.accountId });
      const row = (feature: AiFeatureKey) => today.features.find((f) => f.feature === feature);
      expect(row('ai_app_suggestions')).toMatchObject({
        used: 15,
        dailyLimit: 15,
        available: false,
        reason: 'daily_limit',
      });
      expect(row('ai_app_original_files')).toMatchObject({
        used: 3,
        dailyLimit: 3,
        available: false,
        reason: 'daily_limit',
      });
      expect(row('ai_explanations')).toMatchObject({ used: 2, available: true });
      // The tools themselves keep their own answer for their own limit.
      const proof = await ownerProof(reader);
      expect((await getAiFeatureState(db, 'ai_app_suggestions', { proof })).available).toBe(true);
    },
    TIMEOUT,
  );
});
