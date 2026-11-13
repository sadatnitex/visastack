import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { staffPrincipal } from '../access/principal';
import { provisionAccount } from '../accounts';
import { cancelEvidenceRequest } from '../agency';
import { replaceDocument } from '../lifecycle/replace';
import { unselectEvidence } from '../missions';
import { addPackVersion, addRequirement, approvePackVersion, publishPackVersion } from '../packs';
import { grantPlatformRole } from '../platform-roles';
import { revokeGrant } from '../sharing';
import { recordPackageChoice } from '../umpe-package-service';
import { assessRuleImpact } from '../umpe-rule-impact-service';
import { SAME_DOCUMENT, assessDocumentChangeImpact } from './document';
import {
  AGENCY_A_NAME,
  AGENCY_B_NAME,
  CONTROL_TYPE,
  FINISHED_CASE_TITLE,
  HEAVY,
  LIVE_CASE_TITLE,
  MADE_UP_ID,
  PASSPORT_TYPE,
  askForDocument,
  buildImpactWorld,
  cancelCase,
  confirmCase,
  decide,
  historyFingerprint,
  itemOf,
  makeCase,
  makeDocument,
  must,
  ownerManage,
  readDocumentImpact,
  reasons,
  replaceWithNewerPassport,
  sendDocument,
  shareWith,
  tablesRead,
} from './scenario.test-support';

describe('replacing a document: the shared scenario', () => {
  it(
    'names every consequence, before and after the replacement is recorded',
    async () => {
      const w = await buildImpactWorld();
      const expected = [
        [`case:${w.liveCaseId}`, 'LIVE_CASE_USES_REPLACED_DOCUMENT'],
        [`share:${w.agencyBShareId}`, 'SHARE_COVERS_EARLIER_ONLY'],
        [`request:${w.documentRequestId}`, 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK'],
        [`case:${w.finishedCaseId}`, 'FINISHED_CASE_KEPT'],
        [`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS'],
      ];
      const historyBefore = await historyFingerprint(w.db);

      // Before: what recording the replacement would mean.
      const preview = await readDocumentImpact(w);
      expect(preview.phase).toBe('PREVIEW');
      expect(preview.subject).toEqual({
        kind: 'DOCUMENT',
        documentId: w.p1.documentId,
        title: 'sample-passport-older.pdf',
        replacement: null,
      });
      expect(reasons(preview)).toEqual(expected);

      // A preview that names the newer document says the same about the by-name share.
      const candidate = await makeDocument(w.db, w.rahim, PASSPORT_TYPE, 'sample-candidate.pdf');
      const named = await readDocumentImpact(w, w.p1.documentId, candidate.documentId);
      expect(named.phase).toBe('PREVIEW');
      expect(named.subject).toMatchObject({
        replacement: { documentId: candidate.documentId, title: 'sample-candidate.pdf' },
      });
      expect(reasons(named)).toEqual(expected);

      // After: the same consequences, now recorded.
      const { newer } = await replaceWithNewerPassport(w);
      const recorded = await readDocumentImpact(w);
      expect(recorded.phase).toBe('RECORDED');
      expect(recorded.subject).toMatchObject({
        replacement: { documentId: newer.documentId, title: 'sample-passport-newer.pdf' },
      });
      expect(reasons(recorded)).toEqual(expected);
      expect(recorded.counts).toEqual({
        ACTION_REQUIRED: 1,
        REVIEW_RECOMMENDED: 2,
        UNKNOWN: 0,
        HISTORY_PRESERVED: 1,
        NO_ACTION: 1,
      });
      expect(recorded.quiet).toBe(false);
      expect(recorded.complete).toBe(true);

      // 1. The live case: a step is needed, and it is offered in the case itself.
      expect(itemOf(recorded, `case:${w.liveCaseId}`)).toEqual({
        id: `case:${w.liveCaseId}`,
        outcome: 'ACTION_REQUIRED',
        reason: 'LIVE_CASE_USES_REPLACED_DOCUMENT',
        area: 'CASES',
        about: { kind: 'CASE', missionId: w.liveCaseId, title: LIVE_CASE_TITLE, live: true },
        nextStep: { kind: 'OPEN_CASE', missionId: w.liveCaseId },
      });
      // 2. Agency A accepted the earlier copy and its work is live.
      const request = itemOf(recorded, `request:${w.documentRequestId}`);
      expect(request).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        area: 'AGENCY_REQUESTS',
        about: {
          kind: 'AGENCY_REQUEST',
          source: 'EVIDENCE_REQUEST',
          requestId: w.documentRequestId,
          organizationId: w.agencyA.organizationId,
          organizationName: AGENCY_A_NAME,
          missionId: w.liveCaseId,
          caseTitle: LIVE_CASE_TITLE,
        },
        nextStep: { kind: 'OPEN_REQUEST', requestId: w.documentRequestId },
      });
      if (request.about.kind !== 'AGENCY_REQUEST') throw new Error('kind');
      expect(request.about.sentAt).toBeInstanceOf(Date);
      expect(request.about.decidedAt).toBeInstanceOf(Date);
      // 3. Agency B's share lists the earlier passport by name.
      expect(itemOf(recorded, `share:${w.agencyBShareId}`)).toEqual({
        id: `share:${w.agencyBShareId}`,
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'SHARE_COVERS_EARLIER_ONLY',
        area: 'SHARING',
        about: {
          kind: 'SHARE',
          grantId: w.agencyBShareId,
          recipientKind: 'ORGANIZATION',
          recipientName: AGENCY_B_NAME,
          reach: 'BY_NAME',
        },
        nextStep: { kind: 'OPEN_SHARING', grantId: w.agencyBShareId },
      });
      // 4. The finished case keeps what it used; nothing is asked.
      expect(itemOf(recorded, `case:${w.finishedCaseId}`)).toEqual({
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
      // The wider share already covers the newer passport: said, with nothing to do.
      expect(itemOf(recorded, `share:${w.agencyAShareId}`)).toMatchObject({
        outcome: 'NO_ACTION',
        about: { reach: 'WHOLE_RECORD', recipientName: AGENCY_A_NAME },
        nextStep: null,
      });

      // History is byte-identical after the change and every read.
      expect(await historyFingerprint(w.db)).toBe(historyBefore);
    },
    HEAVY,
  );

  it(
    'keeps one agency out of another agency item, and reads no record of anyone opening anything',
    async () => {
      const w = await buildImpactWorld();
      await replaceWithNewerPassport(w);
      const proof = await ownerManage(w.db, w.rahim);
      w.log.length = 0;
      const impact = must(
        await assessDocumentChangeImpact(proof, { documentId: w.p1.documentId }),
        'impact',
      );
      const statements = [...w.log];

      // Sharing is not viewing: the read touches no audit trail, access record or notice, so no
      // item can rest on what a recipient opened. The two checklist tables are read by the
      // access layer's own "live answer" rule (`liveCollectionResponse`): whether an answer was
      // withdrawn and whether its request was revoked, never what the agency decided.
      expect(tablesRead(statements)).toEqual([
        'accounts',
        'acknowledgements',
        'agency_collection_requests',
        'agency_collection_response_items',
        'agency_collection_response_withdrawals',
        'agency_collection_responses',
        'document_lifecycle',
        'document_versions',
        'documents',
        'evidence_request_decision_submissions',
        'evidence_request_decisions',
        'evidence_request_submissions',
        'evidence_requests',
        'grants',
        'mission_snapshots',
        'missions',
        'organizations',
        'selected_evidence',
        'umpe_package_choices',
      ]);
      expect(statements.join('\n')).not.toMatch(
        /audit_events|notification|access_log|product_events/,
      );

      // Agency B's item says nothing of Agency A, its request, or its acceptance.
      const forB = JSON.stringify(itemOf(impact, `share:${w.agencyBShareId}`));
      for (const leak of [
        w.agencyA.organizationId,
        AGENCY_A_NAME,
        w.documentRequestId,
        w.detailRequestId,
        w.agencyAShareId,
        'ACCEPTED',
      ]) {
        expect(forB).not.toContain(leak);
      }
      // And Agency A's request item says nothing of Agency B.
      const forA = JSON.stringify(itemOf(impact, `request:${w.documentRequestId}`));
      for (const leak of [w.agencyB.organizationId, AGENCY_B_NAME, w.agencyBShareId]) {
        expect(forA).not.toContain(leak);
      }
    },
    HEAVY,
  );
});

describe('replacing a document an agency accepted earlier', () => {
  it(
    'is history once that work is over: the case finished, or no case and no live share',
    async () => {
      const w = await buildImpactWorld();
      // A second case Agency A worked on, later cancelled.
      const otherCase = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Cancelled Case',
        confirm: false,
      });
      const onOtherCase = await askForDocument(w.db, w.agencyA, w.rahim, otherCase);
      await sendDocument(w.db, w.rahim, onOtherCase, w.p1.documentId);
      await decide(w.db, w.agencyA, onOtherCase, 'ACCEPTED');
      // A request that names no case.
      const noCase = await askForDocument(w.db, w.agencyA, w.rahim);
      await sendDocument(w.db, w.rahim, noCase, w.p1.documentId);
      await decide(w.db, w.agencyA, noCase, 'ACCEPTED');
      await cancelCase(w.db, w.rahim, otherCase);
      await replaceWithNewerPassport(w);

      const live = await readDocumentImpact(w);
      expect(itemOf(live, `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      const finished = itemOf(live, `request:${onOtherCase}`);
      expect(finished).toMatchObject({
        outcome: 'HISTORY_PRESERVED',
        reason: 'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK',
        nextStep: null,
      });
      // No case named, and Agency A still holds a live share: its work is live.
      expect(itemOf(live, `request:${noCase}`)).toMatchObject({
        reason: 'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
        about: { missionId: null, caseTitle: null },
      });

      // Judged after Agency A's share has run out by date, the request with no case is already
      // finished work: an ended share is not a live one.
      const muchLater = must(
        await assessDocumentChangeImpact(
          await ownerManage(w.db, w.rahim),
          { documentId: w.p1.documentId },
          { now: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) },
        ),
        'later',
      );
      expect(itemOf(muchLater, `request:${noCase}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK',
      );

      // The share ends: the request with no case is now finished work; the one on the live
      // case stays live work, because the case is.
      must(
        await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: w.agencyAShareId }),
        'revoke',
      );
      const after = await readDocumentImpact(w);
      expect(itemOf(after, `request:${noCase}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_FINISHED_WORK',
      );
      expect(itemOf(after, `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      expect(after.items.some((item) => item.id === `share:${w.agencyAShareId}`)).toBe(false);
    },
    HEAVY,
  );
});

describe('replacing a document covered by a live share', () => {
  it(
    'tells a by-name share from a wider one, and never lists an ended share',
    async () => {
      const w = await buildImpactWorld();
      const person = { accountId: w.stranger.accountId };
      const byNamePerson = await shareWith(w.db, w.rahim, person, {
        actions: ['VIEW_METADATA', 'PREVIEW'],
        documentIds: [w.p1.documentId],
      });
      const otherDocument = await shareWith(w.db, w.rahim, w.unrelatedAgency, {
        actions: ['VIEW_METADATA', 'PREVIEW'],
        documentIds: [w.controlDocument.documentId],
      });

      const preview = await readDocumentImpact(w);
      expect(itemOf(preview, `share:${w.agencyBShareId}`).reason).toBe('SHARE_COVERS_EARLIER_ONLY');
      expect(itemOf(preview, `share:${w.agencyAShareId}`).reason).toBe('SHARE_ALREADY_COVERS');
      expect(itemOf(preview, `share:${byNamePerson}`)).toMatchObject({
        reason: 'SHARE_COVERS_EARLIER_ONLY',
        about: { recipientKind: 'PERSON', reach: 'BY_NAME' },
      });
      // A share that does not reach this document is not listed at all.
      expect(preview.items.some((item) => item.id === `share:${otherDocument}`)).toBe(false);

      const { newer } = await replaceWithNewerPassport(w);
      // A new share that names both passports already covers the newer one.
      const both = await shareWith(w.db, w.rahim, w.unrelatedAgency, {
        actions: ['VIEW_METADATA', 'PREVIEW'],
        documentIds: [w.p1.documentId, newer.documentId],
      });
      const recorded = await readDocumentImpact(w);
      expect(itemOf(recorded, `share:${both}`)).toMatchObject({
        reason: 'SHARE_ALREADY_COVERS',
        about: { reach: 'BY_NAME' },
      });
      expect(itemOf(recorded, `share:${w.agencyBShareId}`).reason).toBe(
        'SHARE_COVERS_EARLIER_ONLY',
      );

      // Revoked: gone. Expired (judged at a later moment): gone.
      must(
        await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: w.agencyBShareId }),
        'revoke',
      );
      const afterRevoke = await readDocumentImpact(w);
      expect(afterRevoke.items.some((item) => item.id === `share:${w.agencyBShareId}`)).toBe(false);
      expect(itemOf(afterRevoke, `share:${byNamePerson}`).reason).toBe('SHARE_COVERS_EARLIER_ONLY');
      // Judged at a moment after every share has ended: none is listed.
      const muchLater = must(
        await assessDocumentChangeImpact(
          await ownerManage(w.db, w.rahim),
          { documentId: w.p1.documentId },
          { now: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) },
        ),
        'later',
      );
      expect(muchLater.items.filter((item) => item.area === 'SHARING')).toEqual([]);
      // With no live share left, Agency A's accepted copy on the live case is still live work.
      expect(itemOf(muchLater, `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
    },
    HEAVY,
  );
});

describe('two replacements close together', () => {
  it(
    'follows the chain to its end while each item stays about the copy it concerns',
    async () => {
      const w = await buildImpactWorld();
      const first = await replaceWithNewerPassport(w);
      const second = await replaceWithNewerPassport(
        w,
        first.newer.documentId,
        'sample-passport-newest.pdf',
      );

      const impact = await readDocumentImpact(w);
      expect(impact.phase).toBe('RECORDED');
      expect(impact.subject).toMatchObject({
        documentId: w.p1.documentId,
        replacement: { documentId: second.newer.documentId, title: 'sample-passport-newest.pdf' },
      });
      // Agency A's item is still about the copy of the first passport it accepted.
      const request = itemOf(impact, `request:${w.documentRequestId}`);
      expect(request.reason).toBe('AGENCY_ACCEPTED_EARLIER_LIVE_WORK');
      // The live case still selects the first passport.
      expect(itemOf(impact, `case:${w.liveCaseId}`).reason).toBe(
        'LIVE_CASE_USES_REPLACED_DOCUMENT',
      );
      expect(itemOf(impact, `share:${w.agencyBShareId}`).reason).toBe('SHARE_COVERS_EARLIER_ONLY');

      // The middle passport is itself replaced; nothing used it, so only the wider share shows.
      const middle = await readDocumentImpact(w, first.newer.documentId);
      expect(middle.phase).toBe('RECORDED');
      expect(middle.subject).toMatchObject({
        replacement: { documentId: second.newer.documentId },
      });
      expect(reasons(middle)).toEqual([[`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS']]);
      expect(middle.quiet).toBe(true);

      // The newest passport has no replacement: a preview with nothing to act on.
      const newest = await readDocumentImpact(w, second.newer.documentId);
      expect(newest.phase).toBe('PREVIEW');
      expect(newest.quiet).toBe(true);
    },
    HEAVY,
  );

  it(
    'stops at a loop or an over-long chain in the stored links instead of spinning',
    async () => {
      const w = await buildImpactWorld();
      const { newer } = await replaceWithNewerPassport(w);
      // The services refuse a loop; this writes one by hand to prove the read survives it.
      await w.db
        .update(schema.documents)
        .set({ supersededByDocumentId: w.p1.documentId })
        .where(eq(schema.documents.id, newer.documentId));
      const impact = await readDocumentImpact(w);
      expect(impact.phase).toBe('RECORDED');
      expect(impact.subject).toMatchObject({ replacement: { documentId: newer.documentId } });
    },
    HEAVY,
  );
});

describe('a request the agency sent back, overlapping a newer document', () => {
  it(
    'waits on the traveller until the newer document is sent, then needs nothing',
    async () => {
      const w = await buildImpactWorld();
      const sentBack = await askForDocument(w.db, w.agencyA, w.rahim, w.liveCaseId);
      await sendDocument(w.db, w.rahim, sentBack, w.p1.documentId);
      await decide(w.db, w.agencyA, sentBack, 'NEEDS_REPLACEMENT');
      const waiting = await askForDocument(w.db, w.agencyA, w.rahim);
      await sendDocument(w.db, w.rahim, waiting, w.p1.documentId);

      const { newer } = await replaceWithNewerPassport(w);
      const before = await readDocumentImpact(w);
      expect(itemOf(before, `request:${sentBack}`)).toMatchObject({
        outcome: 'ACTION_REQUIRED',
        reason: 'AGENCY_WAITING_FOR_REPLACEMENT',
        nextStep: { kind: 'OPEN_REQUEST', requestId: sentBack },
      });
      // Not decided yet: the agency is still checking the earlier copy.
      expect(itemOf(before, `request:${waiting}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'AGENCY_CHECKING_EARLIER',
        nextStep: { kind: 'OPEN_REQUEST', requestId: waiting },
      });
      expect(before.counts.ACTION_REQUIRED).toBe(2);

      // The traveller answers the sent-back request with the newer passport, in the request.
      await sendDocument(w.db, w.rahim, sentBack, newer.documentId);
      const after = await readDocumentImpact(w);
      expect(itemOf(after, `request:${sentBack}`)).toMatchObject({
        outcome: 'NO_ACTION',
        reason: 'AGENCY_HOLDS_CURRENT',
        nextStep: null,
      });
      await decide(w.db, w.agencyA, sentBack, 'ACCEPTED');
      expect(itemOf(await readDocumentImpact(w), `request:${sentBack}`).reason).toBe(
        'AGENCY_HOLDS_CURRENT',
      );

      // The agency withdraws the other request: it is no longer listed.
      must(
        await cancelEvidenceRequest(w.db, {
          actorAccountId: w.agencyA.accountId,
          requestId: waiting,
        }),
        'withdraw',
      );
      const withdrawn = await readDocumentImpact(w);
      expect(withdrawn.items.some((item) => item.id === `request:${waiting}`)).toBe(false);
    },
    HEAVY,
  );
});

describe('a live case that deliberately keeps the earlier copy', () => {
  it(
    'is one item: the selection wins while it stands, then the choice is offered for review',
    async () => {
      const w = await buildImpactWorld();
      const keeper = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Keeping a Copy',
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
          packRequirementId: w.checklist.documentRequirementId,
          choice: 'USE_COPY',
          documentVersionId: w.p1.versionId,
        }),
        'use this copy',
      );
      await replaceWithNewerPassport(w);
      // Choosing a copy also selects the document, and a selection is the stronger tie.
      const selected = await readDocumentImpact(w);
      expect(itemOf(selected, `case:${keeper}`).reason).toBe('LIVE_CASE_USES_REPLACED_DOCUMENT');
      // One item per case.
      expect(new Set(selected.items.map((item) => item.id)).size).toBe(selected.items.length);

      // The selection is taken off; the deliberate choice of the copy still stands.
      const [selection] = await w.db
        .select({ id: schema.selectedEvidence.id })
        .from(schema.selectedEvidence)
        .where(eq(schema.selectedEvidence.missionId, keeper));
      must(
        await unselectEvidence(w.db, {
          actorAccountId: w.rahim.accountId,
          missionId: keeper,
          selectionId: selection?.id ?? '',
        }),
        'unselect',
      );
      const impact = await readDocumentImpact(w);
      expect(itemOf(impact, `case:${keeper}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'LIVE_CASE_KEEPS_EARLIER_COPY',
        nextStep: { kind: 'OPEN_CASE', missionId: keeper },
      });
    },
    HEAVY,
  );
});

describe('a checklist change pending on the same case', () => {
  it(
    'neither alters nor duplicates the items',
    async () => {
      const w = await buildImpactWorld();
      await replaceWithNewerPassport(w);
      const before = await readDocumentImpact(w);

      // A newer version of the case's checklist is published and its effect on cases assessed.
      const actor = w.rahim.accountId;
      const v2 = must(
        await addPackVersion(w.db, { actorAccountId: actor, packId: w.checklist.packId }),
        'v2',
      );
      for (const row of [
        { kind: 'DOCUMENT' as const, docType: PASSPORT_TYPE, citation: 'sample rule 1' },
        { kind: 'FIELD' as const, fieldKey: 'current_employer', citation: 'sample rule 2' },
        { kind: 'DOCUMENT' as const, docType: 'hotel_booking', citation: 'sample rule 3' },
      ]) {
        must(
          await addRequirement(w.db, { actorAccountId: actor, packVersionId: v2.id, ...row }),
          'requirement',
        );
      }
      must(await approvePackVersion(w.db, { actorAccountId: actor, packVersionId: v2.id }), 'ok');
      must(await publishPackVersion(w.db, { actorAccountId: actor, packVersionId: v2.id }), 'ok');
      const editorEmail = 'editor@platform.example.test';
      const editor = must(await provisionAccount(w.db, { email: editorEmail }), 'editor');
      must(
        await grantPlatformRole(w.db, {
          actor: { accountId: editor.id, email: editorEmail, bootstrapEmails: [editorEmail] },
          targetAccountId: editor.id,
          role: 'PLATFORM_OWNER',
          reason: 'made-up seed',
          stepUpSatisfied: true,
        }),
        'role',
      );
      const scope = must(
        await staffPrincipal(
          w.db,
          { accountId: editor.id, email: editorEmail, bootstrapEmails: [] },
          'PACK_MANAGE',
        ),
        'scope',
      );
      const assessed = must(await assessRuleImpact(w.db, scope, { packVersionId: v2.id }), 'run');
      expect(assessed.casesFlagged).toBeGreaterThanOrEqual(1);
      const flagged = await w.db.select().from(schema.umpeRuleImpacts);
      expect(flagged.map((row) => row.missionId)).toContain(w.liveCaseId);

      const after = await readDocumentImpact(w);
      expect(after.items).toEqual(before.items);
      expect(after.counts).toEqual(before.counts);
    },
    HEAVY,
  );
});

describe('replacing a document that nothing uses', () => {
  it(
    'stays quiet',
    async () => {
      const w = await buildImpactWorld();
      // Nothing selects, sent or named the utility bill. The one record that relates to it is
      // Agency A's whole-record share, which already covers any newer document: NO_ACTION.
      const withWiderShare = await readDocumentImpact(w, w.controlDocument.documentId);
      expect(withWiderShare.quiet).toBe(true);
      expect(withWiderShare.complete).toBe(true);
      expect(reasons(withWiderShare)).toEqual([
        [`share:${w.agencyAShareId}`, 'SHARE_ALREADY_COVERS'],
      ]);
      expect(withWiderShare.counts).toEqual({
        ACTION_REQUIRED: 0,
        REVIEW_RECOMMENDED: 0,
        UNKNOWN: 0,
        HISTORY_PRESERVED: 0,
        NO_ACTION: 1,
      });

      // With no share that reaches it, there is nothing at all to say.
      must(
        await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: w.agencyAShareId }),
        'revoke',
      );
      const alone = await readDocumentImpact(w, w.controlDocument.documentId);
      expect(alone.items).toEqual([]);
      expect(alone.quiet).toBe(true);
      expect(alone.phase).toBe('PREVIEW');
    },
    HEAVY,
  );
});

describe('a live case confirmed again while it still uses the earlier document', () => {
  it(
    'is offered for review, not asked for a step; an unconfirmed case still is',
    async () => {
      const w = await buildImpactWorld();
      const neverConfirmed = await makeCase(w.db, w.rahim, w.checklist, {
        title: 'Sample Case Never Confirmed',
        documentId: w.p1.documentId,
        confirm: false,
      });
      await replaceWithNewerPassport(w);
      // The replacement voided the confirmation: a step is needed.
      expect(itemOf(await readDocumentImpact(w), `case:${w.liveCaseId}`).reason).toBe(
        'LIVE_CASE_USES_REPLACED_DOCUMENT',
      );

      // The traveller looks at the case and confirms it again with the earlier passport.
      await confirmCase(w.db, w.rahim, w.liveCaseId);
      const impact = await readDocumentImpact(w);
      expect(itemOf(impact, `case:${w.liveCaseId}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'LIVE_CASE_KEEPS_EARLIER_COPY',
        nextStep: { kind: 'OPEN_CASE', missionId: w.liveCaseId },
      });
      expect(itemOf(impact, `case:${neverConfirmed}`).reason).toBe(
        'LIVE_CASE_USES_REPLACED_DOCUMENT',
      );
      expect(impact.counts.ACTION_REQUIRED).toBe(1);
    },
    HEAVY,
  );
});

describe('a chain of replacements with a document in Recently Deleted', () => {
  /** By hand: the document goes to Recently Deleted, as a removal records it. */
  const remove = (w: Awaited<ReturnType<typeof buildImpactWorld>>, documentId: string) =>
    w.db.execute(
      sql`insert into document_lifecycle (document_id, applicant_id, deleted_at, delete_path, purge_after) values (${documentId}, ${w.rahim.applicantId}, now(), 'REQUEST', now() + interval '30 days')`,
    );

  it(
    'is followed through the removed document to the newest one that is still there',
    async () => {
      const w = await buildImpactWorld();
      const first = await replaceWithNewerPassport(w);
      const second = await replaceWithNewerPassport(
        w,
        first.newer.documentId,
        'sample-passport-newest.pdf',
      );
      // An agency was sent the newest passport, and another the middle one.
      const holdsNewest = await askForDocument(w.db, w.agencyA, w.rahim);
      await sendDocument(w.db, w.rahim, holdsNewest, second.newer.documentId);
      const before = await readDocumentImpact(w);

      await remove(w, first.newer.documentId);
      const after = await readDocumentImpact(w);
      expect(after.phase).toBe('RECORDED');
      expect(after.subject).toMatchObject({
        replacement: { documentId: second.newer.documentId, title: 'sample-passport-newest.pdf' },
      });
      // Nothing about the consequences moved because a middle document was removed.
      expect(reasons(after)).toEqual(reasons(before));
      expect(itemOf(after, `share:${w.agencyAShareId}`).reason).toBe('SHARE_ALREADY_COVERS');
      expect(itemOf(after, `request:${holdsNewest}`).reason).toBe('AGENCY_HOLDS_CURRENT');
    },
    HEAVY,
  );

  it(
    'falls back to the newest document still there, and stays recorded when none is',
    async () => {
      const w = await buildImpactWorld();
      const first = await replaceWithNewerPassport(w);
      const second = await replaceWithNewerPassport(
        w,
        first.newer.documentId,
        'sample-passport-newest.pdf',
      );
      const holdsMiddle = await askForDocument(w.db, w.agencyA, w.rahim);
      await sendDocument(w.db, w.rahim, holdsMiddle, first.newer.documentId);

      // The newest is removed: the middle passport is the replacement that is still there.
      await remove(w, second.newer.documentId);
      const middle = await readDocumentImpact(w);
      expect(middle.phase).toBe('RECORDED');
      expect(middle.subject).toMatchObject({ replacement: { documentId: first.newer.documentId } });
      // A copy of a later document in the chain is a copy of a newer document than this one.
      expect(itemOf(middle, `request:${holdsMiddle}`).reason).toBe('AGENCY_HOLDS_CURRENT');

      // Both later passports removed: no replacement is left to point at, but the replacement
      // was recorded (the link is never cleared, and the passport cannot be replaced again), so
      // this is still the recorded change, not a preview.
      await remove(w, first.newer.documentId);
      const alone = await readDocumentImpact(w);
      expect(alone.phase).toBe('RECORDED');
      expect(alone.subject).toMatchObject({ replacement: null });
      // The whole-record share still covers whatever is added later; only the by-name share
      // covers the earlier passport alone.
      expect(itemOf(alone, `share:${w.agencyAShareId}`).reason).toBe('SHARE_ALREADY_COVERS');
      expect(itemOf(alone, `share:${w.agencyBShareId}`).reason).toBe('SHARE_COVERS_EARLIER_ONLY');
      // The send of the removed middle passport is still a newer copy, not a lost one.
      expect(itemOf(alone, `request:${holdsMiddle}`).reason).toBe('AGENCY_HOLDS_CURRENT');
      expect(itemOf(alone, `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
    },
    HEAVY,
  );

  it(
    'keeps a case confirmed again as a choice to review once the only replacement is removed',
    async () => {
      const w = await buildImpactWorld();
      const { newer } = await replaceWithNewerPassport(w);
      await confirmCase(w.db, w.rahim, w.liveCaseId);
      expect(itemOf(await readDocumentImpact(w), `case:${w.liveCaseId}`).reason).toBe(
        'LIVE_CASE_KEEPS_EARLIER_COPY',
      );

      await remove(w, newer.documentId);
      const after = await readDocumentImpact(w);
      expect(after.phase).toBe('RECORDED');
      expect(after.subject).toMatchObject({ replacement: null });
      // The traveller already confirmed the case with the earlier passport: no step is owed.
      expect(itemOf(after, `case:${w.liveCaseId}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'LIVE_CASE_KEEPS_EARLIER_COPY',
      });
      expect(after.counts.ACTION_REQUIRED).toBe(0);
    },
    HEAVY,
  );
});

describe('a chain of replacements cut by a document removed for good', () => {
  /** By hand: the row is gone for good, as permanent removal leaves it (the link has no key). */
  const removeForGood = (w: Awaited<ReturnType<typeof buildImpactWorld>>, documentId: string) =>
    w.db.execute(sql`delete from documents where id = ${documentId}`);

  /** A chain of two utility bills after the control bill, built through the real replacement. */
  async function controlChain(w: Awaited<ReturnType<typeof buildImpactWorld>>) {
    const middle = await makeDocument(w.db, w.rahim, CONTROL_TYPE, 'sample-bill-newer.pdf');
    const newest = await makeDocument(w.db, w.rahim, CONTROL_TYPE, 'sample-bill-newest.pdf');
    for (const [oldDocumentId, newDocumentId] of [
      [w.controlDocument.documentId, middle.documentId],
      [middle.documentId, newest.documentId],
    ] as const) {
      must(
        await replaceDocument(await ownerManage(w.db, w.rahim), { oldDocumentId, newDocumentId }),
        'replace',
      );
    }
    return { middle, newest };
  }

  it(
    'is said even when nothing else depends on the document: the newer one is not known',
    async () => {
      const w = await buildImpactWorld();
      must(
        await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: w.agencyAShareId }),
        'revoke',
      );
      const { middle } = await controlChain(w);
      const before = await readDocumentImpact(w, w.controlDocument.documentId);
      expect(before.items).toEqual([]);
      expect(before.quiet).toBe(true);

      await removeForGood(w, middle.documentId);
      const after = await readDocumentImpact(w, w.controlDocument.documentId);
      expect(after.phase).toBe('RECORDED');
      expect(after.subject).toMatchObject({ replacement: null });
      // One item, about the copies sent to agencies: those of the newer document can no longer
      // be found. It is unknown, not a part that could not be read, so the read stays complete.
      expect(after.items).toEqual([
        {
          id: 'chain:cut',
          outcome: 'UNKNOWN',
          reason: 'RECORD_INCOMPLETE',
          area: 'AGENCY_REQUESTS',
          about: { kind: 'AREA', area: 'AGENCY_REQUESTS' },
          nextStep: null,
        },
      ]);
      expect(after.quiet).toBe(false);
      expect(after.complete).toBe(true);
    },
    HEAVY,
  );

  it(
    'still says a by-name share covers the earlier document only when it names only documents of the chain',
    async () => {
      const w = await buildImpactWorld();
      const { middle } = await controlChain(w);
      // Lists the bill and the middle one, which is later removed for good: neither is newer
      // than the chain's end, so the share cannot reach the newest bill.
      const byName = await shareWith(w.db, w.rahim, w.unrelatedAgency, {
        actions: ['VIEW_METADATA', 'PREVIEW'],
        documentIds: [w.controlDocument.documentId, middle.documentId],
      });
      await removeForGood(w, middle.documentId);
      const after = await readDocumentImpact(w, w.controlDocument.documentId);
      expect(itemOf(after, `share:${byName}`)).toMatchObject({
        outcome: 'REVIEW_RECOMMENDED',
        reason: 'SHARE_COVERS_EARLIER_ONLY',
      });
    },
    HEAVY,
  );

  it(
    'says what depends on the newer document is not known, and invents no alert',
    async () => {
      const w = await buildImpactWorld();
      const middle = await replaceWithNewerPassport(w);
      const newest = await replaceWithNewerPassport(
        w,
        middle.newer.documentId,
        'sample-passport-newest.pdf',
      );
      // A share that lists the earlier passport and the newest one by name.
      const byName = await shareWith(w.db, w.rahim, w.unrelatedAgency, {
        actions: ['VIEW_METADATA', 'PREVIEW'],
        documentIds: [w.p1.documentId, newest.newer.documentId],
      });
      const holdsNewest = await askForDocument(w.db, w.agencyA, w.rahim);
      await sendDocument(w.db, w.rahim, holdsNewest, newest.newer.documentId);
      const before = await readDocumentImpact(w);
      expect(itemOf(before, `share:${byName}`).reason).toBe('SHARE_ALREADY_COVERS');
      expect(itemOf(before, `request:${holdsNewest}`).reason).toBe('AGENCY_HOLDS_CURRENT');

      await removeForGood(w, middle.newer.documentId);
      const after = await readDocumentImpact(w);
      // Still the recorded change; which document is the newest is no longer known.
      expect(after.phase).toBe('RECORDED');
      expect(after.subject).toMatchObject({ replacement: null });
      // The share names another document that may be the newest: unknown, not "earlier only".
      expect(itemOf(after, `share:${byName}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'RECORD_INCOMPLETE',
        nextStep: { kind: 'OPEN_SHARING', grantId: byName },
      });
      // A share that lists only the earlier passport cannot reach any newer one: still said.
      expect(itemOf(after, `share:${w.agencyBShareId}`).reason).toBe('SHARE_COVERS_EARLIER_ONLY');
      expect(itemOf(after, `share:${w.agencyAShareId}`).reason).toBe('SHARE_ALREADY_COVERS');
      // Nothing that asks for a step or a review was added by the cut.
      const flagged = (impact: typeof after) =>
        impact.items
          .filter(
            (item) => item.outcome === 'ACTION_REQUIRED' || item.outcome === 'REVIEW_RECOMMENDED',
          )
          .map((item) => [item.id, item.reason]);
      expect(flagged(after)).toEqual(flagged(before));
      // Nothing left on record links the newest passport to this one, so its send is no longer
      // found by this read (the agency's own request still shows it).
      expect(after.items.some((item) => item.id === `request:${holdsNewest}`)).toBe(false);
    },
    HEAVY,
  );
});

describe('a preview that names a newer document the replacement would refuse', () => {
  it(
    'is refused like a made-up id when that document is already replaced or of another kind',
    async () => {
      const w = await buildImpactWorld();
      const proof = await ownerManage(w.db, w.rahim);
      const ask = (replacementDocumentId: string) =>
        assessDocumentChangeImpact(proof, { documentId: w.p1.documentId, replacementDocumentId });
      const madeUp = await ask(MADE_UP_ID);
      expect(madeUp.ok).toBe(false);

      const spare = await makeDocument(w.db, w.rahim, PASSPORT_TYPE, 'sample-passport-spare.pdf');
      await replaceWithNewerPassport(w, spare.documentId, 'sample-passport-spare-newer.pdf');
      // Already replaced, then another kind of document (the utility bill).
      expect(await ask(spare.documentId)).toEqual(madeUp);
      expect(await ask(w.controlDocument.documentId)).toEqual(madeUp);
      // The document itself, as the replacement says it.
      expect(await ask(w.p1.documentId)).toEqual({
        ok: false,
        error: { code: 'invalid', message: SAME_DOCUMENT },
      });
      // A candidate the replacement would take is still read.
      const fit = await makeDocument(w.db, w.rahim, PASSPORT_TYPE, 'sample-passport-fit.pdf');
      expect(must(await ask(fit.documentId), 'fit').subject).toMatchObject({
        replacement: { documentId: fit.documentId },
      });
    },
    HEAVY,
  );
});
