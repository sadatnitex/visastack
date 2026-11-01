import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../../access/require-access';
import { provisionAccount } from '../../accounts';
import { decideAcknowledgement, getLiveAcknowledgement } from '../../acknowledgements';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import {
  attachPackVersion,
  createMission,
  listTasks,
  selectEvidence,
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
import { acceptGrant, createGrant } from '../../sharing';
import { supersedeDocument } from '../../wallet';
import { documentLifecycleLabel, listReplacementOptions, replaceDocument } from './index';

const HEAVY = 60_000;

async function freshDb(options: { readonly withoutLifecycle?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    // The database as production has it until the owner approves migration 0113.
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  return drizzle(client, { schema }) as unknown as Db;
}

interface Owner {
  readonly accountId: string;
  readonly applicantId: string;
}

async function seedOwner(db: Db, email: string): Promise<Owner> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Synthetic Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

let keyCounter = 0;

/** A document with one version; `ready` makes it checked and readable. */
async function addDocument(
  db: Db,
  owner: Owner,
  name: string,
  options: { readonly docType?: string; readonly ready?: boolean } = {},
): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: name,
    docType: options.docType ?? 'PASSPORT',
  });
  if (!isOk(doc)) throw new Error('document');
  keyCounter += 1;
  const ready = options.ready ?? true;
  const version = await addDocumentVersion(db, {
    actorAccountId: owner.accountId,
    documentId: doc.value.id,
    bucket: ready ? 'CLEAN' : 'QUARANTINE',
    objectKey: `replace-test-${keyCounter}`,
    safetyStatus: ready ? 'CLEAN' : 'PENDING',
    processingStatus: ready ? 'AWAITING_REVIEW' : 'SCANNING',
  });
  if (!isOk(version)) throw new Error(`version: ${version.error.code}`);
  return doc.value.id;
}

async function manage(db: Db, owner: Owner): Promise<AuthorizedApplicant<'MANAGE'>> {
  const result = await requireAccess(
    db,
    accountPrincipal(owner.accountId),
    'MANAGE',
    { applicantId: owner.applicantId },
    { purpose: 'self' },
  );
  if (!result.ok) throw new Error(`proof: ${result.error.code}`);
  return result.value;
}

/** A published case for `owner` asking for a passport, with `documentId` selected. */
async function caseUsing(db: Db, owner: Owner, documentId: string, title: string) {
  const pack = await createPack(db, {
    actorAccountId: owner.accountId,
    key: `replace.${title.replace(/\W/g, '').toLowerCase()}.${keyCounter++}`,
    name: 'P',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, {
    actorAccountId: owner.accountId,
    packId: pack.value.id,
  });
  if (!isOk(version)) throw new Error('version');
  const requirement = await addRequirement(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'PASSPORT',
    citation: 'rule 1',
  });
  if (!isOk(requirement)) throw new Error('requirement');
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
    title,
  });
  if (!isOk(mission)) throw new Error('mission');
  await attachPackVersion(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packVersionId: version.value.id,
  });
  const selected = await selectEvidence(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packRequirementId: requirement.value.id,
    documentId,
  });
  if (!isOk(selected)) throw new Error(`select: ${selected.error.code}`);
  return mission.value.id;
}

async function replacedBy(db: Db, documentId: string): Promise<string | null> {
  const [row] = await db
    .select({ by: schema.documents.supersededByDocumentId })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return row?.by ?? null;
}

describe.each([
  { label: 'with the lifecycle tables', withoutLifecycle: false },
  { label: 'with the lifecycle tables missing', withoutLifecycle: true },
])('replaceDocument ($label)', ({ withoutLifecycle }) => {
  let db: Db;
  let owner: Owner;
  beforeEach(async () => {
    db = await freshDb({ withoutLifecycle });
    owner = await seedOwner(db, 'replace-owner@example.com');
  }, HEAVY);

  // Red first (PROGRAMME section 12): the four defects of the old supersede path.
  it(
    'refuses the same document as its own replacement',
    async () => {
      const doc = await addDocument(db, owner, 'passport.pdf');
      const replaced = await replaceDocument(await manage(db, owner), {
        oldDocumentId: doc,
        newDocumentId: doc,
      });
      expect(replaced.ok).toBe(false);
      if (!replaced.ok) expect(replaced.error.code).toBe('invalid');
      const legacy = await supersedeDocument(db, {
        actorAccountId: owner.accountId,
        oldDocumentId: doc,
        newDocumentId: doc,
      });
      expect(legacy.ok).toBe(false);
      expect(await replacedBy(db, doc)).toBeNull();
    },
    HEAVY,
  );

  it(
    'refuses a loop: the newer document already replaced, or replaced by the old one',
    async () => {
      const a = await addDocument(db, owner, 'a.pdf');
      const b = await addDocument(db, owner, 'b.pdf');
      const c = await addDocument(db, owner, 'c.pdf');
      const proof = await manage(db, owner);
      expect((await replaceDocument(proof, { oldDocumentId: a, newDocumentId: b })).ok).toBe(true);
      // b replacing back with a: a was replaced by b, so this would close a circle.
      const back = await replaceDocument(proof, { oldDocumentId: b, newDocumentId: a });
      expect(back.ok).toBe(false);
      if (!back.ok) expect(back.error.code).toBe('invalid');
      // c replaced by a (already replaced): pointing at an outdated document.
      const stale = await replaceDocument(proof, { oldDocumentId: c, newDocumentId: a });
      expect(stale.ok).toBe(false);
      const legacyBack = await supersedeDocument(db, {
        actorAccountId: owner.accountId,
        oldDocumentId: b,
        newDocumentId: a,
      });
      expect(legacyBack.ok).toBe(false);
      expect(await replacedBy(db, b)).toBeNull();
      expect(await replacedBy(db, c)).toBeNull();
    },
    HEAVY,
  );

  it(
    'refuses a newer document that is not usable yet (not clean or not readable)',
    async () => {
      const old = await addDocument(db, owner, 'old.pdf');
      const pending = await addDocument(db, owner, 'pending.pdf', { ready: false });
      const versionless = await registerDocument(db, {
        actorAccountId: owner.accountId,
        applicantId: owner.applicantId,
        originalName: 'empty.pdf',
        docType: 'PASSPORT',
      });
      if (!isOk(versionless)) throw new Error('versionless');
      const proof = await manage(db, owner);
      for (const newer of [pending, versionless.value.id]) {
        const refused = await replaceDocument(proof, { oldDocumentId: old, newDocumentId: newer });
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.error.code).toBe('invalid');
      }
      expect(await replacedBy(db, old)).toBeNull();
    },
    HEAVY,
  );

  it(
    'refuses an already-replaced document, and only one of two replacements at once wins',
    async () => {
      const old = await addDocument(db, owner, 'old.pdf');
      const one = await addDocument(db, owner, 'one.pdf');
      const two = await addDocument(db, owner, 'two.pdf');
      const proof = await manage(db, owner);
      const attempts = await Promise.all([
        replaceDocument(proof, { oldDocumentId: old, newDocumentId: one }),
        replaceDocument(proof, { oldDocumentId: old, newDocumentId: two }),
      ]);
      expect(attempts.filter((r) => r.ok)).toHaveLength(1);
      const again = await replaceDocument(proof, { oldDocumentId: old, newDocumentId: two });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe('invalid');
    },
    HEAVY,
  );

  it(
    'refuses a document of another kind',
    async () => {
      const old = await addDocument(db, owner, 'passport.pdf');
      const other = await addDocument(db, owner, 'bank.pdf', { docType: 'bank_statement' });
      const refused = await replaceDocument(await manage(db, owner), {
        oldDocumentId: old,
        newDocumentId: other,
      });
      expect(refused.ok).toBe(false);
    },
    HEAVY,
  );

  it(
    'same person only: a stranger, an agency and a guessed id are refused',
    async () => {
      const old = await addDocument(db, owner, 'old.pdf');
      const newer = await addDocument(db, owner, 'new.pdf');
      const stranger = await seedOwner(db, 'replace-stranger@example.com');
      const theirs = await addDocument(db, stranger, 'theirs.pdf');

      // A stranger's own proof covers only their own record: our documents are not found.
      const strangerProof = await manage(db, stranger);
      const byStranger = await replaceDocument(strangerProof, {
        oldDocumentId: old,
        newDocumentId: newer,
      });
      expect(byStranger.ok).toBe(false);
      if (!byStranger.ok) expect(byStranger.error.code).toBe('not_found');
      // Mixing two people's documents is refused either way round.
      const proof = await manage(db, owner);
      expect((await replaceDocument(proof, { oldDocumentId: old, newDocumentId: theirs })).ok).toBe(
        false,
      );
      expect(
        (await replaceDocument(strangerProof, { oldDocumentId: theirs, newDocumentId: newer })).ok,
      ).toBe(false);
      // A guessed id.
      const guessed = await replaceDocument(proof, {
        oldDocumentId: old,
        newDocumentId: '00000000-0000-4000-8000-000000000000',
      });
      expect(guessed.ok).toBe(false);
      if (!guessed.ok) expect(guessed.error.code).toBe('not_found');
      expect(
        (await replaceDocument(proof, { oldDocumentId: 'not-an-id', newDocumentId: newer })).ok,
      ).toBe(false);

      // An agency with a MANAGE grant on the record holds a genuine MANAGE proof, and is
      // still refused: only the record owner replaces.
      const agent = await provisionAccount(db, { email: 'replace-agent@example.com' });
      if (!isOk(agent)) throw new Error('agent');
      const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
      if (!isOk(org)) throw new Error('org');
      const admin = await provisionAccount(db, { email: 'replace-admin@example.com' });
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
        actions: ['MANAGE'],
        purpose: 'review',
      });
      if (!isOk(grant)) throw new Error(`grant: ${grant.error.code}`);
      await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });
      const agencyProof = await requireAccess(
        db,
        accountPrincipal(agent.value.id),
        'MANAGE',
        { applicantId: owner.applicantId },
        { purpose: 'review' },
      );
      expect(isOk(agencyProof)).toBe(true);
      if (!isOk(agencyProof)) return;
      expect(agencyProof.value.actor.kind).toBe('organization_member');
      const byAgency = await replaceDocument(agencyProof.value, {
        oldDocumentId: old,
        newDocumentId: newer,
      });
      expect(byAgency.ok).toBe(false);
      if (!byAgency.ok) expect(byAgency.error.code).toBe('forbidden');
      const agencyOptions = await listReplacementOptions(agencyProof.value, { oldDocumentId: old });
      expect(agencyOptions.ok).toBe(false);

      // A read-level proof dressed as MANAGE is refused at run time.
      const reading = await requireAccess(
        db,
        accountPrincipal(owner.accountId),
        'VIEW_METADATA',
        { applicantId: owner.applicantId },
        { purpose: 'self' },
      );
      if (!isOk(reading)) throw new Error('reading');
      const byReading = await replaceDocument(
        reading.value as unknown as AuthorizedApplicant<'MANAGE'>,
        { oldDocumentId: old, newDocumentId: newer },
      );
      expect(byReading.ok).toBe(false);
      expect(await replacedBy(db, old)).toBeNull();
    },
    HEAVY,
  );

  it(
    'flags every case using the old document, bumps its revision, keeps snapshots exact',
    async () => {
      const old = await addDocument(db, owner, 'passport-old.pdf');
      const newer = await addDocument(db, owner, 'passport-new.pdf');
      const first = await caseUsing(db, owner, old, 'Japan Visit');
      const second = await caseUsing(db, owner, old, 'UK Visit');
      const snapshot = await snapshotMission(db, {
        actorAccountId: owner.accountId,
        missionId: first,
      });
      if (!isOk(snapshot)) throw new Error('snapshot');
      const acknowledged = await decideAcknowledgement(db, {
        actorAccountId: owner.accountId,
        missionId: first,
        snapshotId: snapshot.value.id,
        expectedSnapshotChecksum: snapshot.value.checksum,
        decision: 'ACKNOWLEDGED',
        stepUpSatisfied: true,
      });
      expect(isOk(acknowledged)).toBe(true);
      const snapshotsBefore = await db
        .select()
        .from(schema.missionSnapshots)
        .orderBy(schema.missionSnapshots.id);
      const revisions = async () =>
        new Map(
          (
            await db
              .select({ id: schema.missions.id, revision: schema.missions.materialRevision })
              .from(schema.missions)
          ).map((row) => [row.id, row.revision]),
        );
      const revisionsBefore = await revisions();

      const proof = await manage(db, owner);
      const options = await listReplacementOptions(proof, { oldDocumentId: old });
      expect(isOk(options)).toBe(true);
      if (isOk(options)) {
        expect(options.value.cases.map((c) => c.title)).toEqual(['Japan Visit', 'UK Visit']);
        expect(options.value.candidates.map((c) => [c.documentId, c.ready])).toEqual([
          [newer, true],
        ]);
      }

      const replaced = await replaceDocument(proof, { oldDocumentId: old, newDocumentId: newer });
      expect(isOk(replaced)).toBe(true);
      if (!isOk(replaced)) return;
      expect(new Set(replaced.value.flaggedMissionIds)).toEqual(new Set([first, second]));
      const revisionsAfter = await revisions();
      for (const id of [first, second]) {
        expect(revisionsAfter.get(id)).toBe((revisionsBefore.get(id) ?? 0) + 1);
      }
      expect(await getLiveAcknowledgement(db, first)).toBeUndefined();
      // Snapshots byte-identical.
      const snapshotsAfter = await db
        .select()
        .from(schema.missionSnapshots)
        .orderBy(schema.missionSnapshots.id);
      expect(JSON.stringify(snapshotsAfter)).toBe(JSON.stringify(snapshotsBefore));
      // The old document is untouched apart from its forward link.
      expect(await replacedBy(db, old)).toBe(newer);

      const tasks = await listTasks(db, owner.accountId, first);
      if (!isOk(tasks)) throw new Error('tasks');
      expect(tasks.value).toHaveLength(1);
      expect(tasks.value[0]?.description).toContain('passport-old.pdf');
      expect(tasks.value[0]?.description).not.toMatch(/supersed/i);

      // Audit and product event.
      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, 'DOCUMENT_SUPERSEDED'),
            eq(schema.auditEvents.resourceId, old),
          ),
        );
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0]?.metadata)).not.toContain('passport');
      const events = await db
        .select()
        .from(schema.productEvents)
        .where(eq(schema.productEvents.eventType, 'DOCUMENT_REPLACED'));
      expect(events).toHaveLength(1);

      // PROGRAMME section 12: an open replacement task does not block confirming the case again.
      const fresh = await snapshotMission(db, {
        actorAccountId: owner.accountId,
        missionId: first,
      });
      if (!isOk(fresh)) throw new Error('fresh snapshot');
      const again = await decideAcknowledgement(db, {
        actorAccountId: owner.accountId,
        missionId: first,
        snapshotId: fresh.value.id,
        expectedSnapshotChecksum: fresh.value.checksum,
        decision: 'ACKNOWLEDGED',
        stepUpSatisfied: true,
      });
      expect(isOk(again)).toBe(true);
      const stillOpen = await listTasks(db, owner.accountId, first);
      if (isOk(stillOpen)) expect(stillOpen.value[0]?.status).toBe('OPEN');
    },
    HEAVY,
  );

  it(
    'lists only same-kind documents of the same person, newest first, with readiness',
    async () => {
      const old = await addDocument(db, owner, 'old.pdf');
      const pending = await addDocument(db, owner, 'pending.pdf', { ready: false });
      await addDocument(db, owner, 'bank.pdf', { docType: 'bank_statement' });
      const stranger = await seedOwner(db, 'replace-other@example.com');
      await addDocument(db, stranger, 'theirs.pdf');
      const options = await listReplacementOptions(await manage(db, owner), { oldDocumentId: old });
      expect(isOk(options)).toBe(true);
      if (isOk(options)) {
        expect(options.value.docType).toBe('PASSPORT');
        expect(options.value.candidates.map((c) => [c.documentId, c.ready])).toEqual([
          [pending, false],
        ]);
        expect(options.value.cases).toEqual([]);
      }
    },
    HEAVY,
  );
});

describe('replaceDocument and the lifecycle state', () => {
  it(
    'refuses an archived or deleted document on either side',
    async () => {
      const db = await freshDb();
      const owner = await seedOwner(db, 'replace-state@example.com');
      const old = await addDocument(db, owner, 'old.pdf');
      const archived = await addDocument(db, owner, 'archived.pdf');
      const deleted = await addDocument(db, owner, 'deleted.pdf');
      const newer = await addDocument(db, owner, 'newer.pdf');
      const now = new Date();
      await db.insert(schema.documentLifecycle).values([
        { documentId: archived, applicantId: owner.applicantId, archivedAt: now },
        {
          documentId: deleted,
          applicantId: owner.applicantId,
          deletedAt: now,
          deletePath: 'DUPLICATE',
          purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
        },
      ]);
      const proof = await manage(db, owner);
      for (const [oldDocumentId, newDocumentId] of [
        [old, archived],
        [old, deleted],
        [archived, newer],
        [deleted, newer],
      ] as const) {
        const refused = await replaceDocument(proof, { oldDocumentId, newDocumentId });
        expect(refused.ok).toBe(false);
      }
      const options = await listReplacementOptions(proof, { oldDocumentId: old });
      if (!isOk(options)) throw new Error('options');
      expect(options.value.candidates.map((c) => c.documentId)).toEqual([newer]);
      expect((await replaceDocument(proof, { oldDocumentId: old, newDocumentId: newer })).ok).toBe(
        true,
      );
    },
    HEAVY,
  );
});

describe('documentLifecycleLabel', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const base = { state: 'CURRENT', replaced: false, deletedAt: null } as const;

  it('says nothing for a current document', () => {
    expect(documentLifecycleLabel(base, now)).toBeNull();
  });
  it('says Replaced on a date, with the year only when it is another year', () => {
    expect(
      documentLifecycleLabel(
        { ...base, replaced: true, replacedAt: new Date('2026-11-03T08:00:00Z') },
        now,
      ),
    ).toBe('Replaced on 3 Nov');
    expect(
      documentLifecycleLabel(
        { ...base, replaced: true, replacedAt: new Date('2025-02-09T08:00:00Z') },
        now,
      ),
    ).toBe('Replaced on 9 Feb 2025');
    expect(documentLifecycleLabel({ ...base, replaced: true }, now)).toBe('Replaced');
  });
  it('says Archived', () => {
    expect(documentLifecycleLabel({ ...base, state: 'ARCHIVED' }, now)).toBe('Archived');
  });
  it('says Removed by the traveller on a date, never a title', () => {
    for (const state of ['RECENTLY_DELETED', 'REMOVING'] as const) {
      expect(
        documentLifecycleLabel(
          { state, replaced: true, deletedAt: new Date('2026-10-20T08:00:00Z') },
          now,
        ),
      ).toBe('Removed by the traveller on 20 Oct');
    }
  });
});
