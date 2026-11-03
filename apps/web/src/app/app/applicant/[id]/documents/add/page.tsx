import { ORIGINAL_DOCUMENT_KEYS, resolveDocumentType } from '@visastack/core/catalogue';
import {
  accountPrincipal,
  documentUploadReceiptsReady,
  familyBatchReady,
  getApplicant,
  getApplicantEvidenceBytes,
  hasConsent,
  loadUploadQuotaConfig,
  mbLabel,
  requireAccess,
  storageLimitsForOwner,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../../components/ui';
import { resolvePlatformCapabilities } from '../../../../../../lib/capabilities';
import { evidenceDocumentGroups } from '../../../../../../lib/master-profile';
import { withSession } from '../../../../../../lib/session';
import { pdfUploadsAccepted, uploadLimitBytes } from '../../../../../../lib/upload-preflight';
import { DocumentUploader } from '../../document-uploader';
import { ImportPanel } from '../../import/import-panel';
import { UsageMeter } from '../../usage-meter';

export const metadata: Metadata = { title: 'Add Documents' };

export const dynamic = 'force-dynamic';

const ORIGINAL_KINDS: readonly string[] = [...ORIGINAL_DOCUMENT_KEYS];

/** What happens to a file after it is added, in the order it happens. Plain words, no jargon. */
const NEXT_STEPS: readonly { readonly title: string; readonly line: string }[] = [
  { title: 'Checked for Safety', line: 'Every file is scanned before anyone can open it.' },
  { title: 'Read for Details', line: 'We suggest details from what we can read.' },
  {
    title: 'You Approve',
    line: 'Nothing reaches your profile until you accept it, one detail at a time or all clear ones at once.',
  },
];

/**
 * The one door for adding documents: drop files, or a whole folder, in one place. The
 * ways that need a choice (a photo from the camera, saying what kind of document it is) wait
 * behind one quiet disclosure so the first view is a single, simple action. The same rules apply as
 * everywhere: documents are added to this person's own record, pass the safety scan, and every
 * suggested detail is approved by a person.
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
    return {
      name: applicant.displayName,
      coreGranted,
      evidenceBytes,
      quota,
      personLimitBytes: limits.personBytes,
      receiptsReady,
      virusScanning,
      familyBatch,
    };
  });
  if (!data) notFound();

  const limitBytes = uploadLimitBytes(data.quota);
  const limitLabel = mbLabel(limitBytes);

  return (
    <>
      <PageHeader
        title="Add Documents"
        description="Drop your files or a whole folder here. We check each one, read what we can, and you approve every detail."
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
          <article className="card add-door">
            <ImportPanel
              applicantId={id}
              limitBytes={limitBytes}
              limitLabel={limitLabel}
              pdfAccepted={pdfUploadsAccepted()}
              retryUnknown={data.receiptsReady}
              familyBatch={data.familyBatch}
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
              {NEXT_STEPS.map((step) => (
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
