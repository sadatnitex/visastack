import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { decideAcknowledgement, getLiveAcknowledgement } from './acknowledgements';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  attachPackVersion,
  createMission,
  listTasks,
  selectEvidence,
  snapshotMission,
} from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { acceptGrant, createGrant } from './sharing';
import { documentLifecycleStatus, getWalletView, supersedeDocument } from './wallet';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'SHARING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { account, applicant: applicant.value };
}

describe('documentLifecycleStatus (EVI-04)', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('is UNKNOWN with no expiry and no supersession', () => {
    expect(documentLifecycleStatus({ expiresAt: null, supersededByDocumentId: null }, now)).toBe(
      'UNKNOWN',
    );
  });

  it('is CURRENT when expiry is well beyond the expiring-soon window', () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    expect(documentLifecycleStatus({ expiresAt, supersededByDocumentId: null }, now)).toBe(
      'CURRENT',
    );
  });

  it('is EXPIRING within the window before expiry', () => {
    const expiresAt = new Date('2026-06-15T00:00:00Z');
    expect(documentLifecycleStatus({ expiresAt, supersededByDocumentId: null }, now)).toBe(
      'EXPIRING',
    );
  });

  it('is EXPIRED once the expiry date has passed', () => {
    const expiresAt = new Date('2026-01-01T00:00:00Z');
    expect(documentLifecycleStatus({ expiresAt, supersededByDocumentId: null }, now)).toBe(
      'EXPIRED',
    );
  });

  it('is SUPERSEDED regardless of expiry, taking priority over every other status', () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    expect(documentLifecycleStatus({ expiresAt, supersededByDocumentId: 'some-id' }, now)).toBe(
      'SUPERSEDED',
    );
  });
});

describe('getWalletView (EVI-04)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("shows the owner's own documents with lifecycle status, denies a non-owner", async () => {
    const { account, applicant } = await seedOwner(db, 'wallet-owner@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(doc)) throw new Error('doc');

    const view = await getWalletView(db, { actorAccountId: account.id, applicantId: applicant.id });
    expect(isOk(view)).toBe(true);
    if (isOk(view)) {
      expect(view.value).toHaveLength(1);
      expect(view.value[0]?.status).toBe('UNKNOWN');
      expect(view.value[0]?.usedInMissions).toEqual([]);
      expect(view.value[0]?.accessibleTo).toEqual([]);
    }

    const stranger = await provisionAccount(db, { email: 'wallet-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await getWalletView(db, {
      actorAccountId: stranger.value.id,
      applicantId: applicant.id,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });

  it('reports which mission uses a document as selected evidence', async () => {
    const { account, applicant } = await seedOwner(db, 'wallet-usage-owner@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'wallet-usage-key',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const pack = await createPack(db, {
      actorAccountId: account.id,
      key: 'wallet.pack',
      name: 'P',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'rule 1',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      documentId: doc.value.id,
    });
    expect(isOk(selected)).toBe(true);

    const view = await getWalletView(db, { actorAccountId: account.id, applicantId: applicant.id });
    expect(isOk(view)).toBe(true);
    if (isOk(view)) {
      const entry = view.value.find((v) => v.document.id === doc.value.id);
      expect(entry?.usedInMissions).toEqual([
        { missionId: mission.value.id, missionTitle: 'UK Visa' },
      ]);
    }
  });

  it('reports an organization currently holding real access to the document', async () => {
    const { account, applicant } = await seedOwner(db, 'wallet-access-owner@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(doc)) throw new Error('doc');

    const agent = await provisionAccount(db, { email: 'wallet-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'wallet-platform-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
      documentIds: [doc.value.id],
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const view = await getWalletView(db, { actorAccountId: account.id, applicantId: applicant.id });
    expect(isOk(view)).toBe(true);
    if (isOk(view)) {
      const entry = view.value.find((v) => v.document.id === doc.value.id);
      expect(entry?.accessibleTo).toEqual([{ kind: 'organization', label: 'Acme' }]);
    }
  });
});

describe('supersedeDocument (EVI-04)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('links the old document forward, never mutating it, and its status becomes SUPERSEDED', async () => {
    const { account, applicant } = await seedOwner(db, 'supersede-owner@example.com');
    const oldDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport-old.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(oldDoc)) throw new Error('oldDoc');
    const newDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport-new.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(newDoc)) throw new Error('newDoc');

    const superseded = await supersedeDocument(db, {
      actorAccountId: account.id,
      oldDocumentId: oldDoc.value.id,
      newDocumentId: newDoc.value.id,
    });
    expect(isOk(superseded)).toBe(true);
    if (isOk(superseded)) expect(superseded.value.flaggedMissionIds).toEqual([]);

    const view = await getWalletView(db, { actorAccountId: account.id, applicantId: applicant.id });
    expect(isOk(view)).toBe(true);
    if (isOk(view)) {
      const entry = view.value.find((v) => v.document.id === oldDoc.value.id);
      expect(entry?.status).toBe('SUPERSEDED');
      expect(entry?.document.originalName).toBe('passport-old.pdf');
    }
  });

  it('flags every mission using the old document as selected evidence with a real, visible task', async () => {
    const { account, applicant } = await seedOwner(db, 'supersede-flag-owner@example.com');
    const oldDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'bank-old.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(oldDoc)) throw new Error('oldDoc');
    const newDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'bank-new.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(newDoc)) throw new Error('newDoc');

    const pack = await createPack(db, { actorAccountId: account.id, key: 'flag.pack', name: 'P' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'rule 1',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });
    await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      documentId: oldDoc.value.id,
    });
    const revisionOf = async () =>
      (
        await db
          .select({ revision: schema.missions.materialRevision })
          .from(schema.missions)
          .where(eq(schema.missions.id, mission.value.id))
      )[0]?.revision;
    const revisionBefore = await revisionOf();
    // The applicant confirms the prepared file before the document is replaced.
    const snapshot = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    if (!isOk(snapshot)) throw new Error('snapshot');
    const acknowledged = await decideAcknowledgement(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      snapshotId: snapshot.value.id,
      expectedSnapshotChecksum: snapshot.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    expect(isOk(acknowledged)).toBe(true);
    expect(await getLiveAcknowledgement(db, mission.value.id)).toBeDefined();

    // Two simultaneous attempts: exactly one supersedes.
    const attempts = await Promise.all([
      supersedeDocument(db, {
        actorAccountId: account.id,
        oldDocumentId: oldDoc.value.id,
        newDocumentId: newDoc.value.id,
      }),
      supersedeDocument(db, {
        actorAccountId: account.id,
        oldDocumentId: oldDoc.value.id,
        newDocumentId: newDoc.value.id,
      }),
    ]);
    const succeeded = attempts.filter((r) => isOk(r));
    expect(succeeded).toHaveLength(1);
    const superseded = succeeded[0];
    if (superseded && isOk(superseded)) {
      expect(superseded.value.flaggedMissionIds).toEqual([mission.value.id]);
    }
    // A replaced document is a material change (v1.2 E03, W0-04): the case revision moves
    // once, and the acknowledgement made with the old document no longer stands.
    expect(await revisionOf()).toBe((revisionBefore ?? 0) + 1);
    expect(await getLiveAcknowledgement(db, mission.value.id)).toBeUndefined();

    const tasks = await listTasks(db, account.id, mission.value.id);
    expect(isOk(tasks)).toBe(true);
    if (isOk(tasks)) {
      expect(tasks.value).toHaveLength(1);
      expect(tasks.value[0]?.description).toContain('bank-old.pdf');
      expect(tasks.value[0]?.status).toBe('OPEN');
    }
  });

  it('refuses to supersede across two different applicants', async () => {
    const { account: accountA, applicant: applicantA } = await seedOwner(
      db,
      'supersede-cross-a@example.com',
    );
    const { account: accountB, applicant: applicantB } = await seedOwner(
      db,
      'supersede-cross-b@example.com',
    );
    const docA = await registerDocument(db, {
      actorAccountId: accountA.id,
      applicantId: applicantA.id,
      originalName: 'a.pdf',
    });
    if (!isOk(docA)) throw new Error('docA');
    const docB = await registerDocument(db, {
      actorAccountId: accountB.id,
      applicantId: applicantB.id,
      originalName: 'b.pdf',
    });
    if (!isOk(docB)) throw new Error('docB');

    const denied = await supersedeDocument(db, {
      actorAccountId: accountA.id,
      oldDocumentId: docA.value.id,
      newDocumentId: docB.value.id,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('invalid');
  });

  it('refuses a non-owner, and refuses to re-supersede an already-superseded document', async () => {
    const { account, applicant } = await seedOwner(db, 'supersede-denied-owner@example.com');
    const oldDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport-old.pdf',
    });
    if (!isOk(oldDoc)) throw new Error('oldDoc');
    const newDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport-new.pdf',
    });
    if (!isOk(newDoc)) throw new Error('newDoc');
    const anotherDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport-newer.pdf',
    });
    if (!isOk(anotherDoc)) throw new Error('anotherDoc');

    const stranger = await provisionAccount(db, { email: 'supersede-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const strangerDenied = await supersedeDocument(db, {
      actorAccountId: stranger.value.id,
      oldDocumentId: oldDoc.value.id,
      newDocumentId: newDoc.value.id,
    });
    expect(isErr(strangerDenied)).toBe(true);
    if (isErr(strangerDenied)) expect(strangerDenied.error.code).toBe('forbidden');

    const first = await supersedeDocument(db, {
      actorAccountId: account.id,
      oldDocumentId: oldDoc.value.id,
      newDocumentId: newDoc.value.id,
    });
    expect(isOk(first)).toBe(true);

    const second = await supersedeDocument(db, {
      actorAccountId: account.id,
      oldDocumentId: oldDoc.value.id,
      newDocumentId: anotherDoc.value.id,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });
});
