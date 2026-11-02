/**
 * UMPE P11 (S06, S07): Suggest a Checklist Correction, and what a newly published checklist
 * version means for work already under way. Synthetic data only. Pins:
 * 1. A suggestion never changes a pack: rows, status and checksum stay exactly as they were.
 * 2. Only the case owner suggests on a case, only for an item of the case's own checklist; an agency
 *    only on the official checklist one of its own requests follows.
 * 3. The editors' queue and decisions need pack management rights; decisions record only.
 * 4. The limit refuses an eleventh suggestion within the hour; an open duplicate is stored once.
 * 5. Publishing flags only ACTIVE cases pinned to an older version, with one precise item, and one
 *    note pair each; closed, cancelled, submitted and purged cases are left alone.
 * 6. A handoff snapshot and an issued agency revision are never rewritten.
 * 7. The send-time recheck drops a note whose case moved on, and a newer publication supersedes.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { type AgencyCollectionScope, agencyCollectionPrincipal } from './access/collection-scope';
import { staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { attachPackVersion, createMission, snapshotMission } from './missions';
import { RULE_CHANGED_EVENT, runNotificationWorker } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
  verifyPackChecksum,
} from './packs';
import { grantPlatformRole } from './platform-roles';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from './umpe-collection-request-switch';
import {
  cleanOfficialUrl,
  listChecklistCorrections,
  reviewChecklistCorrection,
  suggestAgencyChecklistCorrection,
  suggestCaseChecklistCorrection,
} from './umpe-correction-service';
import {
  assessRuleImpact,
  collectionRuleImpact,
  listRuleImpactRuns,
  preciseRuleChange,
  ruleChangeSentence,
  sweepRuleImpacts,
} from './umpe-rule-impact-service';

const TEST_TIMEOUT_MS = 90_000;
const SWEEP = systemScopeForTest('process-notification-sweeps');

const V1_ROWS: readonly RequirementInput[] = [
  { kind: 'DOCUMENT', docType: 'passport', citation: 'Synthetic rule 1' },
  { kind: 'DOCUMENT', docType: 'bank_statement', citation: 'Synthetic rule 2', optional: true },
];
const V2_ROWS: readonly RequirementInput[] = [
  ...V1_ROWS,
  { kind: 'DOCUMENT', docType: 'hotel_booking', citation: 'Synthetic rule 3' },
];

describe('UMPE P11: checklist corrections and rule change impact', () => {
  let client: PGlite;
  let db: Db;
  let editor: string;
  let editorEmail: string;
  let traveller: string;
  let applicantId: string;

  async function account(email: string): Promise<string> {
    const made = await provisionAccount(db, { email });
    if (!isOk(made)) throw new Error('provision');
    return made.value.id;
  }

  async function packScope(accountId = editor, email = editorEmail) {
    const minted = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: [] },
      'PACK_MANAGE',
    );
    if (!isOk(minted)) throw new Error('scope');
    return minted.value;
  }

  async function version(packId: string, rows: readonly RequirementInput[]): Promise<string> {
    const made = await addPackVersion(db, { actorAccountId: editor, packId });
    if (!isOk(made)) throw new Error('version');
    for (const row of rows) {
      const added = await addRequirement(db, {
        actorAccountId: editor,
        packVersionId: made.value.id,
        ...row,
      });
      if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
    }
    const approved = await approvePackVersion(db, {
      actorAccountId: editor,
      packVersionId: made.value.id,
    });
    if (!isOk(approved)) throw new Error(`approve: ${approved.error.message}`);
    const published = await publishPackVersion(db, {
      actorAccountId: editor,
      packVersionId: made.value.id,
    });
    if (!isOk(published)) throw new Error(`publish: ${published.error.message}`);
    return made.value.id;
  }

  async function pack(): Promise<string> {
    const made = await createPack(db, {
      actorAccountId: editor,
      key: `p11.${randomUUID()}`,
      name: 'P11 Synthetic Visit',
    });
    if (!isOk(made)) throw new Error('pack');
    return made.value.id;
  }

  async function caseOn(versionId: string, owner = traveller, person = applicantId) {
    const mission = await createMission(db, {
      actorAccountId: owner,
      applicantId: person,
      title: 'Synthetic Case',
    });
    if (!isOk(mission)) throw new Error('mission');
    const attached = await attachPackVersion(db, {
      actorAccountId: owner,
      missionId: mission.value.id,
      packVersionId: versionId,
    });
    if (!isOk(attached)) throw new Error('attach');
    return mission.value.id;
  }

  async function viewProof(missionId: string, actor = traveller) {
    const proof = await requireAccess(
      db,
      accountPrincipal(actor),
      'VIEW_METADATA',
      { missionId },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('view proof');
    return proof.value;
  }

  async function requirementId(versionId: string, docType: string): Promise<string> {
    const [row] = await db
      .select({ id: schema.packRequirements.id })
      .from(schema.packRequirements)
      .where(
        sql`${schema.packRequirements.packVersionId} = ${versionId} and ${schema.packRequirements.docType} = ${docType}`,
      );
    if (!row) throw new Error('requirement');
    return row.id;
  }

  /** Everything about a version that a suggestion must never change. */
  async function packState(versionId: string) {
    const [versionRow] = await db
      .select()
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, versionId));
    const rows = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, versionId))
      .orderBy(asc(schema.packRequirements.id));
    return JSON.stringify({ versionRow, rows });
  }

  beforeEach(async () => {
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    editorEmail = 'editor@platform.example.test';
    editor = await account(editorEmail);
    const granted = await grantPlatformRole(db, {
      actor: { accountId: editor, email: editorEmail, bootstrapEmails: [editorEmail] },
      targetAccountId: editor,
      role: 'PLATFORM_OWNER',
      reason: 'synthetic seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    traveller = await account('p11-traveller@example.com');
    await setConsent(db, {
      actorAccountId: traveller,
      accountId: traveller,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: traveller,
      ownerAccountId: traveller,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  describe('suggest a checklist correction', () => {
    it(
      'stores a cited suggestion and never changes the pack (rows, status and checksum)',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const missionId = await caseOn(v1);
        const passport = await requirementId(v1, 'passport');
        const before = await packState(v1);
        expect(await verifyPackChecksum(db, v1)).toBe(true);

        const made = await suggestCaseChecklistCorrection(await viewProof(missionId), {
          missionId,
          packRequirementId: passport,
          category: 'OUTDATED',
          officialUrl: 'https://www.gov.example/visit-visa ',
          detail: 'The page now says six months of validity.',
        });
        expect(made.ok).toBe(true);
        if (!made.ok) return;
        expect(made.value.duplicate).toBe(false);

        expect(await packState(v1)).toBe(before);
        expect(await verifyPackChecksum(db, v1)).toBe(true);

        const [stored] = await db
          .select()
          .from(schema.umpeChecklistCorrections)
          .where(eq(schema.umpeChecklistCorrections.id, made.value.id));
        expect(stored).toMatchObject({
          packId,
          packVersionId: v1,
          packRequirementId: passport,
          category: 'OUTDATED',
          officialUrl: 'https://www.gov.example/visit-visa',
          submitterKind: 'TRAVELLER',
          submittedByAccountId: traveller,
          status: 'RECEIVED',
        });

        // The audit record holds kinds only: never the detail or the link.
        const audits = await db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.eventType, 'CHECKLIST_CORRECTION_SUGGESTED'));
        expect(audits).toHaveLength(1);
        const text = JSON.stringify(audits[0]);
        expect(text).not.toContain('six months');
        expect(text).not.toContain('gov.example');

        // The editors' queue never names who sent it.
        const queue = await listChecklistCorrections(db, await packScope());
        expect(queue.ok).toBe(true);
        if (!queue.ok) return;
        expect(queue.value.open).toHaveLength(1);
        expect(queue.value.open[0]).toMatchObject({
          item: { kind: 'DOCUMENT', key: 'passport' },
          submitterKind: 'TRAVELLER',
          packName: 'P11 Synthetic Visit',
          version: 1,
        });
        expect(JSON.stringify(queue.value)).not.toContain(traveller);

        // Deciding records the decision only: Accept for Draft creates no version.
        const versionsBefore = await db.select().from(schema.packVersions);
        const decided = await reviewChecklistCorrection(db, await packScope(), {
          correctionId: made.value.id,
          decision: 'ACCEPTED_FOR_DRAFT',
          note: 'Write it in the next draft.',
        });
        expect(decided.ok).toBe(true);
        expect(await db.select().from(schema.packVersions)).toEqual(versionsBefore);
        expect(await packState(v1)).toBe(before);
        expect(await verifyPackChecksum(db, v1)).toBe(true);
        const again = await reviewChecklistCorrection(db, await packScope(), {
          correctionId: made.value.id,
          decision: 'DISMISSED',
        });
        expect(again.ok).toBe(false);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'refuses another person, an item outside the case checklist and unsafe links',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const otherPack = await pack();
        const foreign = await version(otherPack, V1_ROWS);
        const missionId = await caseOn(v1);
        const proof = await viewProof(missionId);

        const wrongItem = await suggestCaseChecklistCorrection(proof, {
          missionId,
          packRequirementId: await requirementId(foreign, 'passport'),
          category: 'WRONG',
        });
        expect(wrongItem.ok).toBe(false);
        if (!wrongItem.ok) expect(wrongItem.error.code).toBe('not_found');

        // Someone else's account cannot even get a proof for this case.
        const stranger = await account('stranger@example.com');
        const denied = await requireAccess(
          db,
          accountPrincipal(stranger),
          'VIEW_METADATA',
          { missionId },
          { purpose: 'self' },
        );
        expect(denied.ok).toBe(false);
        // A forged proof is refused at run time.
        const forged = await suggestCaseChecklistCorrection({ ...proof } as never, {
          missionId,
          packRequirementId: await requirementId(v1, 'passport'),
          category: 'WRONG',
        });
        expect(forged.ok).toBe(false);

        for (const url of [
          'http://www.gov.example/visa',
          'https://user:secret@www.gov.example/visa',
          'javascript:alert(1)',
          `https://www.gov.example/${String.fromCharCode(0x202e)}fdp.exe`,
          `https://www.gov.example/${'a'.repeat(2100)}`,
        ]) {
          const refused = await suggestCaseChecklistCorrection(proof, {
            missionId,
            packRequirementId: await requirementId(v1, 'passport'),
            category: 'SOURCE_DISCREPANCY',
            officialUrl: url,
          });
          expect(refused.ok, url).toBe(false);
        }
        expect(cleanOfficialUrl('https://WWW.Gov.example/a?b=1')).toBe(
          'https://www.gov.example/a?b=1',
        );
        expect(await db.select().from(schema.umpeChecklistCorrections)).toHaveLength(0);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'stores an open duplicate once and refuses beyond the limit',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const missionId = await caseOn(v1);
        const passport = await requirementId(v1, 'passport');
        const input = { missionId, packRequirementId: passport, category: 'MISSING' };
        const one = await suggestCaseChecklistCorrection(await viewProof(missionId), input);
        const two = await suggestCaseChecklistCorrection(await viewProof(missionId), input);
        expect(one.ok && two.ok).toBe(true);
        if (one.ok && two.ok) {
          expect(two.value).toEqual({ id: one.value.id, duplicate: true });
        }
        expect(await db.select().from(schema.umpeChecklistCorrections)).toHaveLength(1);

        await exhaustRateLimit(
          db,
          traveller,
          'checklist_correction.suggest',
          RATE_LIMITS.CHECKLIST_CORRECTION,
        );
        const limited = await suggestCaseChecklistCorrection(await viewProof(missionId), {
          ...input,
          category: 'WRONG',
        });
        expect(limited.ok).toBe(false);
        if (!limited.ok) expect(limited.error.code).toBe('rate_limited');
        expect(await db.select().from(schema.umpeChecklistCorrections)).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'needs pack management rights to read or decide the queue',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const missionId = await caseOn(v1);
        const made = await suggestCaseChecklistCorrection(await viewProof(missionId), {
          missionId,
          packRequirementId: null,
          category: 'MISSING',
          detail: 'A travel insurance letter is asked for at the counter.',
        });
        expect(made.ok).toBe(true);
        if (!made.ok) return;

        // An ordinary account cannot mint the scope at all.
        const plain = await staffPrincipal(
          db,
          { accountId: traveller, email: 'p11-traveller@example.com', bootstrapEmails: [] },
          'PACK_MANAGE',
        );
        expect(plain.ok).toBe(false);
        // A copied scope is refused at run time by both functions.
        const copy = { ...(await packScope()) } as never;
        expect((await listChecklistCorrections(db, copy)).ok).toBe(false);
        const refused = await reviewChecklistCorrection(db, copy, {
          correctionId: made.value.id,
          decision: 'DISMISSED',
        });
        expect(refused.ok).toBe(false);
        const [row] = await db.select().from(schema.umpeChecklistCorrections);
        expect(row?.status).toBe('RECEIVED');
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe('agency requests', () => {
    let orgId: string;
    let adminId: string;

    async function agencyScope(): Promise<AgencyCollectionScope> {
      const minted = await agencyCollectionPrincipal(db, adminId, orgId);
      if (!minted.ok) throw new Error('scope refused');
      return minted.value;
    }

    /** An issued request on `versionId`: one revision, written once (a trigger refuses edits). */
    async function issuedRequest(versionId: string, organizationId = orgId): Promise<string> {
      const [request] = await db
        .insert(schema.agencyCollectionRequests)
        .values({
          organizationId,
          createdByAccountId: adminId,
          status: 'SENT',
          destination: 'GB',
          draftPackVersionId: versionId,
        })
        .returning();
      if (!request) throw new Error('request');
      const [checksumRow] = await db
        .select({ checksum: schema.packVersions.checksum })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, versionId));
      await db.insert(schema.agencyCollectionRequestRevisions).values({
        requestId: request.id,
        revisionNo: 1,
        packVersionId: versionId,
        packChecksum: checksumRow?.checksum ?? 'x',
        items: [],
        contentSha256: createHash('sha256').update(request.id).digest('hex'),
        issuedByAccountId: adminId,
      });
      return request.id;
    }

    beforeEach(async () => {
      vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
      adminId = await account('admin@agency-p11.example.test');
      const org = await createOrganization(db, {
        actorAccountId: adminId,
        name: 'Synthetic Agency P11',
      });
      if (!isOk(org)) throw new Error('org');
      orgId = org.value.id;
      const reviewed = await reviewOrganization(db, {
        reviewerAccountId: editor,
        organizationId: orgId,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      if (!isOk(reviewed)) throw new Error('activate');
    }, 60_000);

    it(
      'suggests only on its own request, and a newer version leaves the issued revision as issued',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const requestId = await issuedRequest(v1);
        const revisionBefore = await db.select().from(schema.agencyCollectionRequestRevisions);

        const made = await suggestAgencyChecklistCorrection(db, await agencyScope(), {
          requestId,
          packRequirementId: await requirementId(v1, 'bank_statement'),
          category: 'WRONG_NECESSITY',
        });
        expect(made.ok).toBe(true);
        const [stored] = await db.select().from(schema.umpeChecklistCorrections);
        expect(stored).toMatchObject({ submitterKind: 'AGENCY', organizationId: orgId });

        // Another agency's request looks exactly like a missing one.
        const otherAdmin = await account('admin@agency-other.example.test');
        const other = await createOrganization(db, {
          actorAccountId: otherAdmin,
          name: 'Synthetic Agency Other',
        });
        if (!isOk(other)) throw new Error('org two');
        const foreignRequest = await issuedRequest(v1, other.value.id);
        const refused = await suggestAgencyChecklistCorrection(db, await agencyScope(), {
          requestId: foreignRequest,
          packRequirementId: null,
          category: 'MISSING',
        });
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.error.code).toBe('not_found');

        expect(await collectionRuleImpact(db, await agencyScope(), requestId)).toEqual({
          ok: true,
          value: null,
        });
        const v2 = await version(packId, V2_ROWS);
        const impact = await collectionRuleImpact(db, await agencyScope(), requestId);
        expect(impact.ok).toBe(true);
        if (!impact.ok) return;
        expect(impact.value).toMatchObject({
          pinnedVersion: 1,
          newerVersion: 2,
          newerPackVersionId: v2,
          issuedPinned: true,
          draftPinned: true,
          item: { changeKind: 'ADDED', itemKind: 'DOCUMENT', itemKey: 'hotel_booking' },
        });
        // Not visible to another agency, and the issued revision is untouched.
        const otherScope = await agencyCollectionPrincipal(db, otherAdmin, other.value.id);
        if (otherScope.ok) {
          expect(await collectionRuleImpact(db, otherScope.value, requestId)).toEqual({
            ok: true,
            value: null,
          });
        }
        expect(await db.select().from(schema.agencyCollectionRequestRevisions)).toEqual([
          ...revisionBefore,
          ...(await db
            .select()
            .from(schema.agencyCollectionRequestRevisions)
            .where(eq(schema.agencyCollectionRequestRevisions.requestId, foreignRequest))),
        ]);
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe('published rule change impact', () => {
    it(
      'flags only active cases on an older version, once, with one precise item and one note pair',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const active = await caseOn(v1);
        const cancelled = await caseOn(v1);
        const submitted = await caseOn(v1);
        const purged = await caseOn(v1);
        await db
          .update(schema.missions)
          .set({ state: 'CANCELLED' })
          .where(eq(schema.missions.id, cancelled));
        await db
          .update(schema.missions)
          .set({ state: 'SUBMITTED' })
          .where(eq(schema.missions.id, submitted));
        await db
          .update(schema.missions)
          .set({ purgedAt: new Date() })
          .where(eq(schema.missions.id, purged));
        const snapshot = await snapshotMission(db, {
          actorAccountId: traveller,
          missionId: active,
        });
        if (!isOk(snapshot)) throw new Error('snapshot');
        const snapshotsBefore = await db.select().from(schema.missionSnapshots);
        const missionsBefore = await db
          .select()
          .from(schema.missions)
          .orderBy(asc(schema.missions.id));

        const v2 = await version(packId, V2_ROWS);
        // Publishing only queued the assessment.
        expect(await db.select().from(schema.umpeRuleImpacts)).toHaveLength(0);
        const [run] = await db
          .select()
          .from(schema.umpeRuleImpactRuns)
          .where(eq(schema.umpeRuleImpactRuns.packVersionId, v2));
        expect(run).toMatchObject({ packVersionId: v2, assessedAt: null });

        const assessed = await assessRuleImpact(db, await packScope(), { packVersionId: v2 });
        expect(assessed).toEqual({
          ok: true,
          value: { runs: 1, casesFlagged: 1, notesQueued: 1, more: false },
        });
        const impacts = await db.select().from(schema.umpeRuleImpacts);
        expect(impacts).toHaveLength(1);
        expect(impacts[0]).toMatchObject({
          missionId: active,
          previousPackVersionId: v1,
          packVersionId: v2,
          changeKind: 'ADDED',
          itemKind: 'DOCUMENT',
          itemKey: 'hotel_booking',
          changedCount: 1,
        });
        const notes = await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.eventType, RULE_CHANGED_EVENT));
        expect(notes.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
        expect(
          notes.every((n) => n.missionId === active && n.recipientAccountId === traveller),
        ).toBe(true);
        expect(JSON.stringify(notes[0]?.payload)).toContain('Hotel Booking was added');

        // Nothing about any case was rewritten: same rows, same pins, same snapshots.
        expect(await db.select().from(schema.missions).orderBy(asc(schema.missions.id))).toEqual(
          missionsBefore,
        );
        expect(await db.select().from(schema.missionSnapshots)).toEqual(snapshotsBefore);

        // Running again (the sweep, or a second click) flags and notifies nothing new.
        expect(await assessRuleImpact(db, await packScope(), { packVersionId: v2 })).toEqual({
          ok: true,
          value: { runs: 1, casesFlagged: 0, notesQueued: 0, more: false },
        });
        // (version 1's own run has no older version, so it flags nothing either)
        expect(await sweepRuleImpacts(SWEEP, db)).toMatchObject({
          casesFlagged: 0,
          notesQueued: 0,
          more: false,
        });
        const runs = await listRuleImpactRuns(db, await packScope());
        expect(runs.ok && runs.value[0]).toMatchObject({
          casesFlagged: 1,
          notesQueued: 1,
          stillOpen: 1,
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'needs a genuine staff or scheduled scope, and the sweep finishes what nobody assessed',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        await caseOn(v1);
        const v2 = await version(packId, V2_ROWS);
        const copy = { ...(await packScope()) } as never;
        expect((await assessRuleImpact(db, copy, { packVersionId: v2 })).ok).toBe(false);
        expect(await sweepRuleImpacts({ ...SWEEP } as never, db)).toMatchObject({ runs: 0 });
        expect(await db.select().from(schema.umpeRuleImpacts)).toHaveLength(0);

        const swept = await sweepRuleImpacts(SWEEP, db);
        // Both publications' runs were waiting; only version 2 has an older version to compare.
        expect(swept).toEqual({ runs: 2, casesFlagged: 1, notesQueued: 1, more: false });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'drops a note whose case moved on, and a newer publication supersedes the open impact',
      async () => {
        const packId = await pack();
        const v1 = await version(packId, V1_ROWS);
        const first = await caseOn(v1);
        const second = await caseOn(v1);
        const v2 = await version(packId, V2_ROWS);
        await assessRuleImpact(db, await packScope(), { packVersionId: v2 });

        // The first case is closed before its note goes out: the worker cancels both channels.
        await db
          .update(schema.missions)
          .set({ state: 'CLOSED' })
          .where(eq(schema.missions.id, first));
        const sent: string[] = [];
        const emailPort = {
          send: async (m: { to: string }) => {
            sent.push(m.to);
            return { providerMessageId: randomUUID() };
          },
        } as never;
        await runNotificationWorker(db, emailPort, 'https://app.example.test');
        const byMission = async (missionId: string) =>
          (
            await db
              .select()
              .from(schema.notifications)
              .where(eq(schema.notifications.missionId, missionId))
          )
            .filter((n) => n.eventType === RULE_CHANGED_EVENT)
            .map((n) => n.status)
            .sort();
        expect(await byMission(first)).toEqual(['CANCELLED', 'CANCELLED']);
        expect(await byMission(second)).toEqual(['SENT', 'SENT']);
        expect(sent.filter((to) => to === 'p11-traveller@example.com')).toHaveLength(1);

        // Version 3 supersedes version 2's open impact; the case gets one current item.
        const v3 = await version(packId, [
          ...V2_ROWS,
          { kind: 'FIELD', fieldKey: 'occupation', citation: 'Synthetic rule 4' },
        ]);
        await assessRuleImpact(db, await packScope(), { packVersionId: v3 });
        const open = await db
          .select()
          .from(schema.umpeRuleImpacts)
          .where(eq(schema.umpeRuleImpacts.missionId, second));
        const byVersion = new Map(open.map((row) => [row.packVersionId, row]));
        expect(byVersion.get(v2)?.resolution).toBe('SUPERSEDED');
        expect(byVersion.get(v3)).toMatchObject({
          resolution: null,
          changeKind: 'ADDED',
          itemKey: 'hotel_booking',
          changedCount: 2,
        });
      },
      TEST_TIMEOUT_MS,
    );
  });

  it('picks the most important difference and words it plainly', () => {
    const entry = (key: string, change: 'added' | 'changed' | 'removed' | 'unchanged') => ({
      key,
      kind: key.startsWith('FIELD:') ? ('FIELD' as const) : ('DOCUMENT' as const),
      change,
      from: null,
      to: null,
      changedFields: [],
    });
    const item = preciseRuleChange([
      entry('DOCUMENT:passport', 'changed'),
      entry('DOCUMENT:visa_photo', 'removed'),
      entry('DOCUMENT:bank_statement', 'unchanged'),
    ]);
    expect(item).toEqual({
      changeKind: 'CHANGED',
      itemKind: 'DOCUMENT',
      itemKey: 'passport',
      changedCount: 2,
    });
    expect(ruleChangeSentence(item)).toBe(
      'Passport changed in the checklist for one of your trips (and 1 other change).',
    );
    expect(preciseRuleChange([entry('DOCUMENT:passport', 'unchanged')]).changeKind).toBe('NONE');
    const dash = String.fromCharCode(0x2014);
    expect(ruleChangeSentence(item)).not.toContain(dash);
  });
});
