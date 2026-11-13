import { describe, expect, it } from 'vitest';
import { listChangesSinceConfirmed } from '../application-memory';
import { listNeedsAttention } from '../attention';
import { listFieldAnswersForOwner } from '../evidence-field-answers';
import { listEvidenceSubmissions } from '../evidence-submissions';
import { removalImpact } from '../lifecycle/removal-requests/effects';
import { listReplacementOptions } from '../lifecycle/replace';
import { getLiveAcknowledgement } from '../material-revision';
import { listTasks } from '../missions';
import {
  HEAVY,
  LIVE_CASE_TITLE,
  PASSPORT_TYPE,
  buildImpactWorld,
  changeEmploymentDetail,
  makeDocument,
  must,
  ownerManage,
  ownerView,
  replaceWithNewerPassport,
} from './scenario.test-support';

/**
 * The reproducible "before": what the services that already exist tell the traveller when they
 * replace a document or change a confirmed detail, with no new code. Each assertion carries a
 * "today:" line. `BASELINE` is the summary: `trueConsequences` counts the consequences listed
 * below, and `surfacedAtChangeTime` is measured by each test and asserted there.
 *
 * The true consequences in the scenario (see `scenario.test-support.ts`):
 *   Replacing passport P1: (1) the live case still uses it and its confirmation is void, (2) the
 *   finished case keeps it in its saved copy, (3) Agency A accepted that exact copy, (4) Agency
 *   B's share lists P1 by name and does not reach the newer passport.
 *   Changing employment detail E: (1) the live case was confirmed with the earlier value and that
 *   confirmation is void, (2) the finished case keeps the earlier value, (3) Agency A accepted
 *   the earlier value.
 */

const BASELINE = {
  documentChange: { trueConsequences: 4, surfacedAtChangeTime: 1 },
  detailChange: { trueConsequences: 3, surfacedAtChangeTime: 0 },
} as const;

describe('baseline: what the existing services say about a replaced document', () => {
  it(
    'names the live case and nothing else',
    async () => {
      const w = await buildImpactWorld();
      const { db, rahim } = w;
      expect(await getLiveAcknowledgement(db, w.liveCaseId)).toBeDefined();

      // today: before choosing, the Replace flow lists the open case that will be updated. It
      // says nothing about the finished case, Agency A's accepted copy or Agency B's share.
      const candidate = await makeDocument(db, rahim, PASSPORT_TYPE, 'sample-candidate.pdf');
      const options = must(
        await listReplacementOptions(await ownerManage(db, rahim), {
          oldDocumentId: w.p1.documentId,
        }),
        'options',
      );
      expect(Object.keys(options).sort()).toEqual(['candidates', 'cases', 'docType']);
      expect(options.cases).toEqual([{ missionId: w.liveCaseId, title: LIVE_CASE_TITLE }]);
      expect(options.candidates.map((c) => c.documentId)).toEqual([candidate.documentId]);

      // today: the removal preview (a different action) counts one open case, one finished case
      // and one share that names the document. Its agency list is by case scope alone, so it
      // holds both agencies; it knows nothing of the copy Agency A accepted.
      const removal = await removalImpact(
        db,
        rahim.applicantId,
        w.p1.documentId,
        new Date(),
        await ownerManage(db, rahim),
      );
      expect(removal.openCaseIds).toEqual([w.liveCaseId]);
      expect(removal.finishedCases).toBe(1);
      expect(removal.sharesAffected).toBe(1);
      expect([...removal.agenciesByCase.values()].flat().sort()).toEqual(
        [w.agencyA.organizationId, w.agencyB.organizationId].sort(),
      );

      // today: the replacement returns the flagged live case only (1 of 4 consequences).
      const { outcome } = await replaceWithNewerPassport(w);
      expect(Object.keys(outcome).sort()).toEqual(['cases', 'flaggedMissionIds']);
      expect(outcome.flaggedMissionIds).toEqual([w.liveCaseId]);
      expect(outcome.cases).toEqual([{ missionId: w.liveCaseId, title: LIVE_CASE_TITLE }]);
      const surfacedAtChangeTime = outcome.cases.length;
      expect(surfacedAtChangeTime).toBe(BASELINE.documentChange.surfacedAtChangeTime);

      // today: the live case gets one task and its confirmation is void; the finished case gets
      // nothing.
      const liveTasks = must(await listTasks(db, rahim.accountId, w.liveCaseId), 'tasks');
      expect(liveTasks.map((t) => t.description)).toEqual([
        '"sample-passport-older.pdf" was replaced with a newer document. Check that this case uses the right one, then confirm the case again.',
      ]);
      expect(must(await listTasks(db, rahim.accountId, w.finishedCaseId), 'tasks')).toEqual([]);
      expect(await getLiveAcknowledgement(db, w.liveCaseId)).toBeUndefined();

      // today: Needs Attention shows the live case twice (changed since confirmed, and the task)
      // and nothing about any agency or share.
      const attention = must(await listNeedsAttention(await ownerView(db, rahim)), 'attention');
      expect(attention.items.map((item) => [item.kind, item.caseId])).toEqual([
        ['case_changed', w.liveCaseId],
        ['task', w.liveCaseId],
      ]);

      // today: opened from the live case, the comparison says the document was replaced.
      const changes = must(
        await listChangesSinceConfirmed(await ownerView(db, rahim, { missionId: w.liveCaseId })),
        'changes',
      );
      expect(changes?.changes).toEqual([
        {
          kind: 'document',
          change: 'replaced',
          documentId: w.p1.documentId,
          docType: PASSPORT_TYPE,
        },
      ]);

      // today: Agency A's request still shows the accepted earlier copy, with no sign that the
      // document behind it was replaced.
      const sends = must(
        await listEvidenceSubmissions(await ownerManage(db, rahim), {
          requestId: w.documentRequestId,
        }),
        'sends',
      );
      expect(sends.submissions.map((s) => [s.documentId, s.state])).toEqual([
        [w.p1.documentId, 'ACCEPTED'],
      ]);
      expect(Object.keys(sends.submissions[0] ?? {})).not.toContain('replaced');
    },
    HEAVY,
  );
});

describe('baseline: what the existing services say about a changed detail', () => {
  it(
    'says nothing at the moment of the change',
    async () => {
      const w = await buildImpactWorld();
      const { db, rahim } = w;
      const tasksBefore = must(await listTasks(db, rahim.accountId, w.liveCaseId), 'tasks');

      // today: saving the detail returns the detail and its new saved value, nothing at all
      // about consequences (0 of 3).
      const saved = await changeEmploymentDetail(w);
      expect(Object.keys(saved).sort()).toEqual(['fact', 'version']);
      const surfacedAtChangeTime = Object.keys(saved).filter(
        (key) => key !== 'fact' && key !== 'version',
      ).length;
      expect(surfacedAtChangeTime).toBe(BASELINE.detailChange.surfacedAtChangeTime);

      // today: the live case's confirmation is void, silently: no task is created.
      expect(await getLiveAcknowledgement(db, w.liveCaseId)).toBeUndefined();
      expect(must(await listTasks(db, rahim.accountId, w.liveCaseId), 'tasks')).toEqual(
        tasksBefore,
      );
      expect(tasksBefore).toEqual([]);

      // today: Needs Attention later shows the live case as changed since confirmed, and nothing
      // about Agency A or the finished case.
      const attention = must(await listNeedsAttention(await ownerView(db, rahim)), 'attention');
      expect(attention.items.map((item) => [item.kind, item.caseId])).toEqual([
        ['case_changed', w.liveCaseId],
      ]);

      // today: opened from the live case, the comparison names the changed detail.
      const changes = must(
        await listChangesSinceConfirmed(await ownerView(db, rahim, { missionId: w.liveCaseId })),
        'changes',
      );
      expect(changes?.changes).toEqual([
        {
          kind: 'detail',
          change: 'changed',
          fieldKey: 'current_employer',
          repeatingRecordKey: null,
          factId: w.e.factId,
          priorFactVersionId: w.e.v1,
          currentFactVersionId: saved.version.id,
        },
      ]);

      // today: only when the traveller opens Agency A's request does its answer show that the
      // accepted value is no longer the current one (`stillCurrent: false`).
      const answers = must(
        await listFieldAnswersForOwner(await ownerManage(db, rahim), {
          requestIds: [w.detailRequestId],
        }),
        'answers',
      );
      const rounds = answers.get(w.detailRequestId)?.rounds ?? [];
      expect(rounds.map((r) => [r.state, r.version?.id, r.version?.stillCurrent])).toEqual([
        ['ACCEPTED', w.e.v1, false],
      ]);
    },
    HEAVY,
  );
});
