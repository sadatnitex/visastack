import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AuthorizedApplicant, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import {
  CHECKLIST_EDITS_MAX,
  CHECKLIST_WORDING_MAX,
  listCaseChecklistEdits,
  setChecklistWording,
  tidyWording,
} from './case-checklist-edits';
import { setConsent } from './consent';
import type { Db } from './db';
import { attachPackVersion, computeReadiness, createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { listRequirements } from './packs';
import { acceptGrant, createGrant } from './sharing';

/** Synthetic data only. A traveller rewords items of their own case's checklist; nothing else moves. */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

describe('case checklist edits', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  let missionId: string;
  let versionId: string;
  let required: string;
  let optional: string;
  let n = 0;

  async function pack(extraItems = 0) {
    n += 1;
    const [row] = await db
      .insert(schema.packs)
      .values({ key: `synthetic.edits.${n}`, name: `Synthetic Pack ${n}`, authoritative: true })
      .returning();
    const [version] = await db
      .insert(schema.packVersions)
      .values({ packId: row?.id ?? '', version: 1, status: 'PUBLISHED' })
      .returning();
    const items = await db
      .insert(schema.packRequirements)
      .values([
        {
          packVersionId: version?.id ?? '',
          kind: 'DOCUMENT',
          docType: 'PASSPORT',
          citation: 'Synthetic rule',
          optional: false,
          necessity: 'MANDATORY',
          notes: 'Valid passport, six months.',
        },
        {
          packVersionId: version?.id ?? '',
          kind: 'DOCUMENT',
          docType: 'PHOTO',
          citation: 'Synthetic rule',
          optional: true,
          necessity: 'OPTIONAL',
        },
        ...Array.from({ length: extraItems }, (_, i) => ({
          packVersionId: version?.id ?? '',
          kind: 'DOCUMENT' as const,
          docType: `EXTRA_${i}`,
          citation: 'Synthetic rule',
          optional: true,
          necessity: 'OPTIONAL' as const,
        })),
      ])
      .returning();
    return { versionId: version?.id ?? '', items };
  }

  /** The proof for one case, as the case page and its actions ask for it. */
  async function ownerProof<A extends 'MANAGE' | 'VIEW_METADATA'>(
    action: A,
    accountId = actor,
    forCase = missionId,
  ): Promise<AuthorizedApplicant<A>> {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      action,
      { missionId: forCase },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error(`proof: ${proof.error.message}`);
    return proof.value;
  }

  async function newCase(title: string, packVersionId: string | null) {
    const made = await createMission(db, {
      actorAccountId: actor,
      applicantId,
      title,
      destination: 'United Kingdom',
      purpose: 'Tourism',
    });
    if (!isOk(made)) throw new Error('mission');
    if (packVersionId) {
      const attached = await attachPackVersion(db, {
        actorAccountId: actor,
        missionId: made.value.id,
        packVersionId,
      });
      if (!isOk(attached)) throw new Error(`attach: ${attached.error.message}`);
    }
    return made.value.id;
  }

  const set = async (item: string, wording: string, mission = missionId) =>
    setChecklistWording(await ownerProof('MANAGE', actor, mission), {
      missionId: mission,
      packRequirementId: item,
      wording,
    });
  const list = async (mission = missionId) => {
    const listed = await listCaseChecklistEdits(
      await ownerProof('VIEW_METADATA', actor, mission),
      mission,
    );
    if (!isOk(listed)) throw new Error(listed.error.message);
    return listed.value;
  };

  beforeEach(async () => {
    db = await freshDb();
    const account = await provisionAccount(db, { email: 'edits-owner@example.com' });
    if (!isOk(account)) throw new Error('provision');
    actor = account.value.id;
    await setConsent(db, {
      actorAccountId: actor,
      accountId: actor,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: actor,
      ownerAccountId: actor,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    const made = await pack();
    versionId = made.versionId;
    required = made.items.find((i) => i.docType === 'PASSPORT')?.id ?? '';
    optional = made.items.find((i) => i.docType === 'PHOTO')?.id ?? '';
    missionId = await newCase('Synthetic UK trip', versionId);
  });

  describe('saving and reading', () => {
    it('saves a sentence for an item and reads it back, and nothing else about the item changes', async () => {
      const before = await listRequirements(db, versionId);
      const saved = await set(optional, 'A recent photo of me');
      expect(isOk(saved) && saved.value.wording).toBe('A recent photo of me');
      expect((await list()).rewords).toEqual([
        { packRequirementId: optional, wording: 'A recent photo of me' },
      ]);
      expect(await listRequirements(db, versionId)).toEqual(before);
    });

    it('changes a saved sentence, and puts the original back when it is emptied', async () => {
      await set(required, 'Passport please');
      await set(required, 'Passport, nine months');
      expect((await list()).rewords[0]?.wording).toBe('Passport, nine months');
      await set(required, '   ');
      expect((await list()).rewords).toEqual([]);
    });

    it('treats a sentence of only hidden characters as empty, so a row title is never blank', async () => {
      expect(tidyWording('\u200b\u200b')).toBe('');
      expect(tidyWording('a\u202eb\ufeffc')).toBe('a b c');
      await set(required, 'Real words');
      await set(required, '\u200b\u200b');
      expect((await list()).rewords).toEqual([]);
    });

    it('says whether the words can be changed: open case with a checklist only', async () => {
      expect((await list()).editable).toBe(true);
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, missionId));
      expect((await list()).editable).toBe(false);
      const bare = await newCase('No checklist', null);
      expect((await list(bare)).editable).toBe(false);
    });

    it('tidies control characters and spacing, and refuses a sentence that is too long', async () => {
      expect(tidyWording('  a\u0000b\n\nc d   e  ')).toBe('a b c d e');
      await set(optional, 'Line one\nLine two');
      expect((await list()).rewords[0]?.wording).toBe('Line one Line two');
      const long = await set(optional, 'a'.repeat(CHECKLIST_WORDING_MAX + 1));
      expect(isErr(long) && long.error.message).toContain('400');
    });
  });

  describe('it can never change what the case needs', () => {
    it('leaves readiness exactly as it was, even when a required item is reworded to say it is optional', async () => {
      const before = await computeReadiness(db, missionId);
      await set(required, 'Optional, skip this');
      await set(optional, 'Required, very important');
      const after = await computeReadiness(db, missionId);
      expect(isOk(before) && isOk(after)).toBe(true);
      expect(after).toEqual(before);
      if (isOk(after)) expect(after.value.ready).toBe(false);
    });

    it('does not count as a change to the case, so a confirmed handoff stays confirmed', async () => {
      const read = async () =>
        (
          await db
            .select({ revision: schema.missions.materialRevision })
            .from(schema.missions)
            .where(eq(schema.missions.id, missionId))
        )[0]?.revision;
      const before = await read();
      await set(required, 'My words');
      expect(await read()).toBe(before);
    });

    it('offers no way to hide an item: only the sentence is stored', async () => {
      await set(required, 'My words');
      const [row] = await db.select().from(schema.caseChecklistEdits);
      expect(row).toMatchObject({ kind: 'REWORD', packRequirementId: required, doneAt: null });
    });
  });

  describe('keeping cases and people apart', () => {
    it('does not show one case edits on another case on the same checklist', async () => {
      const other = await newCase('Second trip', versionId);
      await set(required, 'Only on the first case');
      expect((await list(other)).rewords).toEqual([]);
    });

    it('refuses an item that is not on this case checklist, with the same answer as an unknown item', async () => {
      const elsewhere = await pack();
      const foreign = elsewhere.items[0]?.id ?? '';
      const a = await set(foreign, 'Nope');
      const b = await set('00000000-0000-4000-8000-000000000000', 'Nope');
      if (!isErr(a) || !isErr(b)) throw new Error('both should be refused');
      expect(a.error).toEqual(b.error);
    });

    it('refuses a case that is not the proof case, a stranger, and a copied proof', async () => {
      const stranger = await provisionAccount(db, { email: 'edits-stranger@example.com' });
      if (!isOk(stranger)) throw new Error('provision');
      await setConsent(db, {
        actorAccountId: stranger.value.id,
        accountId: stranger.value.id,
        type: 'CORE_PROCESSING',
        granted: true,
      });
      const theirs = await createApplicant(db, {
        actorAccountId: stranger.value.id,
        ownerAccountId: stranger.value.id,
        displayName: 'Stranger',
      });
      if (!isOk(theirs)) throw new Error('applicant');
      const theirCase = await createMission(db, {
        actorAccountId: stranger.value.id,
        applicantId: theirs.value.id,
        title: 'Their trip',
        destination: 'United Kingdom',
        purpose: 'Tourism',
      });
      if (!isOk(theirCase)) throw new Error('their case');
      const strangerProof = await ownerProof('MANAGE', stranger.value.id, theirCase.value.id);
      expect(
        isErr(
          await setChecklistWording(strangerProof, {
            missionId,
            packRequirementId: required,
            wording: 'Mine now',
          }),
        ),
      ).toBe(true);
      const mine = await ownerProof('MANAGE');
      const forged = { ...mine } as unknown as AuthorizedApplicant<'MANAGE'>;
      expect(
        isErr(
          await setChecklistWording(forged, {
            missionId,
            packRequirementId: required,
            wording: 'Forged',
          }),
        ),
      ).toBe(true);
      expect(await db.select().from(schema.caseChecklistEdits)).toEqual([]);
    });

    it('refuses an agency member the traveller shared the case with, who may read but never write', async () => {
      const admin = await provisionAccount(db, { email: 'edits-agency-admin@example.com' });
      if (!isOk(admin)) throw new Error('provision');
      await setConsent(db, {
        actorAccountId: actor,
        accountId: actor,
        type: 'SHARING',
        granted: true,
      });
      const org = await createOrganization(db, {
        actorAccountId: admin.value.id,
        name: 'Shared Agency',
      });
      if (!isOk(org)) throw new Error('org');
      const reviewer = await provisionAccount(db, { email: 'edits-reviewer@example.com' });
      if (!isOk(reviewer)) throw new Error('reviewer');
      await reviewOrganization(db, {
        reviewerAccountId: reviewer.value.id,
        organizationId: org.value.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      });
      const grant = await createGrant(db, {
        actorAccountId: actor,
        applicantId,
        recipientOrganizationId: org.value.id,
        actions: ['VIEW_METADATA', 'COMMENT', 'MANAGE'],
        purpose: 'collaboration',
      });
      if (!isOk(grant)) throw new Error('grant');
      await acceptGrant(db, { actorAccountId: admin.value.id, grantId: grant.value.id });
      const proof = await requireAccess(
        db,
        accountPrincipal(admin.value.id),
        'MANAGE',
        { missionId },
        { purpose: 'collaboration' },
      );
      if (!isOk(proof)) throw new Error(`member proof: ${proof.error.message}`);
      const refused = await setChecklistWording(proof.value, {
        missionId,
        packRequirementId: required,
        wording: 'From the agency',
      });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
      expect(await db.select().from(schema.caseChecklistEdits)).toEqual([]);
      // The words are the traveller's own: a shared agency member cannot read them either.
      await set(required, 'Private words');
      const viewProof = await requireAccess(
        db,
        accountPrincipal(admin.value.id),
        'VIEW_METADATA',
        { missionId },
        { purpose: 'collaboration' },
      );
      if (!isOk(viewProof)) throw new Error('view proof');
      const read = await listCaseChecklistEdits(viewProof.value, missionId);
      expect(isErr(read) && read.error.code).toBe('forbidden');
    });
  });

  describe('rules', () => {
    it('refuses to change a finished case, but still reads it', async () => {
      await set(required, 'Before it closed');
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, missionId));
      const refused = await set(required, 'After it closed');
      expect(isErr(refused) && refused.error.message).toContain('finished');
      expect((await list()).rewords[0]?.wording).toBe('Before it closed');
    });

    it('refuses a case that has no checklist yet', async () => {
      const bare = await newCase('No checklist', null);
      const refused = await set(required, 'Hello', bare);
      expect(isErr(refused) && refused.error.message).toContain('no checklist');
    });

    it('stops at the row cap', async () => {
      const big = await pack(CHECKLIST_EDITS_MAX + 1);
      const mission = await newCase('Big checklist', big.versionId);
      const rows = big.items.slice(0, CHECKLIST_EDITS_MAX);
      for (const item of rows) {
        await db.insert(schema.caseChecklistEdits).values({
          missionId: mission,
          applicantId,
          kind: 'REWORD',
          packRequirementId: item.id,
          wording: 'x',
        });
      }
      const extra = big.items[CHECKLIST_EDITS_MAX]?.id ?? '';
      const refused = await set(extra, 'One too many', mission);
      expect(isErr(refused) && refused.error.message).toContain('as many changes');
      // An item that already has a sentence can still be changed at the cap.
      expect(isOk(await set(rows[0]?.id ?? '', 'Changed', mission))).toBe(true);
    });

    it('does not show a sentence saved against an earlier checklist after the case holds a different one', async () => {
      await set(required, 'For the old checklist');
      const next = await pack();
      await attachPackVersion(db, {
        actorAccountId: actor,
        missionId,
        packVersionId: next.versionId,
      });
      expect((await list()).rewords).toEqual([]);
    });

    it('writes an audit record that names the item and never the words', async () => {
      await set(required, 'A sentence the audit trail must not hold');
      const events = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'CASE_CHECKLIST_WORDING_SET'));
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0])).not.toContain('audit trail must not hold');
      expect(events[0]?.resourceId).toBe(required);
    });
  });

  describe('before the migration has run', () => {
    beforeEach(async () => {
      await db.execute(sql`drop table case_checklist_edits`);
    });

    it('reads as nothing and refuses to write in plain words, and readiness is unaffected', async () => {
      const before = await computeReadiness(db, missionId);
      const listed = await list();
      expect(listed).toEqual({ available: false, editable: false, rewords: [] });
      const refused = await set(required, 'Hello');
      expect(isErr(refused) && refused.error.message).toContain('not switched on');
      expect(await computeReadiness(db, missionId)).toEqual(before);
    });
  });
});
