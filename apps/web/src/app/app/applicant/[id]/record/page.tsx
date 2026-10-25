import { resolveDocumentType } from '@visastack/core/catalogue';
import {
  documentCategory,
  getApplicant,
  getProfileSectionState,
  getWalletView,
  isServableProcessingState,
  listApplicantProfile,
  listDocumentsDetailed,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { documentTypeLabel } from '../../../../../lib/labels';
import { buildMasterProfileView, categoryLabel } from '../../../../../lib/master-profile';
import { withSession } from '../../../../../lib/session';
import { RecordBrowser } from '../record-browser';
import { type RecordDetailsInput, type RecordDocumentInput, buildRecordItems } from '../record-hub';

export const metadata: Metadata = { title: 'All Records' };

export const dynamic = 'force-dynamic';

/**
 * The Personal Record hub (WP-V3 part 2, v1.2 B03 / U01). It reads only what the owner's own
 * profile and wallet pages already read, through the same owner-only services, and links to
 * those pages for every action. It adds no data, no new permission and no new way to share.
 */
export default async function ApplicantRecordPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [profile, sectionChoices, wallet, detailed] = await Promise.all([
      listApplicantProfile(db, id),
      getProfileSectionState(db, id),
      getWalletView(db, { actorAccountId: accountId, applicantId: id }),
      listDocumentsDetailed(db, accountId, id),
    ]);
    return { applicant, profile, sectionChoices, wallet, detailed };
  });
  if (!data) notFound();

  const base = `/app/applicant/${id}`;
  const view = buildMasterProfileView({
    entries: data.profile,
    activated: data.sectionChoices.activated,
    notApplicable: data.sectionChoices.notApplicable,
    noneDeclared: data.sectionChoices.noneDeclared,
    suggestFor: null,
  });
  const details: RecordDetailsInput[] = view.layers.flatMap((layer) =>
    layer.sections
      .filter((section) => section.open)
      .map((section) => ({
        key: section.key,
        label: section.label,
        groupLabel: layer.label,
        answered: section.answered,
        total: section.total,
      })),
  );
  const closedSections = view.totalSections - view.openSections;

  // When either document list cannot load, say so rather than show an empty record.
  const documentsLoaded = data.wallet.ok && data.detailed.ok;
  const summaries = new Map(
    (data.detailed.ok ? data.detailed.value : []).map((doc) => [doc.id, doc] as const),
  );
  const walletRows = data.wallet.ok ? data.wallet.value : [];
  const names = new Map(
    walletRows.map(
      ({ document }) => [document.id, document.approvedName ?? document.originalName] as const,
    ),
  );
  const documents: RecordDocumentInput[] = documentsLoaded
    ? walletRows.map(({ document, status, usedInMissions, accessibleTo }) => {
        const summary = summaries.get(document.id);
        const category = documentCategory(document.docType);
        const isOther =
          document.docType === 'OTHER' || (document.docType ?? '').startsWith('OTHER_');
        const replacedName = document.supersededByDocumentId
          ? names.get(document.supersededByDocumentId)
          : undefined;
        return {
          id: document.id,
          name: document.approvedName ?? document.originalName,
          typeLabel: document.docType
            ? isOther && document.subject
              ? document.subject
              : documentTypeLabel(document.docType)
            : null,
          typeKey: document.docType ? (resolveDocumentType(document.docType)?.key ?? null) : null,
          groupLabel: category ? categoryLabel(category) : null,
          lifecycle: status,
          safetyStatus: summary?.safetyStatus ?? null,
          processingStatus: summary?.processingStatus ?? null,
          // The services' own servable rule, the one that gates preview and download.
          checked:
            summary?.safetyStatus === 'CLEAN' &&
            summary.processingStatus !== null &&
            isServableProcessingState(summary.processingStatus),
          // The documents page's extra review signals.
          review: {
            expiryMissing: document.docType === 'PASSPORT' && !document.expiresAt,
            kindNeedsCheck: summary?.classification?.reviewRequired === true,
            namePending: (summary?.pendingNameVersion ?? null) !== null,
          },
          version: summary?.latestVersionNumber ?? null,
          updatedLabel: summary?.updatedAt ? formatTimestampDate(summary.updatedAt) : null,
          expiresLabel: document.expiresAt ? formatTimestampDate(document.expiresAt) : null,
          replacedBy:
            document.supersededByDocumentId && replacedName
              ? { id: document.supersededByDocumentId, name: replacedName }
              : null,
          usedIn: usedInMissions.map((mission) => mission.missionTitle),
          sharedWith: accessibleTo.map((entry) => entry.label),
        };
      })
    : [];
  const items = buildRecordItems({ applicantId: id, details, documents });

  return (
    <div className="stack record-hub-page">
      <PageHeader
        as="h2"
        title="All Records"
        description={`Everything saved for ${data.applicant.displayName}, in one place. Find a detail or a document, see which copy is current, then use it in a case or share it.`}
        actions={
          <>
            <Link className="btn btn-primary" href={`${base}/documents#document-upload`}>
              Add a Document
            </Link>
            <Link className="btn btn-secondary" href={`${base}/profile`}>
              Update Your Profile
            </Link>
          </>
        }
      />
      <p className="muted record-hub-note">
        Current Version means this is the newest copy you saved. It does not mean anyone has checked
        that it is genuine, or that it suits every application. Files still being checked, refused,
        expired or replaced are never shown as ready to use.
      </p>
      {documentsLoaded ? null : (
        <p role="alert" className="notice notice-warn">
          Your documents could not be loaded just now, so only your profile details are listed.
          Refresh the page to try again.
        </p>
      )}
      {documentsLoaded && documents.length === 0 ? (
        <p className="notice record-hub-start">
          You have not added a document yet. You can still fill in your details by hand now, and add
          a passport or other document whenever you have it.
        </p>
      ) : null}
      <RecordBrowser items={items} />
      {closedSections > 0 ? (
        <p className="muted">
          {closedSections === 1
            ? '1 more profile section is closed.'
            : `${closedSections} more profile sections are closed.`}{' '}
          <Link href={`${base}/profile`}>Open them from your profile</Link> when they apply to you.
        </p>
      ) : null}
    </div>
  );
}
