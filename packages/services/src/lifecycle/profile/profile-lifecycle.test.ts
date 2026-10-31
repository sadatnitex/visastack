import { randomBytes, randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { MODULE_FIELDS } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../../access';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import {
  attachPackVersion,
  computeReadiness,
  createMission,
  getMissionSnapshot,
  snapshotMission,
} from '../../missions';
import { createOrganization, reviewOrganization } from '../../organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../../packs';
import type { KeyManagementPort } from '../../ports';
import {
  editFact,
  listApplicantProfile,
  listFactHistory,
  registerFieldDefinition,
} from '../../profile';
import { resetProtectedFieldKeyCacheForTests } from '../../protected-fields';
import { acceptGrant, createGrant } from '../../sharing';
import { listEndedRecords, markFactNotCurrent, markRecordEnded } from './profile-lifecycle';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

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

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

async function editAccess(db: Db, accountId: string, applicantId: string) {
  const gate = await requireAccess(
    db,
    accountPrincipal(accountId),
    'APPROVE_EDIT',
    { applicantId },
    { purpose: 'profile_edit' },
  );
  if (!gate.ok) throw new Error(`access: ${gate.error.code}`);
  return gate.value;
}

async function viewAccess(db: Db, accountId: string, applicantId: string) {
  const gate = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'profile_view' },
  );
  if (!gate.ok) throw new Error(`access: ${gate.error.code}`);
  return gate.value;
}

async function save(
  db: Db,
  input: {
    accountId: string;
    applicantId: string;
    fieldKey: string;
    value: string;
    repeatingRecordKey?: string;
    encryption?: KeyManagementPort;
  },
) {
  const result = await editFact(db, { actorAccountId: input.accountId, ...input });
  if (!isOk(result)) throw new Error(`edit: ${result.error.message}`);
  return result.value;
}

/** A real catalogue repeating record with at least two details, so "every fact of the entry" is meaningful. */
const groupKey = (() => {
  const counts = new Map<string, number>();
  for (const field of MODULE_FIELDS) {
    if (field.group) counts.set(field.group, (counts.get(field.group) ?? 0) + 1);
  }
  const key = [...counts].find(([, n]) => n >= 2)?.[0];
  if (!key) throw new Error('no repeating record with two details in the catalogue');
  return key;
})();
const groupFieldKeys = MODULE_FIELDS.filter((field) => field.group === groupKey)
  .slice(0, 2)
  .map((field) => field.key);
const [firstGroupField = '', secondGroupField = ''] = groupFieldKeys;

describe('LC-G1 No Longer Current and Ended', () => {
  let db: Db;
  let owner: { accountId: string; applicantId: string };

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    owner = await seedOwner(db, 'g1-owner@example.com');
    await registerFieldDefinition(db, { key: 'nationality', dataType: 'string' });
    for (const key of groupFieldKeys) {
      await registerFieldDefinition(db, { key, dataType: 'string', repeating: true });
    }
  });

  it('clears a value: the current version holds no value and reads as STALE', async () => {
    // Red first: before LC-G1 nothing could clear a saved detail. The editor refuses an empty
    // value, so the only change possible was another value.
    const saved = await save(db, { ...owner, fieldKey: 'nationality', value: 'Bangladeshi' });
    const access = await editAccess(db, owner.accountId, owner.applicantId);
    const marked = await markFactNotCurrent(access, { factId: saved.fact.id });
    expect(isOk(marked)).toBe(true);
    const [entry] = await listApplicantProfile(db, owner.applicantId);
    expect(entry?.value).toBeNull();
    expect(entry?.status).toBe('STALE');
  });

  it('appends a version with no value, keeps every earlier version, and audits it', async () => {
    const saved = await save(db, { ...owner, fieldKey: 'nationality', value: 'Bangladeshi' });
    const access = await editAccess(db, owner.accountId, owner.applicantId);
    const marked = await markFactNotCurrent(access, { factId: saved.fact.id });
    if (!isOk(marked)) throw new Error('mark');
    expect(marked.value.changed).toBe(true);

    const history = await listFactHistory(db, saved.fact.id);
    expect(history.map((v) => [v.value, v.status])).toEqual([
      ['Bangladeshi', 'APPLICANT_CONFIRMED'],
      [null, 'STALE'],
    ]);

    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'FACT_MARKED_NOT_CURRENT'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({ mark: 'NOT_CURRENT', fieldKey: 'nationality' });
    // Never the value itself.
    expect(JSON.stringify(audit[0])).not.toContain('Bangladeshi');

    // Marking again writes nothing new.
    const again = await markFactNotCurrent(access, { factId: saved.fact.id });
    expect(isOk(again) && again.value.changed).toBe(false);
    expect(await listFactHistory(db, saved.fact.id)).toHaveLength(2);
  });

  it('is undone by entering a new value', async () => {
    const saved = await save(db, { ...owner, fieldKey: 'nationality', value: 'Bangladeshi' });
    const access = await editAccess(db, owner.accountId, owner.applicantId);
    await markFactNotCurrent(access, { factId: saved.fact.id });
    await save(db, { ...owner, fieldKey: 'nationality', value: 'Singaporean' });
    const [entry] = await listApplicantProfile(db, owner.applicantId);
    expect(entry?.value).toBe('Singaporean');
    expect(entry?.status).toBe('APPLICANT_CONFIRMED');
    expect(await listFactHistory(db, saved.fact.id)).toHaveLength(3);
  });

  it('refuses a fact of another profile', async () => {
    const other = await seedOwner(db, 'g1-other@example.com');
    const theirs = await save(db, { ...other, fieldKey: 'nationality', value: 'Indian' });
    const access = await editAccess(db, owner.accountId, owner.applicantId);
    const marked = await markFactNotCurrent(access, { factId: theirs.fact.id });
    expect(isErr(marked) && marked.error.code).toBe('not_found');
    expect(await listFactHistory(db, theirs.fact.id)).toHaveLength(1);
  });

  it('refuses without core processing consent', async () => {
    const saved = await save(db, { ...owner, fieldKey: 'nationality', value: 'Bangladeshi' });
    await setConsent(db, {
      actorAccountId: owner.accountId,
      accountId: owner.accountId,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    const access = await editAccess(db, owner.accountId, owner.applicantId);
    const marked = await markFactNotCurrent(access, { factId: saved.fact.id });
    expect(isErr(marked) && marked.error.code).toBe('consent_required');
  });

  it('agency members cannot use either, even with an editing grant', async () => {
    const saved = await save(db, { ...owner, fieldKey: 'nationality', value: 'Bangladeshi' });
    const recordKey = randomUUID();
    await save(db, {
      ...owner,
      fieldKey: firstGroupField,
      value: 'A',
      repeatingRecordKey: recordKey,
    });

    const agent = await provisionAccount(db, { email: 'g1-agent@example.com' });
    if (!isOk(agent)) throw new Error('agent');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Agency' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'g1-admin@example.com' });
    if (!isOk(admin)) throw new Error('admin');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['APPROVE_EDIT', 'VIEW_METADATA'],
      purpose: 'agency_review',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const gate = await requireAccess(
      db,
      accountPrincipal(agent.value.id),
      'APPROVE_EDIT',
      { applicantId: owner.applicantId },
      { purpose: 'agency_review' },
    );
    // The policy may already refuse an agency edit; when it allows one, the owner-only rule does.
    if (gate.ok) {
      const marked = await markFactNotCurrent(gate.value, { factId: saved.fact.id });
      expect(isErr(marked) && marked.error.code).toBe('forbidden');
      const ended = await markRecordEnded(gate.value, {
        recordGroupKey: groupKey,
        repeatingRecordKey: recordKey,
        endedOn: new Date('2025-01-31'),
      });
      expect(isErr(ended) && ended.error.code).toBe('forbidden');
      const denied = await db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, 'FACT_EDIT_DENIED'),
            eq(schema.auditEvents.reason, 'owner_only'),
          ),
        );
      expect(denied).toHaveLength(2);
    } else {
      expect(gate.error.code).toBe('forbidden');
    }
    expect(await listFactHistory(db, saved.fact.id)).toHaveLength(1);
  });

  it('readiness treats a no longer current detail as missing, and the earlier snapshot keeps its value', async () => {
    const pack = await createPack(db, { actorAccountId: owner.accountId, key: 'g1', name: 'G1' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, {
      actorAccountId: owner.accountId,
      packId: pack.value.id,
    });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: owner.accountId,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'nationality',
      citation: 'rule 1',
    });
    await approvePackVersion(db, {
      actorAccountId: owner.accountId,
      packVersionId: version.value.id,
    });
    await publishPackVersion(db, {
      actorAccountId: owner.accountId,
      packVersionId: version.value.id,
    });
    const mission = await createMission(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      title: 'Trip',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: owner.accountId,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });

    const saved = await save(db, { ...owner, fieldKey: 'nationality', value: 'Bangladeshi' });
    const before = await computeReadiness(db, mission.value.id);
    expect(isOk(before) && before.value.ready).toBe(true);
    const snapshot = await snapshotMission(db, {
      actorAccountId: owner.accountId,
      missionId: mission.value.id,
    });
    if (!isOk(snapshot)) throw new Error('snapshot');

    const access = await editAccess(db, owner.accountId, owner.applicantId);
    await markFactNotCurrent(access, { factId: saved.fact.id });

    const after = await computeReadiness(db, mission.value.id);
    if (!isOk(after)) throw new Error('readiness');
    expect(after.value.ready).toBe(false);
    expect(after.value.missing.map((m) => m.key)).toContain('nationality');

    const kept = await getMissionSnapshot(db, owner.accountId, mission.value.id, snapshot.value.id);
    if (!isOk(kept)) throw new Error('kept');
    expect(JSON.stringify(kept.value)).toContain('Bangladeshi');
  });

  it('ends one entry: one new version per detail carrying the end date, in history, value kept', async () => {
    const recordKey = randomUUID();
    const otherKey = randomUUID();
    const a = await save(db, {
      ...owner,
      fieldKey: firstGroupField,
      value: 'Old street',
      repeatingRecordKey: recordKey,
    });
    const b = await save(db, {
      ...owner,
      fieldKey: secondGroupField,
      value: 'Dhaka',
      repeatingRecordKey: recordKey,
    });
    await save(db, {
      ...owner,
      fieldKey: firstGroupField,
      value: 'New street',
      repeatingRecordKey: otherKey,
    });

    const access = await editAccess(db, owner.accountId, owner.applicantId);
    const endedOn = new Date('2025-06-30T00:00:00.000Z');
    const ended = await markRecordEnded(access, {
      recordGroupKey: groupKey,
      repeatingRecordKey: recordKey,
      endedOn,
    });
    if (!isOk(ended)) throw new Error(`end: ${ended.error.message}`);
    expect(ended.value.versionsWritten).toBe(2);

    for (const [fact, value] of [
      [a.fact, 'Old street'],
      [b.fact, 'Dhaka'],
    ] as const) {
      const history = await listFactHistory(db, fact.id);
      expect(history).toHaveLength(2);
      expect(history[0]?.validUntil).toBeNull();
      expect(history[1]?.value).toBe(value);
      expect(history[1]?.validUntil?.toISOString()).toBe(endedOn.toISOString());
    }

    const view = await viewAccess(db, owner.accountId, owner.applicantId);
    const endedRecords = await listEndedRecords(view);
    expect([...endedRecords]).toEqual([[recordKey, endedOn.toISOString()]]);

    // Entering a new value in any detail makes the entry current again.
    await save(db, {
      ...owner,
      fieldKey: secondGroupField,
      value: 'Chattogram',
      repeatingRecordKey: recordKey,
    });
    expect((await listEndedRecords(view)).size).toBe(0);
  });

  it('refuses an unknown record, a record of the wrong kind, a missing entry and a future date', async () => {
    const recordKey = randomUUID();
    await save(db, {
      ...owner,
      fieldKey: firstGroupField,
      value: 'Old street',
      repeatingRecordKey: recordKey,
    });
    const access = await editAccess(db, owner.accountId, owner.applicantId);
    const past = new Date('2025-01-01');
    const unknown = await markRecordEnded(access, {
      recordGroupKey: 'not_a_record',
      repeatingRecordKey: recordKey,
      endedOn: past,
    });
    expect(isErr(unknown) && unknown.error.code).toBe('invalid');
    const otherGroup = MODULE_FIELDS.find(
      (field) => field.group && field.group !== groupKey && !groupFieldKeys.includes(field.key),
    )?.group;
    if (otherGroup) {
      const wrong = await markRecordEnded(access, {
        recordGroupKey: otherGroup,
        repeatingRecordKey: recordKey,
        endedOn: past,
      });
      expect(isErr(wrong) && wrong.error.code).toBe('invalid');
    }
    const missing = await markRecordEnded(access, {
      recordGroupKey: groupKey,
      repeatingRecordKey: randomUUID(),
      endedOn: past,
    });
    expect(isErr(missing) && missing.error.code).toBe('not_found');
    const future = await markRecordEnded(access, {
      recordGroupKey: groupKey,
      repeatingRecordKey: recordKey,
      endedOn: new Date(Date.now() + 3 * 86_400_000),
    });
    expect(isErr(future) && future.error.code).toBe('invalid');
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'FACT_MARKED_NOT_CURRENT'));
    expect(audit).toHaveLength(0);
  });

  it('keeps a protected detail encrypted when an entry ends and when a value is entered again', async () => {
    // Registered as STANDARD in beforeEach; this test needs it protected.
    await db
      .update(schema.fieldDefinitions)
      .set({ sensitivity: 'RESTRICTED' })
      .where(eq(schema.fieldDefinitions.key, firstGroupField));
    const encryption = fakeKeyManagementPort();
    const recordKey = randomUUID();
    const saved = await save(db, {
      ...owner,
      fieldKey: firstGroupField,
      value: 'X1234567',
      repeatingRecordKey: recordKey,
      encryption,
    });
    const access = await editAccess(db, owner.accountId, owner.applicantId);

    const noPort = await markRecordEnded(access, {
      recordGroupKey: groupKey,
      repeatingRecordKey: recordKey,
      endedOn: new Date('2025-01-01'),
    });
    expect(isErr(noPort) && noPort.error.code).toBe('encryption_unavailable');

    const ended = await markRecordEnded(access, {
      recordGroupKey: groupKey,
      repeatingRecordKey: recordKey,
      endedOn: new Date('2025-01-01'),
      encryption,
    });
    expect(isOk(ended)).toBe(true);
    const rows = await db
      .select()
      .from(schema.factVersions)
      .where(eq(schema.factVersions.factId, saved.fact.id))
      .orderBy(asc(schema.factVersions.createdAt));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.value).toBeNull();
      expect(row.valueCiphertext).not.toBeNull();
      expect(row.protectedKeyVersion).toBe('test-v1');
    }
    const [entry] = await listApplicantProfile(db, owner.applicantId, encryption);
    expect(entry?.value).toBe('X1234567');

    // A protected single value marked no longer current holds nothing to encrypt; a new value
    // entered afterwards is encrypted again.
    const marked = await markFactNotCurrent(access, { factId: saved.fact.id });
    expect(isOk(marked)).toBe(true);
    await save(db, {
      ...owner,
      fieldKey: firstGroupField,
      value: 'Y7654321',
      repeatingRecordKey: recordKey,
      encryption,
    });
    const latest = (
      await db
        .select()
        .from(schema.factVersions)
        .where(eq(schema.factVersions.factId, saved.fact.id))
        .orderBy(asc(schema.factVersions.createdAt))
    ).map((row) => [row.value === null, row.valueCiphertext === null, row.status]);
    expect(latest).toEqual([
      [true, false, 'APPLICANT_CONFIRMED'],
      [true, false, 'APPLICANT_CONFIRMED'],
      [true, true, 'STALE'],
      [true, false, 'APPLICANT_CONFIRMED'],
    ]);
    const [again] = await listApplicantProfile(db, owner.applicantId, encryption);
    expect(again?.value).toBe('Y7654321');
  });

  it('behaves the same with the lifecycle tables missing and present (G1 reads none of them)', async () => {
    for (const present of [false, true]) {
      if (present) {
        await db.execute(
          sql`create table if not exists document_lifecycle (document_id uuid primary key)`,
        );
        await db.execute(
          sql`create table if not exists applicant_lifecycle (applicant_id uuid primary key)`,
        );
      }
      const saved = await save(db, { ...owner, fieldKey: 'nationality', value: `V-${present}` });
      const access = await editAccess(db, owner.accountId, owner.applicantId);
      const marked = await markFactNotCurrent(access, { factId: saved.fact.id });
      expect(isOk(marked) && marked.value.changed).toBe(true);
      const recordKey = randomUUID();
      await save(db, {
        ...owner,
        fieldKey: firstGroupField,
        value: 'A',
        repeatingRecordKey: recordKey,
      });
      const ended = await markRecordEnded(access, {
        recordGroupKey: groupKey,
        repeatingRecordKey: recordKey,
        endedOn: new Date('2025-01-01'),
      });
      expect(isOk(ended)).toBe(true);
    }
  });
});
