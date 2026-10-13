import { getRetentionPolicies, previewContributorRequest } from '@visastack/services';
import type { Metadata } from 'next';
import { documentTypeLabel } from '../../../../lib/labels';
import { withSession } from '../../../../lib/session';
import { SubmitEvidenceForm } from './submit-evidence-form';

export const metadata: Metadata = { title: 'Add evidence for a request' };

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
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">This link is missing its token.</p>
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
        <span className="eyebrow">Contributor request</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          Provide one document
        </h1>
      </div>
      <article className="card">
        {!data.preview.ok ? (
          <p className="card-body">
            {data.preview.error.code === 'not_found'
              ? 'This link is not valid.'
              : data.preview.error.message}
          </p>
        ) : (
          <>
            <p className="card-body">
              <strong>{data.preview.value.applicantName}</strong> is asking you for a document to
              support their <strong>{data.preview.value.missionTitle}</strong> case:{' '}
              <strong>{documentTypeLabel(data.preview.value.docType).toLowerCase()}</strong>.
            </p>
            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              Why:
            </p>
            <p className="card-body u-mb-100">{data.preview.value.purpose}</p>
            {data.preview.value.message ? (
              <>
                <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                  Message:
                </p>
                <p className="card-body u-mb-100">{data.preview.value.message}</p>
              </>
            ) : null}

            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              Who will see this:
            </p>
            <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem' }}>
              <li className="muted u-fs-090">{data.preview.value.applicantName} (the traveller)</li>
              {data.preview.value.recipientOrganizationNames.map((name) => (
                <li className="muted u-fs-090" key={name}>
                  {name} (helping with this case)
                </li>
              ))}
            </ul>

            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
              How long it's kept:
            </p>
            <p className="card-body u-mb-100">
              {retentionDays !== null
                ? `${retentionDays} days from upload, under this platform's standard retention policy.`
                : "This document type doesn't have a specific retention period configured yet."}
            </p>

            <div className="notice notice-warn u-mb-125">
              This document may be included in the case file the applicant reviews and submits for
              their case. Do not upload anything you would not want the applicant and anyone helping
              with their case to eventually see.
            </div>

            {!data.preview.value.emailMatches ? (
              <p className="card-body" style={{ color: 'var(--danger, #b42318)' }}>
                This request was sent to a different email address than the one you're signed in
                with. Sign in with the email it was sent to before continuing.
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
