import { randomBytes } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { type AiExtractionPort, runExtraction } from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { getTravellerInsights } from './insights-read';
import { createMission } from './missions';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { acceptGrant, createGrant } from './sharing';

// Made-up values, seeded so the test can prove none of them reaches the insights.
const PASSPORT_NUMBER = 'BX7319046';
const READ_PASSPORT_NUMBER = 'BX7319047';
const DATE_OF_BIRTH = '1987-03-14';
const READ_DATE_OF_BIRTH = '1987-03-15';
const GIVEN_NAME = 'Nusrat';
const FILE_NAME = 'Nusrat_Jahan_passport_scan.pdf';
const NOW = new Date('2026-10-25T12:00:00Z');

/** A key service whose data key unwraps to itself, so protected values round-trip. */
function testKeyManagement(): KeyManagementPort {
  const key = randomBytes(32);
  return {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: key };
    },
    async unwrapDataKey() {
      return key;
    },
  };
}

/** Reads three details off the passport, each different from what the person confirmed. */
const reader: AiExtractionPort = {
  async extract() {
    return {
      ok: true,
      result: {
        proposals: [
          ['given_name', 'Nusrath'],
          ['date_of_birth', READ_DATE_OF_BIRTH],
          ['passport_number', READ_PASSPORT_NUMBER],
        ].map(([fieldKey, value]) => ({
          type: 'NEW' as const,
          fieldKey: fieldKey as string,
          value: value as string,
          confidence: 0.95,
          evidenceSnippet: value as string,
        })),
        usage: {
          costUnits: 1,
          inputUnits: 1,
          outputUnits: 1,
          cachedUnits: 0,
          modelVersion: 'test-model',
          promptVersion: 'p1',
          schemaVersion: 's1',
          provider: 'test',
          latencyMs: 1,
        },
      },
    };
  },
  cacheKeyComponents() {
    return { model: 'test-model', promptVersion: 'p1', schemaVersion: 's1' };
  },
};

let db: Db;
let encryption: KeyManagementPort;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  resetProtectedFieldKeyCacheForTests();
  encryption = testKeyManagement();
});

async function account(email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error(`provision ${email}`);
  return provisioned.value.id;
}

async function seed() {
  const ownerId = await account('owner@example.com');
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  const passport = await registerDocument(db, {
    actorAccountId: ownerId,
    applicantId,
    originalName: FILE_NAME,
    docType: 'PASSPORT',
  });
  if (!isOk(passport)) throw new Error('document');
  await db
    .update(schema.documents)
    .set({ expiresAt: new Date('2027-01-23T12:00:00Z') })
    .where(eq(schema.documents.id, passport.value.id));
  const version = await addDocumentVersion(db, {
    actorAccountId: ownerId,
    documentId: passport.value.id,
    bucket: 'QUARANTINE',
    objectKey: 'obj-passport',
  });
  if (!isOk(version)) throw new Error('version');
  const versionId = version.value.version.id;

  for (const key of ['given_name', 'date_of_birth', 'nationality']) {
    await registerFieldDefinition(db, { key, dataType: 'string', sensitivity: 'STANDARD' });
  }
  await registerFieldDefinition(db, {
    key: 'passport_number',
    dataType: 'string',
    sensitivity: 'SENSITIVE',
  });
  const confirm = async (fieldKey: string, value: string) => {
    const saved = await editFact(db, {
      actorAccountId: ownerId,
      applicantId,
      fieldKey,
      value,
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
      encryption,
    });
    if (!isOk(saved)) throw new Error(`save ${fieldKey}: ${saved.error.message}`);
  };
  await confirm('given_name', GIVEN_NAME);
  await confirm('date_of_birth', DATE_OF_BIRTH);
  await confirm('passport_number', PASSPORT_NUMBER);
  // One detail already saved from the passport, as an accepted reading is.
  const fromDocument = await editFact(db, {
    actorAccountId: ownerId,
    applicantId,
    fieldKey: 'nationality',
    value: 'Bangladeshi',
    status: 'DOCUMENT_SUPPORTED',
    method: 'DOCUMENT',
    sourceDocumentVersionId: versionId,
  });
  if (!isOk(fromDocument)) throw new Error('document fact');

  const run = await runExtraction(db, reader, {
    actorAccountId: ownerId,
    applicantId,
    documentVersionId: versionId,
    text: `Nusrath ${READ_DATE_OF_BIRTH} ${READ_PASSPORT_NUMBER}`,
    budgetLimitUnits: 10,
  });
  if (!isOk(run)) throw new Error('run');
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId,
    title: 'Family Visit',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { ownerId, applicantId, passportId: passport.value.id };
}

async function ownerProof(ownerId: string, applicantId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(ownerId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
  if (!isOk(proof)) throw new Error('owner proof');
  return proof.value;
}

describe('getTravellerInsights', () => {
  it('summarises the traveller from stored data, with no value and no file name in it', async () => {
    const { ownerId, applicantId, passportId } = await seed();
    const result = await getTravellerInsights(await ownerProof(ownerId, applicantId), {
      encryption,
      now: NOW,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const insights = result.value;

    expect(insights.mismatches.map((m) => [m.source, m.fieldKey, m.document?.id]).sort()).toEqual([
      ['pending_reading', 'date_of_birth', passportId],
      ['pending_reading', 'given_name', passportId],
      ['pending_reading', 'passport_number', passportId],
    ]);
    expect(insights.notCompared).toBe(0);
    // The passport is restricted: it backs one saved detail, named only by its section.
    expect(insights.evidence[0]).toMatchObject({
      document: { id: passportId, kind: 'PASSPORT', restricted: true },
      backedCount: 1,
      backedFieldKeys: [],
    });
    expect(insights.evidence[0]?.backedSections.map((s) => s.key)).toEqual(['identity_basics']);
    expect(insights.expiry).toEqual([
      expect.objectContaining({ daysRemaining: 90, urgency: 'reminder' }),
    ]);
    expect(insights.cases).toEqual([
      expect.objectContaining({ title: 'Family Visit', state: 'NO_CHECKLIST' }),
    ]);

    const text = JSON.stringify(insights);
    for (const secret of [
      PASSPORT_NUMBER,
      READ_PASSPORT_NUMBER,
      DATE_OF_BIRTH,
      READ_DATE_OF_BIRTH,
      GIVEN_NAME,
      'Bangladeshi',
      FILE_NAME,
      'Jahan',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('does not claim a protected detail differs when it could not be read', async () => {
    const { ownerId, applicantId } = await seed();
    const result = await getTravellerInsights(await ownerProof(ownerId, applicantId), { now: NOW });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.mismatches.map((m) => m.fieldKey).sort()).toEqual([
      'date_of_birth',
      'given_name',
    ]);
    expect(result.value.notCompared).toBe(1);
  });

  it('is for the owner only: a sharing grant that allows viewing is still refused', async () => {
    const { ownerId, applicantId } = await seed();
    const friendId = await account('friend@example.com');
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientAccountId: friendId,
      actions: ['VIEW_METADATA'],
      purpose: 'family-help',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: friendId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    const friendProof = await requireAccess(
      db,
      accountPrincipal(friendId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'family-help' },
    );
    expect(isOk(friendProof)).toBe(true);
    if (!isOk(friendProof)) return;
    const refused = await getTravellerInsights(friendProof.value);
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
  });

  it('refuses a copied proof', async () => {
    const { ownerId, applicantId } = await seed();
    const proof = await ownerProof(ownerId, applicantId);
    const copy = { ...proof } as unknown as typeof proof;
    const refused = await getTravellerInsights(copy);
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
  });

  it('refuses a proof for a case rather than the traveller', async () => {
    const { ownerId, applicantId } = await seed();
    const [mission] = await db
      .select({ id: schema.missions.id })
      .from(schema.missions)
      .where(eq(schema.missions.applicantId, applicantId));
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { missionId: mission?.id ?? '' },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('mission proof');
    const refused = await getTravellerInsights(proof.value);
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
  });
});
