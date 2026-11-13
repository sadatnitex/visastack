import { getRetentionPolicies, previewContributorRequest } from '@visastack/services';
import type { Metadata } from 'next';
import { appContributorRequestsCatalog } from '../../../../i18n/app-contributor-requests';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { documentTypeLabel } from '../../../../lib/labels';
import { serviceErrorNode } from '../../../../lib/service-error-node';
import { withSession } from '../../../../lib/session';
import { SubmitEvidenceForm } from './submit-evidence-form';

export const metadata: Metadata = { title: 'Add Evidence for a Request' };

export const dynamic = 'force-dynamic';

/**
 * A CAS-08 contributor's one and only screen: what's being asked, who it's
 * for, who will see it, how long it's kept, and an honest note about the
 * applicant's own eventual final-file review - before they decide whether
 * to upload anything. Deliberately never a case, profile, or wallet view of
 * any kind; there is nothing here to browse.
 *
 * Preview-then-confirm, matching every other invitation flow in this
 * codebase: this GET page never consumes the token itself
 * (`previewContributorRequest` is read-only), only the explicit upload
 * submission in `SubmitEvidenceForm`'s action does.
 */
export default async function AcceptContributorRequestPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string }>;
}) {
  await primeLocale();
  const t = getServerT(appContributorRequestsCatalog);
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            {t.node(
              'appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsMissingItsToken',
            )}
          </p>
        </article>
      </section>
    );
  }

  const data = await withSession(async ({ db, email }) => {
    const preview = await previewContributorRequest(db, { rawToken: token, actorEmail: email });
    const policies = await getRetentionPolicies(db);
    return { preview, policies };
  });

  const requestedDocType = data.preview.ok ? data.preview.value.docType : null;
  const retentionDays =
    requestedDocType !== null
      ? (data.policies.find((p) => p.docType === requestedDocType)?.retentionDays ?? null)
      : null;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">
          {t.node('appContributorRequests.appContributorRequestsAcceptPage.contributorRequest')}
        </span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          {t.node('appContributorRequests.appContributorRequestsAcceptPage.provideOneDocument')}
        </h1>
      </div>
      <article className="card">
        {!data.preview.ok ? (
          <p className="card-body">
            {data.preview.error.code === 'not_found'
              ? t.node('appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsNotValid')
              : serviceErrorNode(data.preview.error)}
          </p>
        ) : (
          <>
            <p className="card-body">
              <strong>{data.preview.value.applicantName}</strong> is asking you for a document to
              support their <strong>{data.preview.value.missionTitle}</strong> case:{' '}
              <strong>{documentTypeLabel(data.preview.value.docType).toLowerCase()}</strong>.
            </p>
            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              {t.node('appContributorRequests.appContributorRequestsAcceptPage.why')}
            </p>
            <p className="card-body u-mb-100">{data.preview.value.purpose}</p>
            {data.preview.value.message ? (
              <>
                <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                  {t.node('appContributorRequests.appContributorRequestsAcceptPage.message')}
                </p>
                <p className="card-body u-mb-100">{data.preview.value.message}</p>
              </>
            ) : null}

            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              {t.node('appContributorRequests.appContributorRequestsAcceptPage.whoWillSeeThis')}
            </p>
            <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem' }}>
              <li className="muted u-fs-085">
                {t.node(
                  'appContributorRequests.appContributorRequestsAcceptPage.applicantnameTheTraveller',
                  { applicantName: data.preview.value.applicantName },
                )}
              </li>
              {data.preview.value.recipientOrganizationNames.map((name) => (
                <li className="muted u-fs-085" key={name}>
                  {t.node(
                    'appContributorRequests.appContributorRequestsAcceptPage.nameHelpingWithThisCase',
                    { name },
                  )}
                </li>
              ))}
            </ul>

            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              {t.node('appContributorRequests.appContributorRequestsAcceptPage.howLongItSKept')}
            </p>
            <p className="card-body u-mb-100">
              {retentionDays !== null
                ? t.node(
                    'appContributorRequests.appContributorRequestsAcceptPage.retentiondaysDaysFromUploadUnderThis',
                    { retentionDays },
                  )
                : t.node(
                    'appContributorRequests.appContributorRequestsAcceptPage.thisDocumentTypeDoesnTHave',
                  )}
            </p>

            <div className="notice notice-warn u-mb-125">
              {t.node(
                'appContributorRequests.appContributorRequestsAcceptPage.thisDocumentMayBeIncludedIn',
              )}
            </div>

            {!data.preview.value.emailMatches ? (
              <p className="card-body" style={{ color: 'var(--danger, #b42318)' }}>
                {t.node(
                  'appContributorRequests.appContributorRequestsAcceptPage.thisRequestWasSentToA',
                )}
              </p>
            ) : (
              <SubmitEvidenceForm token={token} docType={data.preview.value.docType} />
            )}
          </>
        )}
      </article>
    </section>
  );
}
