import { type Result, err, ok } from '@visastack/core';
import type { AuthorizedApplicant } from '../access/require-access';
import { type ServiceError, serviceError } from '../errors';
import { isUuid } from '../lifecycle/foundation/ids';
import { documentCategory } from '../sharing';
import { isInactiveCaseState } from '../umpe-package-tables';
import {
  type DocumentCaseFacts,
  type DraftItem,
  type SendCarries,
  assembleImpact,
  classifyDocumentCase,
  classifyDocumentShare,
  couldNotCheck,
  shareItem,
} from './classify';
import type { AssessChangeOptions, AssessDocumentChangeInput, ChangeImpact } from './contract';
import {
  type CaseRow,
  type DocumentSubject,
  casesKeepingCopy,
  casesSelecting,
  collectionAnswersCarrying,
  documentRequestHistories,
  finishedCasesWithCopyOf,
  liveShares,
  lockDocumentSubject,
  ownDocument,
  recordedReplacementId,
  savedCopiesOf,
  shareReachOf,
} from './load';
import {
  type SendRules,
  agenciesAmong,
  collectionAnswerDrafts,
  evidenceRequestItem,
  isOwnersProof,
  refused,
  runRead,
} from './shared';

/** Why a preview that names the document as its own replacement is refused. */
export const SAME_DOCUMENT = 'a document cannot replace itself';

/**
 * Stands in for "a document of the same kind added later" when a preview names no replacement:
 * no document has this id, so only a share that is not tied to named documents reaches it.
 */
const LATER_DOCUMENT_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

/**
 * What replacing one document means for the traveller's live cases, the copies agencies hold,
 * sharing already set up and finished work (see `contract.ts`). A read: it writes nothing.
 *
 * `access` is the record owner's own MANAGE proof from `requireAccess`, for the applicant or for
 * this document. Anyone else, a document of someone else and a made-up id get the gate's single
 * refusal after the same lookups. Before a replacement is recorded this is a preview (name the
 * newer document in `replacementDocumentId` to ask about that one); afterwards it follows the
 * recorded chain of replacements to its end.
 */
export async function assessDocumentChangeImpact(
  access: AuthorizedApplicant<'MANAGE'>,
  input: AssessDocumentChangeInput,
  options: AssessChangeOptions = {},
): Promise<Result<ChangeImpact, ServiceError>> {
  if (!isOwnersProof(access)) return refused();
  const candidate = input.replacementDocumentId;
  if (!isUuid(input.documentId) || (candidate !== undefined && !isUuid(candidate))) {
    return refused();
  }
  const documentId = input.documentId.toLowerCase();
  const resource = access.resource;
  const names =
    resource.kind === 'applicant' ||
    (resource.kind === 'document' && resource.document.id === documentId);
  if (!names) return refused();
  const now = options.now ?? new Date();

  return runRead(access, async (tx, present) => {
    const subject = await lockDocumentSubject(access, tx, documentId, present.lifecycle);
    if (!subject) return refused();

    const recordedId = await recordedReplacementId(access, tx, subject, present.lifecycle);
    let replacement: DocumentSubject | null = null;
    if (recordedId !== null) {
      replacement = (await ownDocument(access, tx, recordedId, present.lifecycle)) ?? null;
    } else if (candidate !== undefined) {
      const named = await ownDocument(access, tx, candidate.toLowerCase(), present.lifecycle);
      if (!named) return refused();
      if (named.id === subject.id) return err(serviceError('invalid', SAME_DOCUMENT));
      replacement = named;
    }
    const phase = subject.supersededBy !== null ? 'RECORDED' : 'PREVIEW';
    const replacementId = replacement?.id ?? null;
    const drafts: DraftItem[] = [];

    // Cases.
    const selecting = await casesSelecting(access, tx, { documentId });
    const keeping = present.packageChoices ? await casesKeepingCopy(access, tx, documentId) : [];
    if (!present.packageChoices) drafts.push(couldNotCheck('CASES'));
    const selectingIds = new Set(selecting.map((row) => row.id));
    const copied = (await finishedCasesWithCopyOf(access, tx, { documentId })).filter(
      (row) => !selectingIds.has(row.id),
    );
    const copies = await savedCopiesOf(access, tx, copied);
    const cases = new Map<string, CaseRow>();
    for (const row of [...selecting, ...keeping, ...copied]) cases.set(row.id, row);
    for (const row of cases.values()) {
      const copy = copies.get(row.id);
      const facts: DocumentCaseFacts = {
        missionId: row.id,
        title: row.title,
        live: !isInactiveCaseState(row.state),
        createdAt: row.createdAt,
        selects: selectingIds.has(row.id),
        keepsCopy: keeping.some((kept) => kept.id === row.id),
        savedCopyLists: [...(copy?.byRequirement.values() ?? [])].some((used) =>
          used.documents.some((doc) => doc.documentId === documentId),
        ),
      };
      const item = classifyDocumentCase(facts);
      if (item) drafts.push(item);
    }

    // Sharing. One item per live share, by what the policy evaluation says it reaches.
    const shares = await liveShares(access, tx, now);
    const category = documentCategory(subject.docType) ?? null;
    for (const share of shares) {
      const reason = classifyDocumentShare(
        shareReachOf(share, {
          subject: { documentId, category },
          ...(replacement
            ? {
                replacement: {
                  documentId: replacement.id,
                  category: documentCategory(replacement.docType) ?? null,
                },
              }
            : phase === 'PREVIEW'
              ? { laterDocument: { documentId: LATER_DOCUMENT_ID, category } }
              : {}),
        }),
      );
      if (reason) drafts.push(shareItem(share, reason));
    }

    // Sends to agencies, each judged on its latest round.
    const carriesDocument = (id: string | null, exact: boolean, intact: boolean): SendCarries => {
      if (id !== null && id === replacementId) return exact && !intact ? 'BROKEN' : 'CURRENT';
      if (id !== documentId) return 'OTHER';
      // A send recorded before exact copies were kept: it was this document, which copy is unknown.
      if (!exact) return 'UNPINNED';
      return intact ? 'EARLIER' : 'BROKEN';
    };
    const rules: SendRules = {
      carriesOf: (round) =>
        round.precision === 'pinned'
          ? carriesDocument(round.send.subjectId, true, round.send.intact)
          : carriesDocument(round.subjectId, false, true),
      waitingSendMatches: () => true,
      carriedWithoutRecord: (respondingId) => carriesDocument(respondingId, false, true),
      waitsEvenOnCurrent: false,
      agenciesWithLiveShare: agenciesAmong(shares),
    };
    const carriedIds = replacementId ? [documentId, replacementId] : [documentId];
    const histories = await documentRequestHistories(access, tx, carriedIds, present.documentPins);
    for (const history of histories) {
      const item = evidenceRequestItem(history, {
        ...rules,
        // A document send that still waits is the request's answer only while the request
        // points at the same document.
        waitingSendMatches: (send) => send.subjectId === history.request.respondingId,
      });
      if (item) drafts.push(item);
    }
    if (present.collectionResponses) {
      const answers = await collectionAnswersCarrying(access, tx, { documentIds: carriedIds });
      drafts.push(
        ...collectionAnswerDrafts(answers, (answer) =>
          replacementId !== null && answer.carriedIds.includes(replacementId)
            ? 'CURRENT'
            : answer.carriedIds.includes(documentId)
              ? 'EARLIER'
              : 'OTHER',
        ),
      );
    } else {
      drafts.push(couldNotCheck('AGENCY_REQUESTS'));
    }

    return ok(
      assembleImpact({
        subject: {
          kind: 'DOCUMENT',
          documentId,
          title: subject.title,
          replacement: replacement
            ? { documentId: replacement.id, title: replacement.title }
            : null,
        },
        phase,
        drafts,
        assessedAt: now,
      }),
    );
  });
}
