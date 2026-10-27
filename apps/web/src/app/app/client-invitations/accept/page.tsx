import {
  getConsents,
  getOrganizationBrandingForDisplay,
  listApplicants,
  previewClientInvitation,
} from '@visastack/services';
import type { Metadata } from 'next';
import { InvitingAgency } from '../../../../components/inviting-agency';
import { clientInvitationTerms } from '../../../../lib/client-invitation-terms';
import { withSession } from '../../../../lib/session';
import { AcceptClientInvitationForm } from './accept-form';
import { ConsentGate } from './consent-gate';

export const metadata: Metadata = {
  title: 'Invitation from an Agency',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

/**
 * Accept an agency's client invitation (Commercial V1 Part 4 §6, IAM-03).
 * Deliberately a preview-then-confirm page, not auto-accept-on-visit: a GET
 * request must never spend the one-time token as a side effect of
 * rendering, so `previewClientInvitation` never consumes it, only the
 * explicit form submission in `AcceptClientInvitationForm` does. The
 * traveller sees exactly what scope they'd be granting and to whom, picks
 * which of their own applicant profiles it attaches to, and must hold both
 * CORE_PROCESSING and SHARING consent before the accept form even appears
 * (`acceptClientInvitation` refuses without them anyway; this surfaces that
 * requirement up front instead of as a late failure).
 */
export default async function AcceptClientInvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">This invitation link is missing its token.</p>
        </article>
      </section>
    );
  }

  const data = await withSession(async ({ db, accountId }) => {
    const preview = await previewClientInvitation(db, token, accountId);
    if (!preview.ok) return { preview, consents: null, applicants: [], branding: undefined };
    const [consents, applicants, branding] = await Promise.all([
      getConsents(db, accountId),
      listApplicants(db, accountId),
      getOrganizationBrandingForDisplay(db, preview.value.organizationId),
    ]);
    return { preview, consents, applicants, branding };
  });

  // The same sentences the public page showed before sign-in, from the same real access.
  const terms = data.preview.ok ? clientInvitationTerms(data.preview.value.grantActions) : null;
  const coreGranted = data.consents?.CORE_PROCESSING === true;
  const sharingGranted = data.consents?.SHARING === true;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">Invitation</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          Work with an Agency
        </h1>
      </div>
      <article className="card">
        {!data.preview.ok ? (
          <p className="card-body">
            {data.preview.error.code === 'not_found'
              ? 'This invitation link is not valid.'
              : data.preview.error.message}
          </p>
        ) : (
          <>
            <InvitingAgency
              name={data.preview.value.organizationName}
              accentColor={data.branding?.accentColor ?? null}
              logoUrl={data.branding?.logoUrl ?? null}
            />
            <p className="card-body">
              <strong>{data.preview.value.organizationName}</strong> wants to work with you on{' '}
              {data.preview.value.requestedRoute ? (
                <strong>{data.preview.value.requestedRoute}</strong>
              ) : (
                'a new case'
              )}
              .
            </p>
            <p className="card-body" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              If you accept, they will be able to:
            </p>
            {terms ? (
              <>
                <ul style={{ margin: '0 0 1.25rem', paddingLeft: '1.25rem' }}>
                  {terms.agencyCan.map((sentence) => (
                    <li key={sentence} className="muted u-fs-085">
                      {sentence}
                    </li>
                  ))}
                </ul>
                {terms.agencyCannot ? <p className="card-body">{terms.agencyCannot}</p> : null}
              </>
            ) : (
              <p className="card-body">
                This invitation cannot be shown right now. Ask the agency to send it again.
              </p>
            )}

            {!terms ? null : !coreGranted || !sharingGranted ? (
              <>
                <p className="card-body">Turn these on before accepting (both are required):</p>
                <ConsentGate core={coreGranted} sharing={sharingGranted} />
              </>
            ) : (
              <AcceptClientInvitationForm
                token={token}
                applicants={data.applicants.map((a) => ({ id: a.id, displayName: a.displayName }))}
              />
            )}
          </>
        )}
      </article>
    </section>
  );
}
