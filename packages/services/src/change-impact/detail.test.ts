import { describe, expect, it } from 'vitest';
import { revokeGrant } from '../sharing';
import {
  AGENCY_A_NAME,
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
