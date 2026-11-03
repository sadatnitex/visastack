/**
 * Journey J3 (ongoing update), services layer, on a real migrated in-memory database.
 *
 * Covered: after a confirmed handoff, a corrected scan (a new version of the same passport), a
 * newer bank statement, a passport that will expire before the trip ends and a published rule
 * revision each reach only the ACTIVE packages they affect; each change gives one explanation
 * (one open change per case and one note pair, one rule note pair per publication, the package
 * leaving a newer publication to the rule note); every confirmed handoff snapshot is preserved
 * byte for byte, a newer copy is only a proposal, and the database refuses an edit of a handoff.
 *
 * Not covered here: a resolved fact conflict changing a package (no service path ties a conflict
 * decision to a package change in this layer; reported, not faked).
 *
 * Not exercisable below the browser (reported, not faked): real sign-in, real email delivery (a
 * recording stand-in answers), and the live deployment. A document's expiry date is set with a
 * direct row update because no service sets it outside an approved reading.
 *
 * Synthetic people and documents only. Sweeps run with fixed `now` values.
 */
import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { staffPrincipal } from '../access/principal';
import { systemScopeForTest } from '../access/system-scope.test-support';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { addDocumentVersion, registerDocument, setDocumentDate } from '../documents';
import { attachPackVersion, createMission, transitionMission } from '../missions';
import { caseExpiryConflicts } from '../notification-sweep';
import { PACKAGE_CHANGED_EVENT, RULE_CHANGED_EVENT, runNotificationWorker } from '../notifications';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../packs';
import { grantPlatformRole } from '../platform-roles';
import {
  confirmPackageHandoff,
  getCasePackage,
  listPackageHandoffs,
  recordPackageChoice,
  sweepPackageChanges,
} from '../umpe-package-service';
import { assessRuleImpact } from '../umpe-rule-impact-service';

const TIMEOUT = 120_000;
const EDITOR_EMAIL = 'j3-editor@platform.example.test';
const TRAVELLER_EMAIL = 'j3-traveller@example.invalid';
const SWEEP = systemScopeForTest('process-notification-sweeps');

const PASSPORT: RequirementInput = { kind: 'DOCUMENT', docType: 'passport', citation: 'Rule 1' };
const BANK: RequirementInput = { kind: 'DOCUMENT', docType: 'bank_statement', citation: 'Rule 2' };
const HOTEL: RequirementInput = { kind: 'DOCUMENT', docType: 'hotel_booking', citation: 'Rule 3' };
const INSURANCE: RequirementInput = {
  kind: 'DOCUMENT',
  docType: 'travel_insurance',
  citation: 'Rule 4',
};

describe('J3 ongoing update', () => {
  let db: Db;
  let editor: string;
  let traveller: string;
  let anna: string;
  let visitPack: string;
  let visitV1: string;
  let hotelV1: string;
  /** The case with a confirmed handoff: the one every update should reach. */
  let active: string;
  /** Another active case whose checklist uses none of the changed documents. */
  let unrelated: string;
  /** A cancelled case on the same checklist: never recalculated. */
  let cancelled: string;
  let passportDoc: string;
  let bankDoc: string;
  let handoffId: string;
  let handoffRowsAtConfirm: unknown;
  const sent: string[] = [];
  const emailPort = {
    send: async (message: { to: string }) => {
      sent.push(message.to);
      return { providerMessageId: randomUUID() };
    },
  } as never;

  async function caseProof(missionId: string, action: 'MANAGE' | 'VIEW_METADATA') {
    const proof = await requireAccess(
      db,
      accountPrincipal(traveller),
      action,
      { missionId },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('case proof');
    return proof.value as never;
  }
  async function pkg(missionId: string) {
    const result = await getCasePackage(await caseProof(missionId, 'VIEW_METADATA'), missionId);
    if (!isOk(result)) throw new Error(`package: ${result.error.message}`);
    return result.value;
  }
  async function packScope() {
    const minted = await staffPrincipal(
      db,
      { accountId: editor, email: EDITOR_EMAIL, bootstrapEmails: [] },
      'PACK_MANAGE',
    );
    if (!isOk(minted)) throw new Error('scope');
    return minted.value;
  }
  async function publishedVersion(packId: string, rows: readonly RequirementInput[]) {
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
  async function newPack(name: string) {
    const made = await createPack(db, {
      actorAccountId: editor,
      key: `j3.${randomUUID()}`,
      name,
    });
    if (!isOk(made)) throw new Error('pack');
    return made.value.id;
  }
  async function caseOn(versionId: string, travelEnd?: Date) {
    const mission = await createMission(db, {
      actorAccountId: traveller,
      applicantId: anna,
      title: 'Synthetic Case',
      ...(travelEnd ? { travelEndDate: travelEnd } : {}),
    });
    if (!isOk(mission)) throw new Error('mission');
    const attached = await attachPackVersion(db, {
      actorAccountId: traveller,
      missionId: mission.value.id,
      packVersionId: versionId,
    });
    if (!isOk(attached)) throw new Error('attach');
    return mission.value.id;
  }
  async function document(docType: string, date: string | null = null) {
    const doc = await registerDocument(db, {
      actorAccountId: traveller,
      applicantId: anna,
      originalName: `${docType}.pdf`,
      docType,
    });
    if (!isOk(doc)) throw new Error('doc');
    await newVersion(doc.value.id);
    if (date) {
      const dated = await setDocumentDate(db, {
        actorAccountId: traveller,
        documentId: doc.value.id,
        documentDate: date,
      });
      if (!isOk(dated)) throw new Error('date');
    }
    return doc.value.id;
  }
  async function newVersion(documentId: string) {
    const version = await addDocumentVersion(db, {
      actorAccountId: traveller,
      documentId,
      bucket: 'CLEAN',
      objectKey: `j3-${randomUUID()}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    return version.value.version.id;
  }
  async function pinEverything(missionId: string) {
    for (const item of (await pkg(missionId)).items) {
      if (!item.proposed?.documentVersionId) continue;
      const chose = await recordPackageChoice(await caseProof(missionId, 'MANAGE'), {
        missionId,
        packRequirementId: item.packRequirementId,
        choice: 'USE_COPY',
        documentVersionId: item.proposed.documentVersionId,
      });
      if (!isOk(chose)) throw new Error(`choose: ${chose.error.message}`);
    }
  }
  const handoffRows = () =>
    db.select().from(schema.umpePackageHandoffs).orderBy(asc(schema.umpePackageHandoffs.id));
  const changesFor = async (missionId: string) =>
    db
      .select()
      .from(schema.umpePackageChanges)
      .where(eq(schema.umpePackageChanges.missionId, missionId));
  const notesOf = async (eventType: string) =>
    db.select().from(schema.notifications).where(eq(schema.notifications.eventType, eventType));

  beforeAll(async () => {
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const editorAccount = await provisionAccount(db, { email: EDITOR_EMAIL });
    if (!isOk(editorAccount)) throw new Error('provision editor');
    editor = editorAccount.value.id;
    const granted = await grantPlatformRole(db, {
      actor: { accountId: editor, email: EDITOR_EMAIL, bootstrapEmails: [EDITOR_EMAIL] },
      targetAccountId: editor,
      role: 'PLATFORM_OWNER',
      reason: 'synthetic seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    const travellerAccount = await provisionAccount(db, { email: TRAVELLER_EMAIL });
    if (!isOk(travellerAccount)) throw new Error('provision traveller');
    traveller = travellerAccount.value.id;
    await setConsent(db, {
      actorAccountId: traveller,
      accountId: traveller,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: traveller,
      ownerAccountId: traveller,
      displayName: 'Synthetic Anna',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    anna = applicant.value.id;

    visitPack = await newPack('J3 Synthetic Visit');
    visitV1 = await publishedVersion(visitPack, [PASSPORT, BANK]);
    hotelV1 = await publishedVersion(await newPack('J3 Synthetic Stay'), [HOTEL]);
    passportDoc = await document('passport');
    bankDoc = await document('bank_statement', '2026-09-30');
    await document('hotel_booking');
    active = await caseOn(visitV1, new Date('2027-03-20T00:00:00Z'));
    unrelated = await caseOn(hotelV1);
    cancelled = await caseOn(visitV1);
    for (const missionId of [active, unrelated, cancelled]) await pinEverything(missionId);
    const confirmed = await confirmPackageHandoff(await caseProof(active, 'MANAGE'), {
      missionId: active,
      outsideStepsSeen: true,
    });
    if (!isOk(confirmed)) throw new Error(`handoff: ${confirmed.error.message}`);
    handoffId = confirmed.value.handoffId;
    const gone = await transitionMission(db, {
      actorAccountId: traveller,
      missionId: cancelled,
      to: 'CANCELLED',
    });
    if (!isOk(gone)) throw new Error('cancel');
    handoffRowsAtConfirm = await handoffRows();
    // Everything recorded so far is settled, so later counts are about the updates only.
    const settle = await sweepPackageChanges(SWEEP, db, { now: new Date('2026-11-03T08:00:00Z') });
    expect(settle.recorded).toBe(0);
  }, TIMEOUT);

  it(
    'step 1: a corrected scan of the passport reaches only the active case that uses it',
    async () => {
      const rescan = await newVersion(passportDoc);
      const swept = await sweepPackageChanges(SWEEP, db, { now: new Date('2026-11-03T09:00:00Z') });
      expect(swept.recorded).toBe(1);
      expect((await changesFor(active)).map((c) => c.source)).toEqual(['SWEEP']);
      expect(await changesFor(unrelated)).toEqual([]);
      expect(await changesFor(cancelled)).toEqual([]);
      const after = await pkg(active);
      const passport = after.items.find((i) => i.key === 'passport');
      // A proposal only: the chosen copy stays the one handed off.
      expect(passport?.newerCopy?.documentVersionId).toBe(rescan);
      expect(passport?.chosen?.copy?.documentVersionId).not.toBe(rescan);
      expect(after.change?.kind).toBe('NEWER_DOCUMENT');
      expect(after.latestHandoff?.current).toBe(false);
      // One explanation: one pair of notes for this change, on the active case only.
      const notes = await notesOf(PACKAGE_CHANGED_EVENT);
      expect(notes.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
      expect(notes.every((n) => n.missionId === active)).toBe(true);
      // The same situation swept again records and sends nothing more.
      const again = await sweepPackageChanges(SWEEP, db, { now: new Date('2026-11-03T10:00:00Z') });
      expect(again.recorded).toBe(0);
      expect(await notesOf(PACKAGE_CHANGED_EVENT)).toHaveLength(2);
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );

  it(
    'step 2: a newer bank statement is one current change for the active case, never applied',
    async () => {
      const newer = await newVersion(bankDoc);
      const swept = await sweepPackageChanges(SWEEP, db, { now: new Date('2026-11-04T09:00:00Z') });
      expect(swept.recorded).toBe(1);
      expect(await changesFor(unrelated)).toEqual([]);
      expect(await changesFor(cancelled)).toEqual([]);
      const open = (await changesFor(active)).filter((c) => c.resolvedAt === null);
      expect(open).toHaveLength(1);
      const after = await pkg(active);
      const bank = after.items.find((i) => i.key === 'bank_statement');
      expect(bank?.newerCopy?.documentVersionId).toBe(newer);
      expect(bank?.chosen?.copy?.documentVersionId).not.toBe(newer);
      // The earlier note pair is replaced by one new pair, not stacked.
      const queued = (await notesOf(PACKAGE_CHANGED_EVENT)).filter((n) => n.status === 'QUEUED');
      expect(queued).toHaveLength(2);
      expect(queued.every((n) => n.missionId === active)).toBe(true);
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );

  it(
    'step 3: a passport expiring before the trip ends is flagged on the active case only',
    async () => {
      // No service sets an expiry outside an approved reading; set it on the row for the journey.
      await db
        .update(schema.documents)
        .set({ expiresAt: new Date('2027-03-01T00:00:00Z') })
        .where(eq(schema.documents.id, passportDoc));
      const found = await caseExpiryConflicts(await caseProof(active, 'VIEW_METADATA'));
      expect(found.map((f) => f.documentId)).toEqual([passportDoc]);
      expect(await caseExpiryConflicts(await caseProof(unrelated, 'VIEW_METADATA'))).toEqual([]);
      expect(await caseExpiryConflicts(await caseProof(cancelled, 'VIEW_METADATA'))).toEqual([]);
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );

  it(
    'step 4: a published rule revision flags only active cases on the older version, with one note pair',
    async () => {
      const casesBefore = await db.select().from(schema.missions).orderBy(asc(schema.missions.id));
      const visitV2 = await publishedVersion(visitPack, [PASSPORT, BANK, INSURANCE]);
      const assessed = await assessRuleImpact(db, await packScope(), { packVersionId: visitV2 });
      expect(assessed).toEqual({
        ok: true,
        value: { runs: 1, casesFlagged: 1, notesQueued: 1, more: false },
      });
      const impacts = await db.select().from(schema.umpeRuleImpacts);
      expect(impacts).toHaveLength(1);
      expect(impacts[0]).toMatchObject({
        missionId: active,
        previousPackVersionId: visitV1,
        packVersionId: visitV2,
        changeKind: 'ADDED',
        itemKey: 'travel_insurance',
      });
      const ruleNotes = await notesOf(RULE_CHANGED_EVENT);
      expect(ruleNotes.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
      expect(ruleNotes.every((n) => n.missionId === active)).toBe(true);
      // The package leaves the newer publication to that rule note: one explanation, not two.
      const after = await pkg(active);
      expect(after.freshness?.packReplaced).toBe(true);
      expect(after.change?.kind).not.toBe('PACK_CHANGED');
      // Assessing again flags and notifies nothing new; no case row or pin was rewritten.
      expect(await assessRuleImpact(db, await packScope(), { packVersionId: visitV2 })).toEqual({
        ok: true,
        value: { runs: 1, casesFlagged: 0, notesQueued: 0, more: false },
      });
      const casesAfter = await db.select().from(schema.missions).orderBy(asc(schema.missions.id));
      expect(casesAfter.map((m) => [m.id, m.packVersionId, m.state])).toEqual(
        casesBefore.map((m) => [m.id, m.packVersionId, m.state]),
      );
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );

  it(
    'step 5: the notes go out once each to the owner, and the handoff history is unchanged',
    async () => {
      await runNotificationWorker(db, emailPort, 'https://app.example.test');
      // To the traveller: one email for the open package change and one for the rule revision.
      // (The editor's own mail, from the role grant, is not part of this journey.)
      expect(sent.filter((to) => to === TRAVELLER_EMAIL)).toHaveLength(2);
      const delivered = [
        ...(await notesOf(PACKAGE_CHANGED_EVENT)),
        ...(await notesOf(RULE_CHANGED_EVENT)),
      ]
        .filter((n) => n.status === 'SENT')
        .map((n) => `${n.eventType}:${n.channel}`)
        .sort();
      expect(delivered).toEqual([
        `${PACKAGE_CHANGED_EVENT}:EMAIL`,
        `${PACKAGE_CHANGED_EVENT}:IN_APP`,
        `${RULE_CHANGED_EVENT}:EMAIL`,
        `${RULE_CHANGED_EVENT}:IN_APP`,
      ]);
      const history = await listPackageHandoffs(await caseProof(active, 'VIEW_METADATA'), active);
      expect(isOk(history) && history.value.map((h) => h.id)).toEqual([handoffId]);
      expect(isOk(history) && history.value[0]?.current).toBe(false);
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );

  it(
    'negative: the database refuses any edit or removal of a confirmed handoff snapshot',
    async () => {
      await expect(
        db.execute(
          sql`update umpe_package_handoffs set material_revision_at_capture = 999 where id = ${handoffId}`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(
          sql`update umpe_package_handoffs set content = '{}'::jsonb where id = ${handoffId}`,
        ),
      ).rejects.toThrow();
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );

  it(
    'negative: a second handoff while a pinned copy was replaced is refused, so no snapshot is rewritten',
    async () => {
      const refused = await confirmPackageHandoff(await caseProof(active, 'MANAGE'), {
        missionId: active,
        outsideStepsSeen: true,
      });
      expect(isErr(refused)).toBe(true);
      expect(await handoffRows()).toEqual(handoffRowsAtConfirm);
    },
    TIMEOUT,
  );
});
