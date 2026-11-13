import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import type { KeyManagementPort } from '../ports';
import { editFact, registerFieldDefinition } from '../profile';
import { revokeGrant } from '../sharing';
import { recordPackageChoice } from '../umpe-package-service';
import {
  AGENCY_A_NAME,
  EMPLOYMENT_FIELD,
  E_VALUE_1,
  E_VALUE_2,
  E_VALUE_3,
  FINISHED_CASE_TITLE,
  HEAVY,
  LIVE_CASE_TITLE,
  askForDetail,
  buildImpactWorld,
  cancelCase,
  changeEmploymentDetail,
  confirmCase,
  decide,
  historyFingerprint,
  itemOf,
  makeCase,
  must,
  readDetailImpact,
  reasons,
  sendDetail,
  submitCase,
} from './scenario.test-support';

describe('changing a confirmed detail: the shared scenario', () => {
  it(
    'is quiet before the change and names every consequence after it',
    async () => {
      const w = await buildImpactWorld();
      const historyBefore = await historyFingerprint(w.db);

      // One saved value: everything that uses the detail holds the current value.
      const before = await readDetailImpact(w);
      expect(before.subject).toMatchObject({
        kind: 'DETAIL',
        factId: w.e.factId,
        label: 'Current Employer',
        savedValues: 1,
      });
      expect(before.quiet).toBe(true);
      expect(reasons(before)).toEqual([
        [`request:${w.detailRequestId}`, 'AGENCY_HOLDS_CURRENT'],
        [`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS'],
        [`case:${w.liveCaseId}`, 'LIVE_CASE_FOLLOWS_CURRENT'],
      ]);

      const saved = await changeEmploymentDetail(w);
      const after = await readDetailImpact(w);
      expect(after.phase).toBe('RECORDED');
      expect(after.subject).toEqual({
        kind: 'DETAIL',
        factId: w.e.factId,
        label: 'Current Employer',
        changedAt: saved.version.createdAt,
        savedValues: 2,
      });
      expect(reasons(after)).toEqual([
        [`case:${w.liveCaseId}`, 'LIVE_CASE_CONFIRMATION_VOID'],
        [`request:${w.detailRequestId}`, 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK'],
        [`case:${w.finishedCaseId}`, 'FINISHED_CASE_KEPT'],
        [`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS'],
      ]);
      expect(after.counts).toEqual({
        ACTION_REQUIRED: 1,
        REVIEW_RECOMMENDED: 1,
        UNKNOWN: 0,
        HISTORY_PRESERVED: 1,
        NO_ACTION: 1,
      });
      expect(after.quiet).toBe(false);
      expect(after.complete).toBe(true);

      // The live case was confirmed with the earlier value; that confirmation is void.
      expect(itemOf(after, `case:${w.liveCaseId}`)).toEqual({
        id: `case:${w.liveCaseId}`,
        outcome: 'ACTION_REQUIRED',
        reason: 'LIVE_CASE_CONFIRMATION_VOID',
        area: 'CASES',
        about: { kind: 'CASE', missionId: w.liveCaseId, title: LIVE_CASE_TITLE, live: true },
        nextStep: { kind: 'OPEN_CASE', missionId: w.liveCaseId },
      });
      // Agency A accepted the earlier value on a case that is still live.
      expect(itemOf(after, `request:${w.detailRequestId}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        about: {
          kind: 'AGENCY_REQUEST',
          source: 'EVIDENCE_REQUEST',
          organizationId: w.agencyA.organizationId,
          organizationName: AGENCY_A_NAME,
          missionId: w.liveCaseId,
          caseTitle: LIVE_CASE_TITLE,
        },
        nextStep: { kind: 'OPEN_REQUEST', requestId: w.detailRequestId },
      });
      // The finished case keeps the earlier value in its saved copy.
      expect(itemOf(after, `case:${w.finishedCaseId}`)).toEqual({
        id: `case:${w.finishedCaseId}`,
        outcome: 'HISTORY_PRESERVED',
        reason: 'FINISHED_CASE_KEPT',
        area: 'CASES',
        about: {
          kind: 'CASE',
          missionId: w.finishedCaseId,
          title: FINISHED_CASE_TITLE,
          live: false,
        },
        nextStep: null,
      });
      // Agency B's share lists a passport by name and reaches no detail: it is not listed.
      expect(after.items.some((item) => item.id === `share:${w.agencyBShareId}`)).toBe(false);

      // No value of the detail ever leaves the read.
      const text = JSON.stringify([before, after]);
      for (const value of [E_VALUE_1, E_VALUE_2]) expect(text).not.toContain(value);
      for (const id of [w.e.v1, saved.version.id]) expect(text).not.toContain(id);

      // History is byte-identical after the change and every read.
      expect(await historyFingerprint(w.db)).toBe(historyBefore);
    },
    HEAVY,
  );

  it(
    'needs nothing once the live case is confirmed again with the current value',
    async () => {
      const w = await buildImpactWorld();
      await changeEmploymentDetail(w);
      await confirmCase(w.db, w.rahim, w.liveCaseId);
      const impact = await readDetailImpact(w);
      expect(itemOf(impact, `case:${w.liveCaseId}`)).toMatchObject({
        outcome: 'NO_ACTION',
        reason: 'LIVE_CASE_FOLLOWS_CURRENT',
        nextStep: null,
      });
    },
    HEAVY,
  );
});

describe('changing a detail after a case finished', () => {
  it(
    'keeps a saved copy as history, says so plainly when there is none, and skips a copy that holds the current value',
    async () => {
      const w = await buildImpactWorld();
      // Finished with no saved copy: never confirmed, then cancelled.
      const noCopy = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Cancelled Without a Copy',
        factId: w.e.factId,
        confirm: false,
      });
      await cancelCase(w.db, w.rahim, noCopy);
      // A live case that was never confirmed simply follows the current value.
      const neverConfirmed = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Never Confirmed',
        factId: w.e.factId,
        confirm: false,
      });

      await changeEmploymentDetail(w);
      // Finished after the change, with the current value in its saved copy.
      const current = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Submitted With the Current Value',
        factId: w.e.factId,
      });
      await submitCase(w.db, w.rahim, current);

      const impact = await readDetailImpact(w);
      expect(itemOf(impact, `case:${w.finishedCaseId}`).reason).toBe('FINISHED_CASE_KEPT');
      expect(itemOf(impact, `case:${noCopy}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'FINISHED_CASE_NO_SAVED_COPY',
        about: { live: false },
        nextStep: { kind: 'OPEN_CASE', missionId: noCopy },
      });
      expect(itemOf(impact, `case:${neverConfirmed}`).reason).toBe('LIVE_CASE_FOLLOWS_CURRENT');
      expect(impact.items.some((item) => item.id === `case:${current}`)).toBe(false);
      expect(impact.quiet).toBe(false);
    },
    HEAVY,
  );
});

describe('a detail changed twice with a send in between', () => {
  it(
    'judges each request by the value it actually carried',
    async () => {
      const w = await buildImpactWorld();
      const second = await askForDetail(w.db, w.agencyA, w.rahim);
      const v2 = await changeEmploymentDetail(w, E_VALUE_2);
      await sendDetail(w.db, w.rahim, second, w.e.factId);

      // Between the two changes: the second request holds the current value.
      const between = await readDetailImpact(w);
      expect(itemOf(between, `request:${second}`).reason).toBe('AGENCY_HOLDS_CURRENT');
      expect(itemOf(between, `request:${w.detailRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );

      const v3 = await changeEmploymentDetail(w, E_VALUE_3);
      const after = await readDetailImpact(w);
      expect(after.subject).toMatchObject({ savedValues: 3, changedAt: v3.version.createdAt });
      // The second request now holds an earlier value that the agency has not decided on.
      expect(itemOf(after, `request:${second}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'AGENCY_CHECKING_EARLIER',
      });
      expect(itemOf(after, `request:${w.detailRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      expect(JSON.stringify(after)).not.toContain(v2.version.id);

      // Accepted: still the earlier value, now accepted with a live share and no case.
      await decide(w.db, w.agencyA, second, 'ACCEPTED');
      expect(itemOf(await readDetailImpact(w), `request:${second}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
    },
    HEAVY,
  );
});

describe('a detail request the agency sent back', () => {
  it(
    'waits on the traveller even when the value sent is still the current one',
    async () => {
      const w = await buildImpactWorld();
      const sentBack = await askForDetail(w.db, w.agencyA, w.rahim);
      await sendDetail(w.db, w.rahim, sentBack, w.e.factId);
      await decide(w.db, w.agencyA, sentBack, 'CONTRADICTION');

      const stillCurrent = await readDetailImpact(w);
      expect(stillCurrent.subject).toMatchObject({ savedValues: 1 });
      expect(itemOf(stillCurrent, `request:${sentBack}`)).toMatchObject({
        outcome: 'ACTION_REQUIRED',
        reason: 'AGENCY_WAITING_FOR_REPLACEMENT',
        nextStep: { kind: 'OPEN_REQUEST', requestId: sentBack },
      });
      expect(stillCurrent.quiet).toBe(false);

      // The traveller corrects the detail and answers again: the agency holds the current value.
      await changeEmploymentDetail(w);
      expect(itemOf(await readDetailImpact(w), `request:${sentBack}`).reason).toBe(
        'AGENCY_WAITING_FOR_REPLACEMENT',
      );
      await sendDetail(w.db, w.rahim, sentBack, w.e.factId);
      expect(itemOf(await readDetailImpact(w), `request:${sentBack}`)).toMatchObject({
        outcome: 'NO_ACTION',
        reason: 'AGENCY_HOLDS_CURRENT',
        nextStep: null,
      });
    },
    HEAVY,
  );
});

describe('changing a detail that nothing uses', () => {
  it(
    'stays quiet',
    async () => {
      const w = await buildImpactWorld();
      // Nothing selects or was sent the occupation detail. The one record that relates to it is
      // Agency A's whole-record share, which follows the detail: NO_ACTION.
      const withWiderShare = await readDetailImpact(w, w.controlDetail.factId);
      expect(withWiderShare.quiet).toBe(true);
      expect(withWiderShare.complete).toBe(true);
      expect(reasons(withWiderShare)).toEqual([
        [`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS'],
      ]);

      // With no share that reaches it, there is nothing at all to say.
      must(
        await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: w.agencyAShareId }),
        'revoke',
      );
      const alone = await readDetailImpact(w, w.controlDetail.factId);
      expect(alone.items).toEqual([]);
      expect(alone.quiet).toBe(true);
      expect(alone.counts).toEqual({
        ACTION_REQUIRED: 0,
        REVIEW_RECOMMENDED: 0,
        UNKNOWN: 0,
        HISTORY_PRESERVED: 0,
        NO_ACTION: 0,
      });
    },
    HEAVY,
  );
});

describe('a detail saved again without changing it', () => {
  it(
    'is not an earlier value: the agency holds the current value and the finished case is not listed',
    async () => {
      const w = await buildImpactWorld();
      // Saving the same text again still records a new saved value (and voids the confirmation).
      const again = await changeEmploymentDetail(w, E_VALUE_1);
      expect(again.version.id).not.toBe(w.e.v1);

      const impact = await readDetailImpact(w);
      expect(impact.subject).toMatchObject({ savedValues: 2 });
      // The send is pinned to the first saved value, whose text is the current text.
      expect(itemOf(impact, `request:${w.detailRequestId}`)).toMatchObject({
        outcome: 'NO_ACTION',
        reason: 'AGENCY_HOLDS_CURRENT',
        nextStep: null,
      });
      expect(impact.items.some((item) => item.id === `case:${w.finishedCaseId}`)).toBe(false);
      // The one real consequence: the live case's confirmation was voided by the save, and the
      // traveller must confirm again whatever the text.
      expect(reasons(impact)).toEqual([
        [`case:${w.liveCaseId}`, 'LIVE_CASE_CONFIRMATION_VOID'],
        [`request:${w.detailRequestId}`, 'AGENCY_HOLDS_CURRENT'],
        [`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS'],
      ]);

      // Confirmed again: nothing is left to look at.
      await confirmCase(w.db, w.rahim, w.liveCaseId);
      const quiet = await readDetailImpact(w);
      expect(quiet.quiet).toBe(true);
      expect(quiet.counts).toMatchObject({ ACTION_REQUIRED: 0, REVIEW_RECOMMENDED: 0, UNKNOWN: 0 });
      expect(itemOf(quiet, `request:${w.detailRequestId}`).reason).toBe('AGENCY_HOLDS_CURRENT');

      // A case cancelled with no saved copy has nothing unknown about it either: no saved value
      // differs from the current one.
      const noCopy = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Cancelled Without a Copy',
        factId: w.e.factId,
        confirm: false,
      });
      await cancelCase(w.db, w.rahim, noCopy);
      expect((await readDetailImpact(w)).items.some((item) => item.id === `case:${noCopy}`)).toBe(
        false,
      );
      expect(JSON.stringify(impact)).not.toContain(E_VALUE_1);
    },
    HEAVY,
  );

  it(
    'changed and then changed back: the earlier answer holds the current value again',
    async () => {
      const w = await buildImpactWorld();
      await changeEmploymentDetail(w, E_VALUE_2);
      expect(itemOf(await readDetailImpact(w), `request:${w.detailRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      expect(itemOf(await readDetailImpact(w), `case:${w.finishedCaseId}`).reason).toBe(
        'FINISHED_CASE_KEPT',
      );

      await changeEmploymentDetail(w, E_VALUE_1);
      const back = await readDetailImpact(w);
      expect(back.subject).toMatchObject({ savedValues: 3 });
      expect(itemOf(back, `request:${w.detailRequestId}`).reason).toBe('AGENCY_HOLDS_CURRENT');
      expect(back.items.some((item) => item.id === `case:${w.finishedCaseId}`)).toBe(false);
      expect(itemOf(back, `case:${w.liveCaseId}`).reason).toBe('LIVE_CASE_CONFIRMATION_VOID');

      // Exact text only: a different spelling is a different value.
      await changeEmploymentDetail(w, `${E_VALUE_1} `);
      expect(itemOf(await readDetailImpact(w), `request:${w.detailRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
    },
    HEAVY,
  );

  it(
    'is not compared for a detail stored protected: the saved value itself decides',
    async () => {
      const w = await buildImpactWorld();
      const keys = new Map<string, Uint8Array>();
      const encryption: KeyManagementPort = {
        currentKeyVersion: () => 'test-v1',
        async generateDataKey() {
          const id = randomUUID();
          const key = randomBytes(32);
          keys.set(id, key);
          return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: Buffer.from(id) };
        },
        async unwrapDataKey(version, wrapped) {
          const key = keys.get(Buffer.from(wrapped).toString());
          if (version !== 'test-v1' || !key) throw new Error('Unknown key');
          return key;
        },
      };
      const field = 'passport.number';
      await registerFieldDefinition(w.db, {
        key: field,
        dataType: 'string',
        sensitivity: 'SENSITIVE',
      });
      const save = async () =>
        must(
          await editFact(w.db, {
            actorAccountId: w.rahim.accountId,
            applicantId: w.rahim.applicantId,
            fieldKey: field,
            value: 'SAMPLE12345',
            encryption,
          }),
          'protected save',
        );
      const first = await save();
      expect(first.version.protectedKeyVersion).not.toBeNull();
      const request = await askForDetail(w.db, w.agencyA, w.rahim, undefined, field);
      await sendDetail(w.db, w.rahim, request, first.fact.id);
      await decide(w.db, w.agencyA, request, 'ACCEPTED');
      expect(itemOf(await readDetailImpact(w, first.fact.id), `request:${request}`).reason).toBe(
        'AGENCY_HOLDS_CURRENT',
      );

      // The same text saved again. A protected value is never opened by this read, so it cannot
      // know the text is the same: the answer names an earlier saved value, and that is said.
      await save();
      const impact = await readDetailImpact(w, first.fact.id);
      expect(impact.subject).toMatchObject({ savedValues: 2 });
      expect(itemOf(impact, `request:${request}`).reason).toBe('AGENCY_ACCEPTED_EARLIER_LIVE_WORK');
      expect(JSON.stringify(impact)).not.toContain('SAMPLE12345');
    },
    HEAVY,
  );
});

describe('a saved value with the same text and a different meaning', () => {
  it(
    'is a change when the entry was ended: the agency and the finished case hold the earlier value',
    async () => {
      const w = await buildImpactWorld();
      // By hand, what ending an entry writes: the same text carried forward, an end date and the
      // reason "Ended", made the current value.
      const [current] = await w.db
        .select()
        .from(schema.factVersions)
        .where(eq(schema.factVersions.id, w.e.v1));
      if (!current) throw new Error('current value');
      const [ended] = await w.db
        .insert(schema.factVersions)
        .values({
          factId: w.e.factId,
          value: current.value,
          normalizedValue: current.normalizedValue,
          status: current.status,
          effectiveFrom: current.effectiveFrom,
          method: 'MANUAL',
          actorAccountId: w.rahim.accountId,
          reason: 'Ended',
          validUntil: new Date(),
          approvedAt: new Date(),
        })
        .returning();
      if (!ended) throw new Error('ended value');
      await w.db
        .update(schema.facts)
        .set({ currentVersionId: ended.id })
        .where(eq(schema.facts.id, w.e.factId));

      const impact = await readDetailImpact(w);
      expect(itemOf(impact, `request:${w.detailRequestId}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      });
      expect(itemOf(impact, `case:${w.finishedCaseId}`).reason).toBe('FINISHED_CASE_KEPT');
      expect(impact.quiet).toBe(false);
      expect(JSON.stringify(impact)).not.toContain(E_VALUE_1);
    },
    HEAVY,
  );

  it(
    'is a change when a start date is stated for the first time or corrected',
    async () => {
      const w = await buildImpactWorld();
      const save = async (effectiveFrom: Date) =>
        must(
          await editFact(w.db, {
            actorAccountId: w.rahim.accountId,
            applicantId: w.rahim.applicantId,
            fieldKey: EMPLOYMENT_FIELD,
            value: E_VALUE_1,
            effectiveFrom,
          }),
          'save',
        );

      // The same text, now with a start date: the first answer, sent with none, is earlier.
      await save(new Date('2025-01-01T00:00:00Z'));
      expect(itemOf(await readDetailImpact(w), `request:${w.detailRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      const dated = await askForDetail(w.db, w.agencyA, w.rahim);
      await sendDetail(w.db, w.rahim, dated, w.e.factId);
      await decide(w.db, w.agencyA, dated, 'ACCEPTED');
      expect(itemOf(await readDetailImpact(w), `request:${dated}`).reason).toBe(
        'AGENCY_HOLDS_CURRENT',
      );

      // The same text with a corrected start date: the dated answer is earlier.
      await save(new Date('2025-02-01T00:00:00Z'));
      expect(itemOf(await readDetailImpact(w), `request:${dated}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
    },
    HEAVY,
  );
});

describe('a start date stated for a different text', () => {
  const START = new Date('2025-01-01T00:00:00Z');
  const save = async (
    w: Awaited<ReturnType<typeof buildImpactWorld>>,
    value: string,
    effectiveFrom?: Date,
  ) =>
    must(
      await editFact(w.db, {
        actorAccountId: w.rahim.accountId,
        applicantId: w.rahim.applicantId,
        fieldKey: EMPLOYMENT_FIELD,
        value,
        ...(effectiveFrom ? { effectiveFrom } : {}),
      }),
      'save',
    );

  it(
    'is not carried over to the text saved back without a date',
    async () => {
      const w = await buildImpactWorld();
      // The agency accepted the first text with no start date. A different text is saved with a
      // start date, then the first text again with none: the date was stated for the other text.
      await save(w, E_VALUE_2, START);
      await save(w, E_VALUE_1);
      const impact = await readDetailImpact(w);
      expect(impact.subject).toMatchObject({ savedValues: 3 });
      expect(itemOf(impact, `request:${w.detailRequestId}`)).toMatchObject({
        outcome: 'NO_ACTION',
        reason: 'AGENCY_HOLDS_CURRENT',
      });
      expect(impact.items.some((item) => item.id === `case:${w.finishedCaseId}`)).toBe(false);
    },
    HEAVY,
  );

  it(
    'does not hide a start date stated for the first time for the text the agency holds',
    async () => {
      const w = await buildImpactWorld();
      // A different text is saved with a start date, then the first text again with none, and
      // that undated value is sent and accepted.
      await save(w, E_VALUE_2, START);
      await save(w, E_VALUE_1);
      const asked = await askForDetail(w.db, w.agencyA, w.rahim);
      await sendDetail(w.db, w.rahim, asked, w.e.factId);
      await decide(w.db, w.agencyA, asked, 'ACCEPTED');
      expect(itemOf(await readDetailImpact(w), `request:${asked}`).reason).toBe(
        'AGENCY_HOLDS_CURRENT',
      );

      // The same date, now stated for the first text for the first time: a change.
      await save(w, E_VALUE_1, START);
      expect(itemOf(await readDetailImpact(w), `request:${asked}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      });
    },
    HEAVY,
  );
});

describe('the profile editor saving the same text again', () => {
  /**
   * Saves `E_VALUE_1` with `first` (a way the value can come to be stored), has Agency A ask for
   * it, receive it and accept it, confirms the live case, then saves the same text again the way
   * the profile editor does: no status and no date. Returns the reads before and after.
   */
  async function resaveInEditor(first: { status?: 'DOCUMENT_SUPPORTED'; effectiveFrom?: Date }) {
    const w = await buildImpactWorld();
    const edit = async (options: typeof first) =>
      must(
        await editFact(w.db, {
          actorAccountId: w.rahim.accountId,
          applicantId: w.rahim.applicantId,
          fieldKey: EMPLOYMENT_FIELD,
          value: E_VALUE_1,
          ...options,
        }),
        'save',
      );
    await edit(first);
    const asked = await askForDetail(w.db, w.agencyA, w.rahim);
    await sendDetail(w.db, w.rahim, asked, w.e.factId);
    await decide(w.db, w.agencyA, asked, 'ACCEPTED');
    await confirmCase(w.db, w.rahim, w.liveCaseId);
    const before = await readDetailImpact(w);
    expect(itemOf(before, `request:${asked}`).reason).toBe('AGENCY_HOLDS_CURRENT');

    await edit({});
    const after = await readDetailImpact(w);
    return { w, asked, before, after };
  }

  /** The re-save changes nothing for the agency; only the case's confirmation is void. */
  function expectOnlyConfirmationVoid(run: Awaited<ReturnType<typeof resaveInEditor>>) {
    const { w, asked, before, after } = run;
    expect(itemOf(after, `request:${asked}`).reason).toBe('AGENCY_HOLDS_CURRENT');
    expect(itemOf(after, `case:${w.liveCaseId}`).reason).toBe('LIVE_CASE_CONFIRMATION_VOID');
    const others = (impact: typeof after) =>
      reasons(impact).filter(([id]) => id !== `case:${w.liveCaseId}`);
    expect(others(after)).toEqual(others(before));
    expect(after.counts.REVIEW_RECOMMENDED).toBe(before.counts.REVIEW_RECOMMENDED);
  }

  it(
    'over a value approved from a document is not a change for the agency',
    async () => {
      expectOnlyConfirmationVoid(await resaveInEditor({ status: 'DOCUMENT_SUPPORTED' }));
    },
    HEAVY,
  );

  it(
    'over a value with a start date is not a change for the agency',
    async () => {
      expectOnlyConfirmationVoid(
        await resaveInEditor({ effectiveFrom: new Date('2025-01-01T00:00:00Z') }),
      );
    },
    HEAVY,
  );
});

describe('a live case that deliberately keeps an earlier value', () => {
  it(
    'is offered for review instead of being said to follow the current value',
    async () => {
      const w = await buildImpactWorld();
      const keeper = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Keeping a Value',
        confirm: false,
      });
      const caseProof = must(
        await requireAccess(
          w.db,
          accountPrincipal(w.rahim.accountId),
          'MANAGE',
          { missionId: keeper },
          { purpose: 'self' },
        ),
        'case proof',
      );
      must(
        await recordPackageChoice(caseProof, {
          missionId: keeper,
          packRequirementId: w.checklist.detailRequirementId,
          choice: 'USE_COPY',
          factVersionId: w.e.v1,
        }),
        'use this value',
      );
      // The chosen value is the current one: the case simply follows it.
      expect(itemOf(await readDetailImpact(w), `case:${keeper}`).reason).toBe(
        'LIVE_CASE_FOLLOWS_CURRENT',
      );

      await changeEmploymentDetail(w);
      expect(itemOf(await readDetailImpact(w), `case:${keeper}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'LIVE_CASE_KEEPS_EARLIER_COPY',
        nextStep: { kind: 'OPEN_CASE', missionId: keeper },
      });

      // Confirmed, then the detail changes again: the void confirmation is the stronger item.
      await confirmCase(w.db, w.rahim, keeper);
      expect(itemOf(await readDetailImpact(w), `case:${keeper}`).reason).toBe(
        'LIVE_CASE_KEEPS_EARLIER_COPY',
      );
      await changeEmploymentDetail(w, E_VALUE_3);
      expect(itemOf(await readDetailImpact(w), `case:${keeper}`).reason).toBe(
        'LIVE_CASE_CONFIRMATION_VOID',
      );

      // Changed back to the chosen text: the choice holds the current value again.
      await confirmCase(w.db, w.rahim, keeper);
      await changeEmploymentDetail(w, E_VALUE_1);
      await confirmCase(w.db, w.rahim, keeper);
      expect(itemOf(await readDetailImpact(w), `case:${keeper}`).reason).toBe(
        'LIVE_CASE_FOLLOWS_CURRENT',
      );
    },
    HEAVY,
  );
});

describe('a case made after the detail last changed', () => {
  it(
    'is not listed when it finishes without a saved copy: it can only have held the current value',
    async () => {
      const w = await buildImpactWorld();
      const earlier = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Earlier Case',
        factId: w.e.factId,
        confirm: false,
      });
      await changeEmploymentDetail(w);
      const later = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Later Case',
        factId: w.e.factId,
        confirm: false,
      });
      await cancelCase(w.db, w.rahim, earlier);
      await cancelCase(w.db, w.rahim, later);

      const impact = await readDetailImpact(w);
      expect(impact.items.some((item) => item.id === `case:${later}`)).toBe(false);
      // The case that existed while the detail held the earlier value is still unknown.
      expect(itemOf(impact, `case:${earlier}`).reason).toBe('FINISHED_CASE_NO_SAVED_COPY');
    },
    HEAVY,
  );
});
