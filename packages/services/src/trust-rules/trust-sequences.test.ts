import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AuthorizedApplicant } from '../access';
import { evidenceSubmissionStillCovers } from '../access/evidence-submission-access';
import {
  cancelEvidenceRequest,
  decideEvidenceResponse,
  requestEvidence,
  startEvidenceReview,
} from '../agency';
import type { Db } from '../db';
import { confirmEvidenceAnswers, planEvidenceAnswers } from '../evidence-answer-plan';
import {
  type Agency,
  FakeStorage,
  type Traveller,
  addVersion,
  agency,
  agencyProof,
  cleanDocument,
  freshDb,
  ownerProof,
  send,
  share,
  traveller,
} from '../evidence-submissions.test-support';
import { revokeGrant } from '../sharing';
import {
  type SubmissionRow,
  allSubmissions,
  downloadWith,
  mulberry32,
  randomId,
} from './trust-rules.test-support';

/**
 * Randomized sequences against the real services. Each seed runs 40 random steps on one migrated
 * database with one traveller, two agencies that both start with a grant, and a third agency with
 * no grant at all. After every step the trust invariants are checked. On a failure the seed and
 * the steps so far are printed, so the run can be replayed by running that one seed again.
 */

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233] as const;
const STEPS = 40;
const SEED_TIMEOUT = 180_000;
const DOC_TYPES = ['bank_statement', 'invitation_letter'] as const;

interface Doc {
  readonly documentId: string;
  readonly docType: string;
  readonly versions: { versionId: string; objectKey: string }[];
}

interface Side {
  readonly agency: Agency;
  /** A proof made while the grant was live; it is replayed after the grant ends. */
  proof: AuthorizedApplicant<'MANAGE'>;
  grantId: string;
  live: boolean;
}

class Run {
  readonly rng: () => number;
  readonly steps: string[] = [];
  readonly storage = new FakeStorage();
  readonly docs: Doc[] = [];
  readonly objectKeyOf = new Map<string, string>();
  readonly snapshots = new Map<string, SubmissionRow>();
  readonly sides: Side[] = [];
  readonly requests: { id: string; side: number; docType: string }[] = [];
  lastSend: { requestId: string; documentId: string; versionId: string; key: string } | undefined;
  successfulSends = 0;
  keyCounter = 0;

  constructor(
    readonly seed: number,
    readonly db: Db,
    readonly rahim: Traveller,
    readonly unrelated: Agency,
  ) {
    this.rng = mulberry32(seed);
  }

  pick<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(this.rng() * items.length)];
  }

  chance(p: number): boolean {
    return this.rng() < p;
  }

  async newDoc(docType: string): Promise<Doc> {
    const sha = (this.docs.length + 16).toString(16).padStart(2, '0').repeat(32);
    const created = await cleanDocument(
      this.db,
      this.rahim,
      docType,
      `file-${this.docs.length}.pdf`,
      sha,
    );
    const doc: Doc = {
      documentId: created.documentId,
      docType,
      versions: [{ versionId: created.versionId, objectKey: created.objectKey }],
    };
    this.objectKeyOf.set(created.versionId, created.objectKey);
    this.docs.push(doc);
    return doc;
  }
}

async function openStatuses(run: Run, statuses: readonly string[]) {
  const rows = await run.db
    .select()
    .from(schema.evidenceRequests)
    .where(
      inArray(
        schema.evidenceRequests.id,
        run.requests.map((r) => r.id),
      ),
    );
  return rows.filter((r) => statuses.includes(r.status));
}

type StepFn = (run: Run) => Promise<void>;

const STEP_LIST: readonly { name: string; weight: number; run: StepFn }[] = [
  {
    name: 'ask',
    weight: 5,
    run: async (run) => {
      const index = run.rng() < 0.5 ? 0 : 1;
      const side = run.sides[index];
      if (!side) return;
      const docType = run.pick(DOC_TYPES) ?? 'bank_statement';
      run.steps.push(`ask side=${index} type=${docType} live=${side.live}`);
      const result = await requestEvidence(run.db, {
        actorAccountId: side.agency.accountId,
        organizationId: side.agency.organizationId,
        applicantId: run.rahim.applicantId,
        kind: 'DOCUMENT',
        docType,
        message: 'please send',
      });
      if (side.live) {
        expect(isOk(result), 'an agency with a live grant can ask').toBe(true);
        if (isOk(result)) run.requests.push({ id: result.value.id, side: index, docType });
      } else {
        expect(isErr(result), 'an agency whose grant ended cannot ask').toBe(true);
      }
    },
  },
  {
    name: 'answer',
    weight: 10,
    run: async (run) => {
      const waiting = await openStatuses(run, ['OPEN', 'NEEDS_REPLACEMENT']);
      const request = run.pick(waiting);
      if (!request) {
        run.steps.push('answer (nothing waiting)');
        return;
      }
      const meta = run.requests.find((r) => r.id === request.id);
      const side = meta ? run.sides[meta.side] : undefined;
      const docs = run.docs.filter((d) => d.docType === meta?.docType);
      const doc = run.pick(docs);
      if (!meta || !side || !doc) {
        run.steps.push('answer (no matching document)');
        return;
      }
      const exact = run.chance(0.4) ? run.pick(doc.versions) : undefined;
      run.keyCounter += 1;
      const key = `seq-${run.seed}-${run.keyCounter}-key-0000`;
      run.steps.push(
        `answer request=${meta.id.slice(0, 8)} doc=${run.docs.indexOf(doc)} exact=${exact ? doc.versions.indexOf(exact) : '-'} live=${side.live}`,
      );
      const result = await send(run.db, run.rahim, meta.id, doc.documentId, {
        idempotencyKey: key,
        ...(exact ? { documentVersionId: exact.versionId } : {}),
      });
      if (side.live) {
        expect(isOk(result), 'the owner can answer while the agency holds a grant').toBe(true);
        if (isOk(result)) {
          expect(result.value.replayed).toBe(false);
          run.successfulSends += 1;
          const version = exact ?? doc.versions.at(-1);
          run.lastSend = {
            requestId: meta.id,
            documentId: doc.documentId,
            versionId: version?.versionId ?? '',
            key,
          };
        }
      } else {
        expect(isErr(result), 'nothing is sent to an agency whose grant ended').toBe(true);
      }
    },
  },
  {
    // Answer From Your Records: everything one agency waits for, in one confirmation. Whatever
    // the plan offers is sent as that exact version; the same confirmation again sends nothing;
    // an agency whose grant ended is offered nothing and receives nothing even when pressed.
    name: 'review',
    weight: 12,
    run: async (run) => {
      const index = run.rng() < 0.5 ? 0 : 1;
      const side = run.sides[index];
      if (!side) return;
      const planned = await planEvidenceAnswers(await ownerProof(run.db, run.rahim));
      if (!isOk(planned)) throw new Error('the owner can always read the plan');
      const group = planned.value.agencies.find(
        (g) => g.organizationId === side.agency.organizationId,
      );
      run.keyCounter += 1;
      const key = `r${run.seed}c${run.keyCounter}`.padEnd(24, 'x');
      if (!side.live) {
        expect(group?.canReceive ?? false, 'an ended agency can receive nothing').toBe(false);
        const waiting = (await openStatuses(run, ['OPEN', 'NEEDS_REPLACEMENT'])).filter(
          (r) => r.organizationId === side.agency.organizationId,
        );
        const request = run.pick(waiting);
        const doc = run.pick(run.docs.filter((d) => d.docType === request?.docType));
        const version = doc?.versions.at(-1);
        run.steps.push(`review side=${index} ended, forced=${request ? 'yes' : 'no'}`);
        if (!request || !doc || !version) return;
        const forced = await confirmEvidenceAnswers(await ownerProof(run.db, run.rahim), {
          organizationId: side.agency.organizationId,
          confirmationKey: key,
          answers: [
            {
              requestId: request.id,
              documentId: doc.documentId,
              documentVersionId: version.versionId,
            },
          ],
        });
        if (!isOk(forced)) throw new Error('a forced confirmation still answers');
        expect(forced.value.sent, 'nothing goes to an agency whose grant ended').toBe(0);
        totals.reviewRefusals += 1;
        return;
      }
      const answers = (group?.items ?? []).flatMap((item) => {
        const copy = item.copies.find((candidate) => candidate.sendable);
        return copy
          ? [
              {
                requestId: item.requestId,
                documentId: copy.documentId,
                documentVersionId: copy.versionId,
              },
            ]
          : [];
      });
      run.steps.push(`review side=${index} live, answers=${answers.length}`);
      if (answers.length === 0) return;
      const confirm = async () => {
        const result = await confirmEvidenceAnswers(await ownerProof(run.db, run.rahim), {
          organizationId: side.agency.organizationId,
          confirmationKey: key,
          answers,
        });
        if (!isOk(result)) throw new Error(`confirm: ${result.error.message}`);
        return result.value;
      };
      const first = await confirm();
      expect(first.sent, 'every offered copy is sent').toBe(answers.length);
      run.successfulSends += first.sent;
      totals.reviewSends += first.sent;
      const pinned = new Map(
        (await allSubmissions(run.db)).map((row) => [row.id, row.documentVersionId] as const),
      );
      first.outcomes.forEach((outcome, at) => {
        if (outcome.outcome !== 'SENT') throw new Error('expected SENT');
        expect(pinned.get(outcome.submissionId), 'the reviewed version is the one pinned').toBe(
          answers[at]?.documentVersionId,
        );
      });
      const again = await confirm();
      expect(again.sent, 'the same confirmation sends nothing twice').toBe(0);
      expect(again.alreadySent).toBe(answers.length);
      const last = answers.at(-1);
      if (last) {
        run.lastSend = {
          requestId: last.requestId,
          documentId: last.documentId,
          versionId: last.documentVersionId,
          key: `${key}_${last.requestId}`,
        };
      }
    },
  },
  {
    name: 'upload',
    weight: 4,
    run: async (run) => {
      const doc = run.pick(run.docs);
      if (doc && run.chance(0.6)) {
        run.steps.push(`upload newer version doc=${run.docs.indexOf(doc)}`);
        const sha = (run.docs.length * 7 + doc.versions.length + 32)
          .toString(16)
          .padStart(2, '0')
          .repeat(32);
        const added = await addVersion(run.db, run.rahim, doc.documentId, { sha256: sha });
        doc.versions.push({ versionId: added.versionId, objectKey: added.objectKey });
        run.objectKeyOf.set(added.versionId, added.objectKey);
      } else {
        const docType = run.pick(DOC_TYPES) ?? 'bank_statement';
        run.steps.push(`upload replacement type=${docType}`);
        await run.newDoc(docType);
      }
    },
  },
  {
    name: 'decide',
    weight: 5,
    run: async (run) => {
      const waiting = await openStatuses(run, ['RECEIVED', 'UNDER_REVIEW']);
      const request = run.pick(waiting);
      const meta = request ? run.requests.find((r) => r.id === request.id) : undefined;
      const side = meta ? run.sides[meta.side] : undefined;
      if (!request || !meta || !side) {
        run.steps.push('decide (nothing waiting)');
        return;
      }
      const outcome = run.chance(0.6) ? 'ACCEPTED' : 'NEEDS_REPLACEMENT';
      run.steps.push(`decide request=${meta.id.slice(0, 8)} ${outcome} live=${side.live}`);
      const result = await decideEvidenceResponse(run.db, {
        actorAccountId: side.agency.accountId,
        requestId: meta.id,
        outcome,
        ...(outcome === 'ACCEPTED' ? {} : { reason: 'does not stand' }),
      });
      if (side.live) expect(isOk(result), 'a live agency can decide').toBe(true);
      else expect(isErr(result), 'an agency whose grant ended cannot decide').toBe(true);
    },
  },
  {
    name: 'revoke',
    weight: 2,
    run: async (run) => {
      const index = run.rng() < 0.5 ? 0 : 1;
      const side = run.sides[index];
      run.steps.push(`revoke side=${index} live=${side?.live}`);
      if (!side?.live) return;
      const result = await revokeGrant(run.db, {
        actorAccountId: run.rahim.accountId,
        grantId: side.grantId,
      });
      expect(isOk(result)).toBe(true);
      side.live = false;
    },
  },
  {
    name: 'share again',
    weight: 2,
    run: async (run) => {
      const index = run.rng() < 0.5 ? 0 : 1;
      const side = run.sides[index];
      run.steps.push(`share-again side=${index} live=${side?.live}`);
      if (!side || side.live) return;
      side.grantId = await share(run.db, run.rahim, side.agency);
      side.live = true;
    },
  },
  {
    name: 'retry last send',
    weight: 3,
    run: async (run) => {
      const last = run.lastSend;
      if (!last) {
        run.steps.push('retry (no send yet)');
        return;
      }
      run.steps.push(`retry request=${last.requestId.slice(0, 8)}`);
      const before = (await allSubmissions(run.db)).length;
      const result = await send(run.db, run.rahim, last.requestId, last.documentId, {
        idempotencyKey: last.key,
        documentVersionId: last.versionId,
      });
      // A retry is never a new send: it is answered with the first one, or refused.
      if (isOk(result)) expect(result.value.replayed, 'a retry is a replay').toBe(true);
      expect((await allSubmissions(run.db)).length).toBe(before);
    },
  },
  {
    name: 'probe',
    weight: 3,
    run: async (run) => {
      run.steps.push('probe by the unrelated agency');
      await probe(run);
    },
  },
];

/** The unrelated agency asks about a real request and a made-up one: one and the same answer. */
async function probe(run: Run): Promise<void> {
  const real = run.pick(run.requests)?.id ?? randomId();
  const callsBefore = run.storage.calls.length;
  const actor = run.unrelated.accountId;
  for (const entry of [startEvidenceReview, cancelEvidenceRequest] as const) {
    const onReal = await entry(run.db, { actorAccountId: actor, requestId: real });
    const onMadeUp = await entry(run.db, { actorAccountId: actor, requestId: randomId() });
    expect(isErr(onReal)).toBe(true);
    expect(onReal, 'the unrelated agency cannot tell a real request from a made-up one').toEqual(
      onMadeUp,
    );
  }
  const decideOn = (requestId: string) =>
    decideEvidenceResponse(run.db, { actorAccountId: actor, requestId, outcome: 'ACCEPTED' });
  expect(await decideOn(real)).toEqual(await decideOn(randomId()));
  expect(run.storage.calls.length).toBe(callsBefore);
}

async function checkInvariants(run: Run): Promise<void> {
  const rows = await allSubmissions(run.db);
  // Rules 4 and 6: one submission per successful owner send, never more.
  expect(rows.length, 'submissions equal successful owner sends').toBe(run.successfulSends);
  // Rules 2 and 5: every copy ever sent is byte-identical to how it was first seen.
  for (const row of rows) {
    const earlier = run.snapshots.get(row.id);
    if (earlier) expect(row, `submission ${row.id} changed`).toEqual(earlier);
    else run.snapshots.set(row.id, structuredClone(row));
  }
  expect(run.snapshots.size).toBe(rows.length);

  const requestSide = new Map(run.requests.map((r) => [r.id, r.side]));
  for (const row of rows) {
    const index = requestSide.get(row.evidenceRequestId);
    const side = index === undefined ? undefined : run.sides[index];
    if (!side) continue;
    const callsBefore = run.storage.calls.length;
    const result = await downloadWith(run.storage, side.proof, side.agency, row);
    if (!side.live) {
      // Rule 1: ended access never yields a fresh read.
      expect(isErr(result), `download of ${row.id} after the grant ended`).toBe(true);
      expect(run.storage.calls.length, 'no storage call after the grant ended').toBe(callsBefore);
      const covers = await evidenceSubmissionStillCovers(run.db, {
        submissionId: row.id,
        accountId: side.agency.accountId,
        organizationId: side.agency.organizationId,
        documentId: row.documentId,
        documentVersionId: row.documentVersionId,
      });
      expect(covers.allowed, 'a link minted earlier is refused after the grant ended').toBe(false);
    } else if (isOk(result)) {
      // Rule 2: a download that is allowed names the pinned version's own object.
      expect(run.storage.calls.length).toBe(callsBefore + 1);
      expect(run.storage.calls.at(-1)?.objectKey, 'the pinned object is served').toBe(
        run.objectKeyOf.get(row.documentVersionId),
      );
    } else {
      expect(run.storage.calls.length).toBe(callsBefore);
    }
  }

  // Rule 3: the unrelated agency's answers for a real id and a made-up id are the same.
  await probe(run);
}

const totals = { sends: 0, accepts: 0, revokes: 0, reviewSends: 0, reviewRefusals: 0 };

describe('Randomized trust sequences', () => {
  for (const seed of SEEDS) {
    it(
      `seed ${seed}: ${STEPS} random steps keep every invariant`,
      async () => {
        const db = await freshDb();
        const rahim = await traveller(db, 'test-rahim-synthetic@example.test');
        const north = await agency(db, 'test-north-owner@example.test', 'TEST Agency North');
        const east = await agency(db, 'test-east-owner@example.test', 'TEST Agency East');
        const unrelated = await agency(
          db,
          'test-unrelated-owner@example.test',
          'TEST Agency Unrelated',
        );
        const run = new Run(seed, db, rahim, unrelated);
        run.steps.push('setup: grants for north and east');
        for (const a of [north, east]) {
          const grantId = await share(db, rahim, a);
          run.sides.push({
            agency: a,
            proof: await agencyProof(db, a, rahim.applicantId),
            grantId,
            live: true,
          });
        }
        // Two starting documents, one of each kind.
        await run.newDoc('bank_statement');
        await run.newDoc('invitation_letter');

        const total = STEP_LIST.reduce((sum, s) => sum + s.weight, 0);
        try {
          for (let i = 0; i < STEPS; i += 1) {
            let roll = run.rng() * total;
            let chosen = STEP_LIST[0];
            for (const candidate of STEP_LIST) {
              roll -= candidate.weight;
              if (roll < 0) {
                chosen = candidate;
                break;
              }
            }
            if (!chosen) throw new Error('no step');
            await chosen.run(run);
            await checkInvariants(run);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `trust sequence failed. seed=${seed}\nsteps:\n${run.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n${message}`,
            { cause: error },
          );
        }
        // The run did real work, not just probes.
        expect(run.steps.length).toBeGreaterThan(STEPS - 1);
        totals.sends += run.successfulSends;
        totals.accepts += run.steps.filter((x) => x.includes(' ACCEPTED live=true')).length;
        totals.revokes += run.steps.filter(
          (x) => x.startsWith('revoke') && x.endsWith('live=true'),
        ).length;
      },
      SEED_TIMEOUT,
    );
  }

  it('the seeds together sent, accepted and revoked, so the invariants were tested on real activity', () => {
    expect(totals.sends).toBeGreaterThan(20);
    expect(totals.accepts).toBeGreaterThan(5);
    expect(totals.revokes).toBeGreaterThan(5);
    // The one-confirmation step did real work too: copies went, and ended agencies were refused.
    expect(totals.reviewSends).toBeGreaterThan(10);
    expect(totals.reviewRefusals).toBeGreaterThan(0);
  });
});
