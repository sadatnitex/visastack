import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cancelEvidenceRequest } from '../agency';
import { listFieldAnswersForOwner } from '../evidence-field-answers';
import { listEvidenceSubmissions } from '../evidence-submissions';
import { pinnedFactVersionsOfFinishedCase } from '../missions';
import type { SendState } from './classify';
import {
  casesSelecting,
  detailRequestHistories,
  documentRequestHistories,
  savedCopiesOf,
} from './load';
import { roundsOf } from './rounds';
import {
  E_VALUE_3,
  HEAVY,
  askForDetail,
  askForDocument,
  buildImpactWorld,
  cancelCase,
  changeEmploymentDetail,
  decide,
  makeCase,
  must,
  ownerManage,
  ownerView,
  replaceWithNewerPassport,
  sendDetail,
  sendDocument,
} from './scenario.test-support';

/*
 * The impact read works out a request's rounds and a finished case's saved copy in batches, for
 * many records at once. These tests hold those batched readings to the read models a person
 * already sees (one request or one case at a time), so the two can never tell different stories.
 */

const STATE: Readonly<Record<string, SendState>> = {
  AWAITING_DECISION: 'AWAITING_DECISION',
  ACCEPTED: 'ACCEPTED',
  NEEDS_REPLACEMENT: 'SENT_BACK',
  CONTRADICTION: 'SENT_BACK',
  CORRECTION_PROPOSED: 'SENT_BACK',
  WITHDRAWN: 'WITHDRAWN',
};

describe('the batched reading of request rounds', () => {
  it(
    'matches what the traveller sees request by request, for documents and for details',
    async () => {
      const w = await buildImpactWorld();
      const { db, rahim, agencyA } = w;
      // Documents: sent back then answered again; still waiting; withdrawn while waiting.
      const again = await askForDocument(db, agencyA, rahim, w.liveCaseId);
      await sendDocument(db, rahim, again, w.p1.documentId);
      await decide(db, agencyA, again, 'NEEDS_REPLACEMENT');
      const waiting = await askForDocument(db, agencyA, rahim);
      await sendDocument(db, rahim, waiting, w.p1.documentId);
      const withdrawn = await askForDocument(db, agencyA, rahim);
      await sendDocument(db, rahim, withdrawn, w.p1.documentId);
      must(
        await cancelEvidenceRequest(db, {
          actorAccountId: agencyA.accountId,
          requestId: withdrawn,
        }),
        'withdraw',
      );
      const { newer } = await replaceWithNewerPassport(w);
      await sendDocument(db, rahim, again, newer.documentId);
      // Details: accepted (base), contradicted then answered again, waiting.
      const disputed = await askForDetail(db, agencyA, rahim);
      await sendDetail(db, rahim, disputed, w.e.factId);
      await decide(db, agencyA, disputed, 'CONTRADICTION');
      await changeEmploymentDetail(w);
      await sendDetail(db, rahim, disputed, w.e.factId);
      const waitingDetail = await askForDetail(db, agencyA, rahim);
      await sendDetail(db, rahim, waitingDetail, w.e.factId);
      await changeEmploymentDetail(w, E_VALUE_3);

      const proof = await ownerManage(db, rahim);

      const documentHistories = await documentRequestHistories(
        proof,
        db,
        [w.p1.documentId, newer.documentId],
        true,
      );
      expect(documentHistories.map((h) => h.request.id).sort()).toEqual(
        [w.documentRequestId, again, waiting, withdrawn].sort(),
      );
      for (const history of documentHistories) {
        const mine = roundsOf(
          history.request,
          history.sends,
          history.decisions,
          (send) => send.subjectId === history.request.respondingId,
        );
        const shown = must(
          await listEvidenceSubmissions(proof, { requestId: history.request.id }),
          'sends',
        );
        const theirs = [
          ...shown.submissions.map((s) => ({
            precision: 'pinned',
            state: STATE[s.state],
            subjectId: s.documentId,
            versionId: s.documentVersionId as string | null,
            sentAt: s.sentAt as Date | null,
            decidedAt: s.decidedAt,
          })),
          ...shown.legacy.map((l) => ({
            precision: 'legacy',
            state: STATE[l.state],
            subjectId: l.documentId,
            versionId: null,
            sentAt: l.sentAt,
            decidedAt: l.decidedAt,
          })),
        ];
        expect(
          mine.map((round) => ({
            precision: round.precision,
            state: round.state,
            subjectId: round.precision === 'pinned' ? round.send.subjectId : round.subjectId,
            versionId: round.precision === 'pinned' ? round.send.versionId : null,
            sentAt: round.sentAt,
            decidedAt: round.decidedAt,
          })),
          history.request.id,
        ).toEqual(theirs);
        expect(mine.every((round) => round.precision !== 'pinned' || round.send.intact)).toBe(true);
      }

      const versionIds = new Set(
        (
          await db
            .select({ id: schema.factVersions.id })
            .from(schema.factVersions)
            .where(eq(schema.factVersions.factId, w.e.factId))
        ).map((row) => row.id),
      );
      const detailHistories = await detailRequestHistories(proof, db, w.e.factId, versionIds, true);
      expect(detailHistories.map((h) => h.request.id).sort()).toEqual(
        [w.detailRequestId, disputed, waitingDetail].sort(),
      );
      const shown = must(
        await listFieldAnswersForOwner(proof, {
          requestIds: detailHistories.map((h) => h.request.id),
        }),
        'answers',
      );
      for (const history of detailHistories) {
        const mine = roundsOf(history.request, history.sends, history.decisions, () => true);
        const theirs = shown.get(history.request.id)?.rounds ?? [];
        expect(
          mine.map((round) => ({
            precision: round.precision,
            state: round.state,
            versionId: round.precision === 'pinned' ? round.send.versionId : null,
            sentAt: round.sentAt,
            decidedAt: round.decidedAt,
          })),
          history.request.id,
        ).toEqual(
          theirs.map((round) => ({
            precision: round.precision,
            state: STATE[round.state],
            versionId: round.version?.id ?? null,
            sentAt: round.sentAt,
            decidedAt: round.decidedAt,
          })),
        );
      }
    },
    HEAVY,
  );
});

describe('the batched reading of saved copies', () => {
  it(
    'chooses the same copy for a finished case as the case screens do',
    async () => {
      const w = await buildImpactWorld();
      const { db, rahim } = w;
      // Cancelled with a copy that still describes it; cancelled with none; cancelled with a
      // copy the case had already moved past.
      const withCopy = await makeCase(db, rahim, w.checklist, {
        title: 'Sample Cancelled With a Copy',
        factId: w.e.factId,
      });
      const noCopy = await makeCase(db, rahim, w.checklist, {
        title: 'Sample Cancelled Without a Copy',
        factId: w.e.factId,
        confirm: false,
      });
      const staleCopy = await makeCase(db, rahim, w.checklist, {
        title: 'Sample Cancelled After a Change',
        factId: w.e.factId,
      });
      await cancelCase(db, rahim, withCopy);
      await cancelCase(db, rahim, noCopy);
      await changeEmploymentDetail(w);
      await cancelCase(db, rahim, staleCopy);

      const proof = await ownerManage(db, rahim);
      const view = await ownerView(db, rahim);
      const finished = (await casesSelecting(proof, db, { factId: w.e.factId })).filter(
        (row) => row.id !== w.liveCaseId,
      );
      expect(finished.map((row) => row.id).sort()).toEqual(
        [w.finishedCaseId, withCopy, noCopy, staleCopy].sort(),
      );
      const copies = await savedCopiesOf(proof, db, finished);
      const expected: Record<string, string | null> = {
        [w.finishedCaseId]: w.e.v1,
        [withCopy]: w.e.v1,
        [noCopy]: null,
        [staleCopy]: null,
      };
      for (const row of finished) {
        const [mission] = await db
          .select()
          .from(schema.missions)
          .where(eq(schema.missions.id, row.id));
        if (!mission) throw new Error('case');
        const theirs = await pinnedFactVersionsOfFinishedCase(view, mission);
        const mine = [...(copies.get(row.id)?.byRequirement.values() ?? [])]
          .flatMap((used) => used.facts)
          .find((fact) => fact.factId === w.e.factId);
        expect(mine?.factVersionId ?? null, row.title).toBe(
          theirs.get(w.e.factId)?.factVersionId ?? null,
        );
        expect(mine?.factVersionId ?? null, row.title).toBe(expected[row.id]);
        expect(copies.get(row.id) === null, row.title).toBe(expected[row.id] === null);
      }
    },
    HEAVY,
  );
});
