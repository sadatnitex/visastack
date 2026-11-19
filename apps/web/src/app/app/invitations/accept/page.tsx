import { invitationDeclineAvailable, previewOrganizationInvitation } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DeclineInvitation } from '../../../../components/decline-invitation';
import { appInvitationsCatalog } from '../../../../i18n/app-invitations';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { membershipRoleLabel } from '../../../../lib/labels';
import { serviceErrorNode } from '../../../../lib/service-error-node';
import { withSession } from '../../../../lib/session';
import { AreaPicture, TravellerRow } from '../../u7-rows';
import { AcceptInvitationForm } from './accept-form';
import { declineInvitationAction } from './actions';

export const metadata: Metadata = {
  title: 'Team Invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

/**
 * Accept a secure member invitation (Commercial V1 Part 4 §5). Deliberately
 * a preview-then-confirm page, not an auto-accept-on-visit one: a GET
 * request (link prefetching, a scanner following the URL) must never spend
 * a one-time token as a side effect of rendering: only the explicit form
 * submission below (`acceptInvitationAction`) actually consumes it.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly token?: string }>;
}) {
  await primeLocale();
  const t = getServerT(appInvitationsCatalog);
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            {t.node('appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsMissingIts')}
          </p>
        </article>
      </section>
    );
  }

  const { preview, declineReady } = await withSession(async ({ db, email }) => {
    const found = await previewOrganizationInvitation(db, { rawToken: token, actorEmail: email });
    // DECL1: Decline is offered only once the update that stores it is in place.
    return { preview: found, declineReady: found.ok && (await invitationDeclineAvailable(db)) };
  });

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">
          {t.node('appInvitations.appInvitationsAcceptPage.invitation')}
        </span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          {t.node('appInvitations.appInvitationsAcceptPage.joinAnOrganization')}
        </h1>
      </div>
      <article className="card">
        {!preview.ok ? (
          <p className="card-body">
            {preview.error.code === 'not_found'
              ? t.node('appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsNotValid')
              : serviceErrorNode(preview.error)}
          </p>
        ) : (
          <>
            <TravellerRow
              headingLevel={2}
              title={preview.value.organizationName}
              picture={<AreaPicture mark={{ icon: 'building', tone: 'blue' }} />}
              chip={{ label: membershipRoleLabel(preview.value.role), tone: 'info' }}
            />
            <p className="card-body u-mt-100">
              You&apos;ve been invited to join <strong>{preview.value.organizationName}</strong> as{' '}
              <strong>{membershipRoleLabel(preview.value.role).toLowerCase()}</strong>.
            </p>
            {preview.value.emailMatches ? (
              <>
                <AcceptInvitationForm token={token} />
                {declineReady ? (
                  <DeclineInvitation
                    token={token}
                    action={declineInvitationAction}
                    labels={{
                      decline: t.node('appInvitations.appInvitationsDecl1.decline'),
                      explain: t.node('appInvitations.appInvitationsDecl1.explain'),
                      confirm: t.node('appInvitations.appInvitationsDecl1.confirm'),
                      busy: t.node('appInvitations.appInvitationsDecl1.busy'),
                    }}
                  />
                ) : null}
              </>
            ) : (
              <p className="field-msg field-msg-err">
                This invitation was sent to {preview.value.invitedEmail}, but you&apos;re signed in
                with a different email address. Sign in as {preview.value.invitedEmail} to accept
                it.{' '}
                <Link
                  href={`/auth/sign-in?next=${encodeURIComponent(`/app/invitations/accept?token=${token}`)}`}
                >
                  Sign In with the Invited Email
                </Link>
                .
              </p>
            )}
          </>
        )}
      </article>
    </section>
  );
}
