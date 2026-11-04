import { ORIGINAL_DOCUMENT_KEYS, resolveDocumentType } from '@visastack/core/catalogue';
import {
  accountPrincipal,
  documentUploadReceiptsReady,
  familyBatchReady,
  getAiFeatureStates,
  getApplicant,
  getApplicantEvidenceBytes,
  hasConsent,
  listApplicants,
  listDocumentExceptions,
  listPendingProposals,
  loadUploadQuotaConfig,
  mbLabel,
  requireAccess,
  storageLimitsForOwner,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NextStepCard, PageHeader } from '../../../../../../components/ui';
import { resolvePlatformCapabilities } from '../../../../../../lib/capabilities';
import { evidenceDocumentGroups } from '../../../../../../lib/master-profile';
import { describeReading } from '../../../../../../lib/reading-state';
import { addCheckStep } from '../../../../../../lib/scan-state';
import { withSession } from '../../../../../../lib/session';
import { pdfUploadsAccepted, uploadLimitBytes } from '../../../../../../lib/upload-preflight';
import { DocumentUploader } from '../../document-uploader';
import { ImportPanel } from '../../import/import-panel';
import { UsageMeter } from '../../usage-meter';
import { ReadingSwitch } from './reading-switch';

export const metadata: Metadata = { title: 'Add Documents' };

export const dynamic = 'force-dynamic';

const ORIGINAL_KINDS: readonly string[] = [...ORIGINAL_DOCUMENT_KEYS];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What happens to a file after it is added, in the order it happens. Plain words, no jargon. The
 * first step follows whether virus scanning is really switched on (the platform check, not a
 * promise): without it the step says the checks are about the file type and structure only.
 */
function nextSteps(
  reads: boolean,
  virusScanning: boolean,
): readonly { readonly title: string; readonly line: string }[] {
  return [
    addCheckStep(virusScanning),
    reads
      ? { title: 'Read for Details', line: 'We suggest details from what we can read.' }
      : {
          title: 'You Add the Details',
          line: 'Automatic reading is off, so nothing is read from your files. You add each detail yourself.',
        },
    {
      title: 'You Approve',
      line: 'Nothing reaches your profile until you accept it, one detail at a time or all clear ones at once.',
    },
  ];
}

/**
 * The one door for adding documents: drop files, or a whole folder, in one place. The
 * ways that need a choice (a photo from the camera, saying what kind of document it is) wait
 * behind one quiet disclosure so the first view is a single, simple action. The same rules apply as
 * everywhere: documents are added to this person's own record, are checked as the platform really
 * checks them (see scan-state.ts), and every suggested detail is approved by a person.
 */
export default async function AddDocumentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { id } = await params;
  const { type: requestedType } = await searchParams;
  // Only a kind the catalogue knows opens the kind choice ready; anything else is ignored.
  const initialKind =
    typeof requestedType === 'string' ? (resolveDocumentType(requestedType)?.key ?? '') : '';
  const documentGroups = evidenceDocumentGroups();

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const quota = loadUploadQuotaConfig();
    const [coreGranted, evidenceBytes, access, receiptsReady, virusScanning, limits] =
      await Promise.all([
        hasConsent(db, accountId, 'CORE_PROCESSING'),
        getApplicantEvidenceBytes(db, id),
        requireAccess(
          db,
          accountPrincipal(accountId),
          'VIEW_METADATA',
          { applicantId: id },
          { purpose: 'self' },
        ),
        documentUploadReceiptsReady(db).catch(() => false),
        resolvePlatformCapabilities(db).then((c) => c.malwareScanning === 'available'),
        storageLimitsForOwner(db, applicant.ownerAccountId, quota),
      ]);
    // The family batch is an extra: if it cannot be read, the import simply has no family choice.
    const familyBatch = access.ok ? await familyBatchReady(db).catch(() => false) : false;
    // The people this account keeps records for, this person first: the choice of who a file is for.
    // An extra: if the list cannot be read the import simply has no person choice.
    const everyone = await listApplicants(db, accountId).catch(() => []);
    const people = [
      ...everyone.filter((person) => person.id === id),
      ...everyone.filter((person) => person.id !== id),
    ].map((person) => ({ id: person.id, name: person.displayName }));
    // Whether a file added now will really be read: the same platform, plan and limit check the
    // reading job makes, and the person's own two consents. If any of it cannot be read, the page
    // says reading is off; it never says on without knowing.
    const [extractionAllowed, scansAllowed, readingFeature] = await Promise.all([
      hasConsent(db, accountId, 'AI_EXTRACTION').catch(() => false),
      hasConsent(db, accountId, 'AI_OCR').catch(() => false),
      access.ok
        ? getAiFeatureStates(db, ['ai_automatic_reading'] as const, { proof: access.value })
            .then((states) => states.ai_automatic_reading)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    const reading = describeReading({
      feature: readingFeature,
      extraction: extractionAllowed,
      ocr: scansAllowed,
    });
    // What the files already added have produced, so the page can say so and offer the next
    // step. Read only for the person's own proof and with consent on; extras: if either cannot be
    // read the page just shows no card, never an error.
    const [pending, understanding] =
      coreGranted && access.ok
        ? await Promise.all([
            listPendingProposals(db, id).catch(() => []),
            listDocumentExceptions(access.value).catch(() => ({ exceptions: [], confirmed: [] })),
          ])
        : [[], { exceptions: [], confirmed: [] }];
    return {
      name: applicant.displayName,
      coreGranted,
      evidenceBytes,
      quota,
      personLimitBytes: limits.personBytes,
      receiptsReady,
      virusScanning,
      familyBatch,
      people,
      reading,
      // Suggestions that came from a document (an app's suggestion about the profile is not one).
      foundDetails: pending.filter((p) => p.proposal.documentVersionId !== null).length,
      // Files, not rows: one file can have both a relation suggestion and an intake finding.
      needsAnswer: new Set(understanding.exceptions.map((e) => e.documentId)).size,
    };
  });
  if (!data) notFound();

  const limitBytes = uploadLimitBytes(data.quota);
  const limitLabel = mbLabel(limitBytes);

  return (
    <>
      <PageHeader
        title="Add Documents"
        description={
          data.reading.reads
            ? 'Drop your files or a whole folder here. We check each one, read what we can, and you approve every detail.'
            : 'Drop your files or a whole folder here. We check each one and keep it for you.'
        }
        back={{ href: `/app/applicant/${id}/documents`, label: 'Documents' }}
      />
      {!data.coreGranted ? (
        <article className="card">
          <p className="card-body">
            Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
            <Link href="/app">Home</Link> to add new documents. Your existing documents stay
            visible.
          </p>
        </article>
      ) : (
        <>
          {data.foundDetails > 0 ? (
            <NextStepCard
              title={`We Found ${plural(data.foundDetails, 'Detail', 'Details')} to Check`}
              why="Accept what is right and skip what is not. Nothing reaches your profile until you do."
              href={`/app/applicant/${id}/review`}
              action={`Review ${plural(data.foundDetails, 'Detail', 'Details')}`}
            />
          ) : null}
          {data.needsAnswer > 0 ? (
            <p className="add-answer">
              <Link href={`/app/applicant/${id}/documents#needs-decision`}>
                {plural(data.needsAnswer, 'File Needs', 'Files Need')} One Answer
              </Link>
            </p>
          ) : null}
          <article className="card add-door">
            <ReadingSwitch applicantId={id} view={data.reading} />
            <ImportPanel
              applicantId={id}
              limitBytes={limitBytes}
              limitLabel={limitLabel}
              pdfAccepted={pdfUploadsAccepted()}
              retryUnknown={data.receiptsReady}
              familyBatch={data.familyBatch}
              people={data.people}
              readingOn={data.reading.reads}
              showNext={false}
            />
            <details className="add-more" open={initialKind ? true : undefined}>
              <summary className="add-more-summary">
                Take a Photo, or Say What Kind of Document It Is
              </summary>
              <DocumentUploader
                key={initialKind}
                applicantId={id}
                limitBytes={limitBytes}
                limitLabel={limitLabel}
                pdfAccepted={pdfUploadsAccepted()}
                virusScanning={data.virusScanning}
                kindGroups={documentGroups}
                initialKind={initialKind}
                originalKinds={ORIGINAL_KINDS}
              />
            </details>
            <UsageMeter
              label="Evidence Storage"
              usedBytes={data.evidenceBytes}
              limitBytes={data.personLimitBytes}
            />
          </article>
          <section className="add-next" aria-labelledby="add-next-title">
            <h2 id="add-next-title" className="card-title">
              What Happens Next
            </h2>
            <ol className="add-next-list">
              {nextSteps(data.reading.reads, data.virusScanning).map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span className="muted">{step.line}</span>
                </li>
              ))}
            </ol>
            <Link className="btn btn-secondary" href={`/app/applicant/${id}/documents`}>
              Open My Documents
            </Link>
          </section>
        </>
      )}
    </>
  );
}
