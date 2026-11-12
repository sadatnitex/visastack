import {
  DEFAULT_DOCUMENT_PROTECTION,
  accountPrincipal,
  getAiFeatureStates,
  getApplicant,
  hasConsent,
  listApplicantProfile,
  listDocumentReadingStates,
  listDocumentsDetailed,
  listPendingDocumentTypeProposals,
  listPendingProposals,
  readDocumentProtectionSettings,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '../../../../../components/auto-refresh';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { confirmedValues, findingViewModel } from '../../../../../lib/document-findings';
import { readingStatusCopy } from '../../../../../lib/document-reading';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { evidenceDocumentGroups } from '../../../../../lib/master-profile';
import { protectedKindsOf } from '../../../../../lib/protected-kinds';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { isStillProcessing } from '../../../../../lib/resilience';
import { withSession } from '../../../../../lib/session';
import {
  type BatchFileStage,
  batchFileLine,
  currentFlowStep,
  parseBatch,
  stageIsWorking,
} from '../../../../../lib/upload-batch';
import { DocumentFindings, ReadAgainButton } from '../ai-review';
import { documentSuggestionView } from '../document-suggestion';
import { DocumentSuggestionCard } from '../document-suggestion-card';
import { ReadingStatus } from '../reading-status';
import { FlowSteps } from './flow-steps';

export const metadata: Metadata = { title: 'What We Found' };

export const dynamic = 'force-dynamic';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one place the details read from a person's documents wait for their answer. Every file the
 * reading found something in is listed here with what it found, and the clear details can be
 * accepted in one tap; the sensitive ones are decided one at a time, as everywhere else. Nothing
 * reaches the profile until it is accepted. Owner only. A detail an AI app suggested about the
 * profile itself is reviewed on My Profile, not here.
 */
export default async function WhatWeFoundPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<{ batch?: string | string[] }>;
}) {
  await primeLocale();
  const t = getServerT(appApplicantCatalog);
  const { id } = await params;
  // The files just added, when a person arrives from an import: followed one by one below.
  const batchIds = parseBatch((await searchParams)?.batch);
  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const encryption = createKeyManagementPort();
    const [coreGranted, proposals, documents] = await Promise.all([
      hasConsent(db, accountId, 'CORE_PROCESSING'),
      listPendingProposals(db, id),
      // The documents in use, as the Documents page's Current list: a file the person put away or
      // deleted offers nothing to accept here.
      listDocumentsDetailed(db, accountId, id, { lifecycle: 'everyday' }),
    ]);
    // What the profile already holds, read only when there is something to compare it with.
    const profile = proposals.length > 0 ? await listApplicantProfile(db, id, encryption) : [];
    // How each file's reading went, through the owner's own proof, and whether asking for a
    // reading is on. Extras: if either cannot be read, the page simply lists no unread files.
    const rows = documents.ok ? documents.value : [];
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'self' },
    );
    const reading = access.ok
      ? await listDocumentReadingStates(
          access.value,
          rows.flatMap((doc) => (doc.latestVersionId ? [doc.latestVersionId] : [])),
        )
          .then((read) => (read.ok ? read.value : undefined))
          .catch(() => undefined)
      : undefined;
    const canAskToRead = access.ok
      ? await getAiFeatureStates(db, ['ai_document_reading'] as const, { proof: access.value })
          .then((states) => states.ai_document_reading.available)
          .catch(() => false)
      : false;
    // What kind each file looks like and what to call it: nothing is saved until it is accepted.
    // Extras: if either cannot be read, the page simply offers no kind or name to approve.
    const [waitingKinds, protection] = await Promise.all([
      listPendingDocumentTypeProposals(db, id).catch(() => []),
      readDocumentProtectionSettings(db).catch(() => DEFAULT_DOCUMENT_PROTECTION),
    ]);
    return {
      name: applicant.displayName,
      waitingKinds,
      protection,
      coreGranted,
      proposals,
      reading,
      canAskToRead,
      documents: rows,
      confirmed: confirmedValues(profile, encryption !== undefined),
    };
  });
  if (!data) notFound();

  // In the flow after an import, the page follows only the files just added; otherwise it lists
  // everything that waits. An address naming no file of this person's is the plain page.
  const followed = data.documents.filter((doc) => batchIds.includes(doc.id));
  const inBatch = followed.length > 0;
  const docs = inBatch ? followed : data.documents;

  const readingOf = (versionId: string | null) =>
    versionId ? data.reading?.states.get(versionId) : undefined;
  const foundIn = (versionId: string | null) =>
    versionId
      ? data.proposals.filter((reading) => reading.proposal.documentVersionId === versionId)
      : [];
  const suggestionOf = (doc: (typeof docs)[number]) => {
    const waitingKind = data.waitingKinds.find((p) => p.documentVersionId === doc.latestVersionId);
    return documentSuggestionView(doc, waitingKind, data.name, data.protection);
  };

  // Each file with what was found in it and any kind and name to approve, newest file first.
  const groups = docs.flatMap((doc) => {
    const found = foundIn(doc.latestVersionId);
    const suggestion = suggestionOf(doc);
    return found.length > 0 || suggestion ? [{ doc, found, suggestion }] : [];
  });
  const total = groups.reduce((sum, group) => sum + group.found.length, 0);
  // Files nothing was found in, with why and, when asking is on, one tap to read them now.
  const unread = docs.flatMap((doc) => {
    const versionId = doc.latestVersionId;
    const state = readingOf(versionId);
    if (!versionId || state?.stage !== 'could_not_read') return [];
    const copy = readingStatusCopy(state, { canReadAgain: data.canAskToRead });
    return copy ? [{ doc, versionId, state, copy }] : [];
  });
  /** Reasons a file was never read at all, so the button says "Read This Document". */
  const NEVER_READ = ['PROTECTED', 'NOT_TRIED', 'FEATURE_OFF', 'SWITCHED_OFF', 'NO_CONSENT'];

  // Where each just-added file stands, so the page says plainly that it is saved and what is next.
  const rows = inBatch
    ? followed.map((doc) => {
        const state = readingOf(doc.latestVersionId);
        const found = foundIn(doc.latestVersionId).length;
        const stage: BatchFileStage =
          state?.stage === 'needs_attention'
            ? 'needs_attention'
            : state?.stage === 'checking' || state?.stage === 'reading'
              ? state.stage
              : !state && isStillProcessing(doc.processingStatus)
                ? 'checking'
                : found > 0
                  ? 'found'
                  : suggestionOf(doc)
                    ? 'name'
                    : state?.stage === 'could_not_read'
                      ? 'not_read'
                      : state?.stage === 'done'
                        ? 'done'
                        : 'saved';
        return { doc, stage, found };
      })
    : [];
  const working = rows.some((row) => stageIsWorking(row.stage));
  // Done only when every file reached a finished state: a file that needs a look, or whose progress
  // could not be read, is never reported as finished.
  const allDone =
    inBatch &&
    rows.every((row) => row.stage === 'done') &&
    groups.length === 0 &&
    unread.length === 0;
  const documentGroups = evidenceDocumentGroups();
  const protectedKinds = protectedKindsOf(documentGroups, data.protection);

  return (
    <>
      <PageHeader
        title={
          inBatch
            ? t('appApplicant.appApplicantIdReviewPage.yourFilesAreSaved')
            : t('appApplicant.appApplicantIdReviewPage.whatWeFound')
        }
        description={
          inBatch
            ? t('appApplicant.appApplicantIdReviewPage.weCheckEachFileReadIt')
            : t('appApplicant.appApplicantIdReviewPage.detailsWeReadFromYourDocuments')
        }
        back={{ href: `/app/applicant/${id}`, label: 'Home' }}
      />
      {inBatch ? <FlowSteps current={allDone ? 'done' : currentFlowStep(working)} /> : null}
      {inBatch ? (
        <>
          <AutoRefresh active={working} />
          <section className="card u-mb-150" aria-labelledby="flow-files-title">
            <h2 className="card-title" id="flow-files-title">
              {rows.length === 1
                ? t.node('appApplicant.appApplicantIdReviewPage.1FileSaved')
                : t.node('appApplicant.appApplicantIdReviewPage.lengthFilesSaved', {
                    length: rows.length,
                  })}
            </h2>
            <ul className="flow-files">
              {rows.map(({ doc, stage, found }) => (
                <li key={doc.id} className="flow-file" data-stage={stage}>
                  <span className="flow-file-name">{doc.approvedName ?? doc.originalName}</span>
                  <span className="flow-file-line">{batchFileLine(stage, found)}</span>
                </li>
              ))}
            </ul>
            {working ? (
              <output className="notice">
                {t.node('appApplicant.appApplicantIdReviewPage.youCanLeaveThisPageWe')}
              </output>
            ) : null}
          </section>
        </>
      ) : null}
      {!data.coreGranted ? (
        <article className="card">
          <p className="card-body">
            Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
            <Link href="/app#permissions">Home</Link> to add details to your profile.
          </p>
        </article>
      ) : allDone ? (
        <article className="card u-mb-150" aria-labelledby="flow-done-title">
          <h2 className="card-title" id="flow-done-title">
            {t.node('appApplicant.appApplicantIdReviewPage.allDone')}
          </h2>
          <p className="card-body">
            {rows.length === 1 ? 'Your file is' : `All ${rows.length} files are`} saved, named and
            read. Nothing is waiting for you.
          </p>
          <div className="upload-drop-actions">
            <Link className="btn btn-primary" href={`/app/applicant/${id}/profile`}>
              {t.node('appApplicant.appApplicantIdReviewPage.openMyProfile')}
            </Link>
            <Link className="btn btn-secondary" href={`/app/applicant/${id}/documents/add`}>
              {t.node('appApplicant.appApplicantIdReviewPage.addMoreDocuments')}
            </Link>
          </div>
        </article>
      ) : groups.length === 0 && unread.length === 0 && !inBatch ? (
        <EmptyState
          title={t('appApplicant.appApplicantIdReviewPage.youAreUpToDate')}
          why="Every detail we found has been answered. Add a document to find more."
          action={{ href: `/app/applicant/${id}/documents/add`, label: 'Add Documents' }}
        >
          {t.node('appApplicant.appApplicantIdPage.nothingIsWaitingForYou')}
        </EmptyState>
      ) : (
        <>
          {groups.length > 0 ? (
            <p className="card-body u-mb-150">
              {total > 0
                ? t.node('appApplicant.appApplicantIdReviewPage.pluralFoundInPlural2AcceptThe', {
                    plural: plural(total, 'Detail', 'Details'),
                    plural2: plural(
                      groups.filter((group) => group.found.length > 0).length,
                      'document',
                      'documents',
                    ),
                  })
                : t.node('appApplicant.appApplicantIdReviewPage.checkTheNameWeSuggestFor')}
            </p>
          ) : null}
          {groups.map(({ doc, found, suggestion }) => (
            <article key={doc.id} className="card u-mb-150" aria-labelledby={`found-${doc.id}`}>
              <h2 className="card-title" id={`found-${doc.id}`}>
                {doc.approvedName ?? doc.originalName}
              </h2>
              {suggestion ? (
                <DocumentSuggestionCard
                  applicantId={id}
                  suggestion={suggestion}
                  groups={documentGroups}
                  protectedKinds={protectedKinds}
                />
              ) : null}
              {found.length > 0 ? (
                <DocumentFindings
                  applicantId={id}
                  canApprove={data.coreGranted}
                  proposals={found.map((reading) => findingViewModel(reading, data.confirmed))}
                />
              ) : null}
            </article>
          ))}
          {unread.length > 0 ? (
            <section className="u-mb-150" aria-labelledby="not-read-title">
              <h2 className="card-title" id="not-read-title">
                {t.node('appApplicant.appApplicantIdReviewPage.filesNotReadYet')}
              </h2>
              {unread.map(({ doc, versionId, state, copy }) => (
                <article
                  key={doc.id}
                  className="card u-mb-150"
                  aria-labelledby={`unread-${doc.id}`}
                >
                  <h3 className="card-title" id={`unread-${doc.id}`}>
                    {doc.approvedName ?? doc.originalName}
                  </h3>
                  <ReadingStatus copy={copy} stage={state.stage} applicantId={id} />
                  {data.canAskToRead ? (
                    <ReadAgainButton
                      applicantId={id}
                      documentVersionId={versionId}
                      label={
                        NEVER_READ.includes(state.reason ?? '')
                          ? t('appApplicant.appApplicantIdReviewPage.readThisDocument')
                          : t('appApplicant.appApplicantIdReviewPage.readAgain')
                      }
                    />
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
          {inBatch ? (
            <p className="field-hint">
              <Link href={`/app/applicant/${id}/review`}>
                {t.node('appApplicant.appApplicantIdReviewPage.seeEverythingThatIsWaiting')}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
