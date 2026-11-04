import {
  accountPrincipal,
  getAiFeatureStates,
  getApplicant,
  hasConsent,
  listApplicantProfile,
  listDocumentReadingStates,
  listDocumentsDetailed,
  listPendingProposals,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { confirmedValues, findingViewModel } from '../../../../../lib/document-findings';
import { readingStatusCopy } from '../../../../../lib/document-reading';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';
import { DocumentFindings, ReadAgainButton } from '../ai-review';
import { ReadingStatus } from '../reading-status';

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
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    return {
      name: applicant.displayName,
      coreGranted,
      proposals,
      reading,
      canAskToRead,
      documents: rows,
      confirmed: confirmedValues(profile, encryption !== undefined),
    };
  });
  if (!data) notFound();

  // Each file with what was found in it, newest file first; only a reading that came from a file.
  const groups = data.documents.flatMap((doc) => {
    const versionId = doc.latestVersionId;
    if (!versionId) return [];
    const found = data.proposals.filter(
      (reading) => reading.proposal.documentVersionId === versionId,
    );
    return found.length > 0 ? [{ doc, found }] : [];
  });
  const total = groups.reduce((sum, group) => sum + group.found.length, 0);
  // Files nothing was found in, with why and, when asking is on, one tap to read them now.
  const unread = data.documents.flatMap((doc) => {
    const versionId = doc.latestVersionId;
    const state = versionId ? data.reading?.states.get(versionId) : undefined;
    if (!versionId || state?.stage !== 'could_not_read') return [];
    const copy = readingStatusCopy(state, { canReadAgain: data.canAskToRead });
    return copy ? [{ doc, versionId, state, copy }] : [];
  });
  /** Reasons a file was never read at all, so the button says "Read This Document". */
  const NEVER_READ = ['PROTECTED', 'NOT_TRIED', 'FEATURE_OFF', 'SWITCHED_OFF', 'NO_CONSENT'];

  return (
    <>
      <PageHeader
        title="What We Found"
        description="Details we read from your documents. Nothing is added to your profile until you accept it."
        back={{ href: `/app/applicant/${id}`, label: 'Home' }}
      />
      {!data.coreGranted ? (
        <article className="card">
          <p className="card-body">
            Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
            <Link href="/app">Home</Link> to add details to your profile.
          </p>
        </article>
      ) : groups.length === 0 && unread.length === 0 ? (
        <EmptyState
          title="You Are Up to Date"
          why="Every detail we found has been answered. Add a document to find more."
          action={{ href: `/app/applicant/${id}/documents/add`, label: 'Add Documents' }}
        >
          Nothing is waiting for you.
        </EmptyState>
      ) : (
        <>
          {groups.length > 0 ? (
            <p className="card-body u-mb-150">
              {plural(total, 'Detail', 'Details')} found in{' '}
              {plural(groups.length, 'document', 'documents')}. Accept the clear ones at once, or
              one by one. Sensitive details, such as an ID number, are always decided one at a time.
            </p>
          ) : null}
          {groups.map(({ doc, found }) => (
            <article key={doc.id} className="card u-mb-150" aria-labelledby={`found-${doc.id}`}>
              <h2 className="card-title" id={`found-${doc.id}`}>
                {doc.approvedName ?? doc.originalName}
              </h2>
              <DocumentFindings
                applicantId={id}
                canApprove={data.coreGranted}
                proposals={found.map((reading) => findingViewModel(reading, data.confirmed))}
              />
            </article>
          ))}
          {unread.length > 0 ? (
            <section className="u-mb-150" aria-labelledby="not-read-title">
              <h2 className="card-title" id="not-read-title">
                Files Not Read Yet
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
                          ? 'Read This Document'
                          : 'Read Again'
                      }
                    />
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
