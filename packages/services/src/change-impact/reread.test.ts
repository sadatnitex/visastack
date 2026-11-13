import { schema } from '@visastack/db';
import { describe, expect, it } from 'vitest';
import { assessDocumentChangeImpact } from './document';
import type { RequestHistory } from './load';
import {
  HEAVY,
  buildImpactWorld,
  itemOf,
  must,
  ownerManage,
  replaceWithNewerPassport,
} from './scenario.test-support';
import { type SendRules, evidenceRequestItems } from './shared';

/*
 * A request's row, its sends and its decisions are read in separate statements. A decision or a
 * send that lands between them can make one read see a status and a decision that disagree. The
 * read looks at such a request once more before calling its record incomplete.
 *
 * The moment between two statements of one read cannot be held open from outside (the read takes
 * no lock there to wait on), so the first part drives the read-again step with a controlled
 * reader that plays the two looks; the second part proves on a real database that a disagreement
 * which is really stored is still reported, at a bounded cost.
 */

const SENT = new Date('2026-11-01T10:00:00Z');
const DECIDED = new Date('2026-11-01T11:00:00Z');
const DOCUMENT = 'doc-earlier';

/** One document request with one pinned send of the earlier document. */
function history(id: string, status: string, decided: boolean): RequestHistory {
  return {
    request: {
      id,
      status,
      respondingId: DOCUMENT,
      respondedAt: SENT,
      agencyId: 'agency-1',
      agencyName: 'Sample Agency A',
      missionId: null,
      mission: null,
      createdAt: SENT,
    },
    sends: [
      {
        id: `send-${id}`,
        requestId: id,
        roundNo: 1,
        sentAt: SENT,
        subjectId: DOCUMENT,
        versionId: 'version-1',
        intact: true,
      },
    ],
    decisions: decided
      ? [
          {
            id: `decision-${id}`,
            requestId: id,
            outcome: 'ACCEPTED',
            decidedAt: DECIDED,
            subjectId: DOCUMENT,
            sendId: `send-${id}`,
          },
        ]
      : [],
  };
}

const rules: SendRules = {
  // As the document read judges it: an exact send of the earlier document, or one never pinned.
  carriesOf: (round) => (round.precision === 'pinned' ? 'EARLIER' : 'UNPINNED'),
  waitingSendMatches: () => true,
  carriedWithoutRecord: () => 'UNPINNED',
  waitsEvenOnCurrent: false,
  agenciesWithLiveShare: new Set(['agency-1']),
};

describe('a request whose status and decision disagree in one read', () => {
  it(
    'is read once more, all such requests together, and judged on the second look',
    async () => {
      // First look: the decisions were read after the agency accepted, the request rows before.
      // A torn look like that reads as an answer still waiting with no exact send behind it.
      const torn = await evidenceRequestItems(
        [history('torn-1', 'RECEIVED', true)],
        () => rules,
        async () => [history('torn-1', 'RECEIVED', true)],
      );
      expect(torn.map(({ item }) => item.reason)).toEqual(['SENT_BEFORE_EXACT_VERSIONS']);

      const first = [
        history('torn-1', 'RECEIVED', true),
        history('steady', 'RECEIVED', false),
        history('torn-2', 'RECEIVED', true),
        history('really-broken', 'NEEDS_REPLACEMENT', true),
      ];
      const asked: string[][] = [];
      const items = await evidenceRequestItems(
        first,
        () => rules,
        async (requestIds) => {
          asked.push([...requestIds]);
          // Second look: the two torn requests now show the accepted status; one request
          // really is stored that way.
          return [
            history('torn-1', 'ACCEPTED', true),
            history('torn-2', 'ACCEPTED', true),
            history('really-broken', 'NEEDS_REPLACEMENT', true),
          ];
        },
      );
      // One second look, for every doubtful request together, and not for the steady one.
      expect(asked).toEqual([['torn-1', 'torn-2', 'really-broken']]);
      expect(items.map(({ item }) => [item.id, item.reason])).toEqual([
        ['request:torn-1', 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK'],
        ['request:steady', 'AGENCY_CHECKING_EARLIER'],
        ['request:torn-2', 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK'],
        ['request:really-broken', 'RECORD_INCOMPLETE'],
      ]);
    },
    HEAVY,
  );

  it('reads nothing again when no request is doubtful, and drops a request that is gone', async () => {
    let looks = 0;
    const steady = await evidenceRequestItems(
      [history('steady', 'RECEIVED', false)],
      () => rules,
      async () => {
        looks += 1;
        return [];
      },
    );
    expect(looks).toBe(0);
    expect(steady).toHaveLength(1);
    const gone = await evidenceRequestItems(
      [history('torn', 'RECEIVED', true)],
      () => rules,
      async () => [],
    );
    expect(gone).toEqual([]);
  });

  it(
    'still reports a disagreement that is really stored, for one extra batch of statements',
    async () => {
      const w = await buildImpactWorld();
      await replaceWithNewerPassport(w);
      const proof = await ownerManage(w.db, w.rahim);
      const read = async () => {
        w.log.length = 0;
        const impact = must(
          await assessDocumentChangeImpact(proof, { documentId: w.p1.documentId }),
          'read',
        );
        return { impact, statements: w.log.length };
      };
      await read();
      const normal = await read();
      expect(itemOf(normal.impact, `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      // By hand: the request says "sent back" while its latest decision says accepted.
      await w.db.update(schema.evidenceRequests).set({ status: 'NEEDS_REPLACEMENT' });
      const doubtful = await read();
      expect(itemOf(doubtful.impact, `request:${w.documentRequestId}`).reason).toBe(
        'RECORD_INCOMPLETE',
      );
      // The second look is the request row, its sends and its decisions: three statements,
      // however many requests are doubtful.
      expect(doubtful.statements).toBe(normal.statements + 3);
    },
    HEAVY,
  );
});
