import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  attachPackVersion,
  computeReadiness,
  createMission,
  snapshotMission,
  transitionMission,
} from './missions';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'm@example.com' });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
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
  return { account, applicantId: applicant.value.id };
}

/** A published pack requiring passport.number (FIELD) + bank_statement (DOCUMENT). */
async function publishedPack(db: Db, actor: string): Promise<string> {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: 'uk.tourist',
    name: 'UK Tourist',
  });
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
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'bank_statement',
    citation: 'rule 2',
  });
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  return version.value.id;
}

describe('missions — workspace, readiness, workflow, snapshot', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('only attaches a PUBLISHED pack version', async () => {
    const { account, applicantId } = await seed(db);
    const pack = await createPack(db, { actorAccountId: account.id, key: 'p', name: 'P' });
    if (!isOk(pack)) throw new Error('pack');
    const draft = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(draft)) throw new Error('draft');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    const attach = await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: draft.value.id,
    });
    expect(isErr(attach)).toBe(true);
    if (isErr(attach)) expect(attach.error.code).toBe('invalid');
  });

  it('reports readiness as completeness (missing → satisfied), not probability', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    const before = await computeReadiness(db, mission.value.id);
    expect(isOk(before)).toBe(true);
    if (!isOk(before)) return;
    expect(before.value.ready).toBe(false);
    expect(before.value.requiredCount).toBe(2);
    expect(before.value.satisfiedRequired).toBe(0);
    expect(before.value.missing).toHaveLength(2);

    // Satisfy both requirements.
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
    });

    const after = await computeReadiness(db, mission.value.id);
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    expect(after.value.ready).toBe(true);
    expect(after.value.satisfiedRequired).toBe(2);
    expect(after.value.missing).toHaveLength(0);
  });

  it('enforces legal state transitions only', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    // DRAFT → UNDER_REVIEW is illegal.
    const illegal = await transitionMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      to: 'UNDER_REVIEW',
    });
    expect(isErr(illegal)).toBe(true);
    if (isErr(illegal)) expect(illegal.error.code).toBe('invalid');

    // DRAFT → IN_PROGRESS → READY_FOR_REVIEW is legal.
    const t1 = await transitionMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      to: 'IN_PROGRESS',
    });
    const t2 = await transitionMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      to: 'READY_FOR_REVIEW',
    });
    expect(isOk(t1) && isOk(t2)).toBe(true);
    if (isOk(t2)) expect(t2.value.state).toBe('READY_FOR_REVIEW');
  });

  it('captures immutable, checksummed, incrementing snapshots', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    const s1 = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    const s2 = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(s1) && isOk(s2)).toBe(true);
    if (!isOk(s1) || !isOk(s2)) return;
    expect(s1.value.version).toBe(1);
    expect(s2.value.version).toBe(2);
    expect(s1.value.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The append-only audit rule protects the row; snapshots are never rewritten.
    const rows = await db.select().from(schema.missionSnapshots);
    expect(rows).toHaveLength(2);
  });

  it("refuses actions on another owner's mission", async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const other = await provisionAccount(db, { email: 'other-m@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await transitionMission(db, {
      actorAccountId: other.value.id,
      missionId: mission.value.id,
      to: 'IN_PROGRESS',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});
