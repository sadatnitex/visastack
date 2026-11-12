import { isOtherDocumentType } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue';
import {
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
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { documentTypeLabel } from '../../../../../lib/labels';
import { buildMasterProfileView } from '../../../../../lib/master-profile';
import { withSession } from '../../../../../lib/session';
import { RecordBrowser } from '../record-browser';
import { docTypeCarriesExpiry, recordGroupOfDocType } from '../record-groups';
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
  const locale = await primeLocale();
  const t = getServerT(appApplicantCatalog);
  const { id } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [profile, sectionChoices, wallet, detailed] = await Promise.all([
      listApplicantProfile(db, id),
      getProfileSectionState(db, id),
      getWalletView(db, { actorAccountId: accountId, applicantId: id }),
      // Present, like the wallet rows it describes: an archived document keeps its details (D6).
      listDocumentsDetailed(db, accountId, id, { lifecycle: 'present' }),
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
        const isOther = isOtherDocumentType(document.docType);
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
          // The catalogue's document group, named as the matching profile area where there is one.
          groupLabel: recordGroupOfDocType(document.docType),
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
            // A document with no kind yet waits for the person to choose one (owner decision 2026-10-25).
            kindNeedsCheck: !document.docType || summary?.classification?.reviewRequired === true,
            namePending: (summary?.pendingNameVersion ?? null) !== null,
          },
          version: summary?.latestVersionNumber ?? null,
          updatedLabel: summary?.updatedAt ? formatTimestampDate(summary.updatedAt, locale) : null,
          expiresLabel: document.expiresAt ? formatTimestampDate(document.expiresAt, locale) : null,
          expiryApplies: docTypeCarriesExpiry(document.docType),
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
        eyebrow={t('appApplicant.appApplicantIdExpiryPage.record')}
        title={t('appApplicant.appApplicantIdRecordPage.allRecords')}
        description={t('appApplicant.appApplicantIdRecordPage.everythingSavedForDisplaynameInOne', {
          displayName: data.applicant.displayName,
        })}
        actions={
          <>
            <Link className="btn btn-primary" href={`${base}/documents/add`}>
              {t('appApplicant.appApplicantIdRecordPage.addADocument')}
            </Link>
            <Link className="btn btn-secondary" href={`${base}/profile`}>
              {t('appApplicant.appApplicantIdRecordPage.updateYourProfile')}
            </Link>
          </>
        }
      />
      <p className="muted record-hub-note">
        {t('appApplicant.appApplicantIdRecordPage.currentVersionMeansThisIsThe')}
      </p>
      {documentsLoaded ? null : (
        <p role="alert" className="notice notice-warn">
          {t('appApplicant.appApplicantIdRecordPage.yourDocumentsCouldNotBeLoaded')}
        </p>
      )}
      {documentsLoaded && documents.length === 0 ? (
        <p className="notice record-hub-start">
          {t('appApplicant.appApplicantIdRecordPage.youHaveNotAddedADocument')}
        </p>
      ) : null}
      <RecordBrowser items={items} documentsLoaded={documentsLoaded} />
      {closedSections > 0 ? (
        <p className="muted">
          {closedSections === 1
            ? '1 more profile section is closed.'
            : `${closedSections} more profile sections are closed.`}{' '}
          <Link href={`${base}/profile?view=all`}>Open them from your profile</Link> when they apply
          to you.
        </p>
      ) : null}
    </div>
  );
}
