import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from '../access';
import type { AuthorizedApplicant } from '../access';
import { ACCESS_REFUSAL } from '../access/require-access';
import { revokeGrant } from '../sharing';
import { assessDetailChangeImpact } from './detail';
import { assessDocumentChangeImpact } from './document';
import {
  type AgencyHandle,
  HEAVY,
  type ImpactWorld,
  MADE_UP_ID,
  buildImpactWorld,
  changeEmploymentDetail,
  makeAgency,
  must,
  ownerManage,
  replaceWithNewerPassport,
  shapes,
  shareWith,
} from './scenario.test-support';

/*
 * Only the record's own traveller can read what a change affects. Everyone else, and every id
 * that is not theirs, gets the central gate's single refusal, with the same database work.
 */

const REFUSAL = { ok: false, error: { ...ACCESS_REFUSAL } };

describe('who may read what a change affects', () => {
  let w: ImpactWorld;
  let revoked: AgencyHandle;
  let expired: AgencyHandle;
  let owner: AuthorizedApplicant<'MANAGE'>;

  beforeAll(async () => {
    w = await buildImpactWorld();
    await replaceWithNewerPassport(w);
    await changeEmploymentDetail(w);
    revoked = await makeAgency(
      w.db,
      'owner@sample-agency-revoked.example.test',
      'Sample Agency Revoked',
    );
    const revokedShare = await shareWith(w.db, w.rahim, revoked);
    must(
      await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: revokedShare }),
      'revoke',
    );
    expired = await makeAgency(
      w.db,
      'owner@sample-agency-expired.example.test',
      'Sample Agency Expired',
    );
    const expiredShare = await shareWith(w.db, w.rahim, expired);
    // No service makes time pass: the share's end date is moved into the past by hand.
    await w.db
      .update(schema.grants)
      .set({ expiryAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.grants.id, expiredShare));
    owner = await ownerManage(w.db, w.rahim);
  }, HEAVY);

  /** The path a signed-in caller takes: the central gate first, then the read with its proof. */
  async function attempt(accountId: string, organizationId?: string) {
    const gate = await requireAccess(
      w.db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId: w.rahim.applicantId },
      organizationId
        ? { purpose: EACH_GRANT, actingFor: { organizationId } }
        : { purpose: 'change_impact' },
    );
    if (!gate.ok) return { gate: false, document: gate, detail: gate };
    return {
      gate: true,
      document: await assessDocumentChangeImpact(gate.value, { documentId: w.p1.documentId }),
      detail: await assessDetailChangeImpact(gate.value, { factId: w.e.factId }),
    };
  }

  it(
    'answers the owner',
    async () => {
      expect((await assessDocumentChangeImpact(owner, { documentId: w.p1.documentId })).ok).toBe(
        true,
      );
      expect((await assessDetailChangeImpact(owner, { factId: w.e.factId })).ok).toBe(true);
      // A proof for the document itself is enough for that document, and only for it.
      const forDocument = must(
        await requireAccess(
          w.db,
          accountPrincipal(w.rahim.accountId),
          'MANAGE',
          { documentId: w.p1.documentId },
          { purpose: 'change_impact' },
        ),
        'document proof',
      );
      expect(
        (await assessDocumentChangeImpact(forDocument, { documentId: w.p1.documentId })).ok,
      ).toBe(true);
      expect(
        await assessDocumentChangeImpact(forDocument, {
          documentId: w.controlDocument.documentId,
        }),
      ).toStrictEqual(REFUSAL);
      expect(await assessDetailChangeImpact(forDocument, { factId: w.e.factId })).toStrictEqual(
        REFUSAL,
      );
    },
    HEAVY,
  );

  it(
    'refuses a stranger and every agency identically, whatever share it holds or held',
    async () => {
      const callers: [string, string, string | undefined][] = [
        ['a stranger', w.stranger.accountId, undefined],
        ['Agency A, live whole-record share', w.agencyA.accountId, w.agencyA.organizationId],
        ['Agency B, live by-name share', w.agencyB.accountId, w.agencyB.organizationId],
        ['an agency whose share was revoked', revoked.accountId, revoked.organizationId],
        ['an agency whose share expired', expired.accountId, expired.organizationId],
        ['an unrelated agency', w.unrelatedAgency.accountId, w.unrelatedAgency.organizationId],
      ];
      const passedTheGate: string[] = [];
      for (const [label, accountId, organizationId] of callers) {
        const result = await attempt(accountId, organizationId);
        if (result.gate) passedTheGate.push(label);
        expect(result.document, label).toStrictEqual(REFUSAL);
        expect(result.detail, label).toStrictEqual(REFUSAL);
      }
      // Agency A's share does carry MANAGE, so the gate issues it a genuine proof: the read
      // itself is what refuses it. Agency A's acceptance is therefore visible to no agency,
      // not even Agency A through this read.
      expect(passedTheGate).toEqual(['Agency A, live whole-record share']);
    },
    HEAVY,
  );

  it(
    'refuses a proof that is not the owner MANAGE proof for the whole record',
    async () => {
      const view = must(
        await requireAccess(
          w.db,
          accountPrincipal(w.rahim.accountId),
          'VIEW_METADATA',
          { applicantId: w.rahim.applicantId },
          { purpose: 'change_impact' },
        ),
        'view proof',
      ) as unknown as AuthorizedApplicant<'MANAGE'>;
      const forCase = must(
        await requireAccess(
          w.db,
          accountPrincipal(w.rahim.accountId),
          'MANAGE',
          { missionId: w.liveCaseId },
          { purpose: 'change_impact' },
        ),
        'case proof',
      );
      const agencyBView = must(
        await requireAccess(
          w.db,
          accountPrincipal(w.agencyB.accountId),
          'VIEW_METADATA',
          { documentId: w.p1.documentId },
          { purpose: EACH_GRANT, actingFor: { organizationId: w.agencyB.organizationId } },
        ),
        'agency B view proof',
      ) as unknown as AuthorizedApplicant<'MANAGE'>;
      const copy = { ...owner } as AuthorizedApplicant<'MANAGE'>;
      for (const proof of [view, forCase, agencyBView, copy]) {
        expect(
          await assessDocumentChangeImpact(proof, { documentId: w.p1.documentId }),
        ).toStrictEqual(REFUSAL);
        expect(await assessDetailChangeImpact(proof, { factId: w.e.factId })).toStrictEqual(
          REFUSAL,
        );
      }
    },
    HEAVY,
  );

  it(
    'gives a made-up id and a real id of someone else the same answer and the same database work',
    async () => {
      const strangerProof = await ownerManage(w.db, w.stranger);
      const logOf = async <T>(run: () => Promise<T>): Promise<{ result: T; sent: string[] }> => {
        w.log.length = 0;
        const result = await run();
        return { result, sent: shapes(w.log) };
      };
      const pairs = [
        // The traveller asks about a made-up id, then about a stranger's real record.
        [
          () => assessDocumentChangeImpact(owner, { documentId: MADE_UP_ID }),
          () => assessDocumentChangeImpact(owner, { documentId: w.strangerDocumentId }),
        ],
        [
          () => assessDetailChangeImpact(owner, { factId: MADE_UP_ID }),
          () => assessDetailChangeImpact(owner, { factId: w.strangerFactId }),
        ],
        // A stranger, holding a genuine proof for their own record, asks about the traveller's.
        [
          () => assessDocumentChangeImpact(strangerProof, { documentId: MADE_UP_ID }),
          () => assessDocumentChangeImpact(strangerProof, { documentId: w.p1.documentId }),
        ],
        [
          () => assessDetailChangeImpact(strangerProof, { factId: MADE_UP_ID }),
          () => assessDetailChangeImpact(strangerProof, { factId: w.e.factId }),
        ],
        // A preview that names a made-up newer document, then a stranger's real one.
        [
          () =>
            assessDocumentChangeImpact(owner, {
              documentId: w.controlDocument.documentId,
              replacementDocumentId: MADE_UP_ID,
            }),
          () =>
            assessDocumentChangeImpact(owner, {
              documentId: w.controlDocument.documentId,
              replacementDocumentId: w.strangerDocumentId,
            }),
        ],
      ] as const;
      for (const [madeUp, foreign] of pairs) {
        const made = await logOf(madeUp);
        const real = await logOf(foreign);
        expect(made.result).toStrictEqual(REFUSAL);
        expect(real.result).toStrictEqual(made.result);
        expect(real.sent).toEqual(made.sent);
        // The lookup really ran, scoped to the caller's own record.
        expect(made.sent.some((statement) => statement.includes('"applicant_id" = $2'))).toBe(true);
      }
      // An id that is not an id at all is refused the same way.
      expect(await assessDocumentChangeImpact(owner, { documentId: 'not-an-id' })).toStrictEqual(
        REFUSAL,
      );
      expect(await assessDetailChangeImpact(owner, { factId: 'not-an-id' })).toStrictEqual(REFUSAL);
    },
    HEAVY,
  );

  it(
    'hands back a fresh refusal each time, so one caller cannot change the next answer',
    async () => {
      const first = await assessDetailChangeImpact(owner, { factId: MADE_UP_ID });
      if (first.ok) throw new Error('expected a refusal');
      (first.error as { message: string }).message = 'tampered';
      expect(await assessDetailChangeImpact(owner, { factId: MADE_UP_ID })).toStrictEqual(REFUSAL);
    },
    HEAVY,
  );
});
