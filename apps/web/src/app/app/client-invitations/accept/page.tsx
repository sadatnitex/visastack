import {
  GRANT_DEFAULT_DURATION_DAYS,
  aiAssistAvailable,
  getConsents,
  getOrganizationBrandingForDisplay,
  listApplicants,
  previewClientInvitation,
} from '@visastack/services';
import type { Metadata } from 'next';
import { InvitingAgency } from '../../../../components/inviting-agency';
import { appClientInvitationsCatalog } from '../../../../i18n/app-client-invitations';
import {
  clientAccessDurationLine,
  clientInvitationTerms,
} from '../../../../lib/client-invitation-terms';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
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
  // The agency line below reads the visitor's language.
  await primeLocale();
  const t = getServerT(appClientInvitationsCatalog);
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            {t(
              'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsMissingIts',
            )}
          </p>
        </article>
      </section>
    );
  }

  const data = await withSession(async ({ db, accountId }) => {
    const preview = await previewClientInvitation(db, token, accountId);
    if (!preview.ok) return { preview, consents: null, applicants: [], branding: undefined };
    const [consents, applicants, branding, aiReady] = await Promise.all([
      getConsents(db, accountId),
      listApplicants(db, accountId),
      getOrganizationBrandingForDisplay(db, preview.value.organizationId),
      aiAssistAvailable(db),
    ]);
    return { preview, consents, applicants, branding, aiReady };
  });

  // The same sentences the public page showed before sign-in, from the same real access.
  const terms = data.preview.ok ? clientInvitationTerms(data.preview.value.grantActions) : null;
  const coreGranted = data.consents?.CORE_PROCESSING === true;
  const sharingGranted = data.consents?.SHARING === true;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">
          {t('appClientInvitations.appClientInvitationsAcceptPage.invitation')}
        </span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          {t('appClientInvitations.appClientInvitationsAcceptPage.workWithAnAgency')}
        </h1>
      </div>
      <article className="card">
        {!data.preview.ok ? (
          <p className="card-body">
            {data.preview.error.code === 'not_found'
              ? t(
                  'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsNotValid',
                )
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
              {t('appClientInvitations.appClientInvitationsAcceptPage.ifYouAcceptTheyWillBe')}
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
                <p className="card-body" data-testid="client-access-duration">
                  {clientAccessDurationLine(GRANT_DEFAULT_DURATION_DAYS)}
                </p>
              </>
            ) : (
              <p className="card-body">
                {t(
                  'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationCannotBeShownRight',
                )}
              </p>
            )}

            {!terms ? null : !coreGranted || !sharingGranted ? (
              <>
                <p className="card-body">
                  {t(
                    'appClientInvitations.appClientInvitationsAcceptPage.turnTheseOnBeforeAcceptingBoth',
                  )}
                </p>
                <ConsentGate core={coreGranted} sharing={sharingGranted} />
              </>
            ) : (
              <AcceptClientInvitationForm
                token={token}
                applicants={data.applicants.map((a) => ({ id: a.id, displayName: a.displayName }))}
                {...('aiReady' in data && data.aiReady
                  ? { agencyAi: { agencyName: data.preview.value.organizationName } }
                  : {})}
              />
            )}
          </>
        )}
      </article>
    </section>
  );
}
