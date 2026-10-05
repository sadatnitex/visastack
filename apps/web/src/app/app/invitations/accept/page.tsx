import { previewOrganizationInvitation } from '@visastack/services';
import type { Metadata } from 'next';
import { withSession } from '../../../../lib/session';
import { AcceptInvitationForm } from './accept-form';

export const metadata: Metadata = { title: 'Team invitation' };

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

  const preview = await withSession(async ({ db, email }) =>
    previewOrganizationInvitation(db, { rawToken: token, actorEmail: email }),
  );

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <span className="eyebrow">Invitation</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          Join an organization
        </h1>
      </div>
      <article className="card">
        {!preview.ok ? (
          <p className="card-body">
            {preview.error.code === 'not_found'
              ? 'This invitation link is not valid.'
              : preview.error.message}
          </p>
        ) : (
          <>
            <p className="card-body">
              You&apos;ve been invited to join <strong>{preview.value.organizationName}</strong> as{' '}
              <strong>{preview.value.role}</strong>.
            </p>
            {preview.value.emailMatches ? (
              <AcceptInvitationForm token={token} />
            ) : (
              <p className="field-msg field-msg-err">
                This invitation was sent to {preview.value.invitedEmail}, but you&apos;re signed in
                with a different email address. Sign in as {preview.value.invitedEmail} to accept
                it.
              </p>
            )}
          </>
        )}
      </article>
    </section>
  );
}
