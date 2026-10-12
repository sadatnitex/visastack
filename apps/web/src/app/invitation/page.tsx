import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Your invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

/** A public account handoff only. Details and acceptance remain behind authenticated service checks. */
export default async function InvitationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly kind?: string; readonly token?: string }>;
}) {
  const { kind, token } = await searchParams;
  if (
    !['team', 'client', 'sharing'].includes(kind ?? '') ||
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    return (
      <section className="section container">
        <h1 className="section-title">Incomplete invitation link</h1>
        <p>Ask the person who invited you for a new link.</p>
      </section>
    );
  }
  const path =
    kind === 'team'
      ? '/app/invitations/accept'
      : kind === 'sharing'
        ? '/app/sharing-invitations/accept'
        : '/app/client-invitations/accept';
  const next = encodeURIComponent(`${path}?token=${token}`);
  return (
    <section className="section container">
      <span className="eyebrow">VisaStack invitation</span>
      <h1 className="section-title">
        {kind === 'team'
          ? 'Join an agency team'
          : kind === 'sharing'
            ? 'Review shared access'
            : 'Work with an agency'}
      </h1>
      <article className="card">
        <p className="card-body">
          Create an account or sign in to review this invitation. Opening the link does not accept
          it.
        </p>
        <p className="card-body">
          {kind === 'team'
            ? 'Use the email address that received the invitation. You will see the agency and your role before joining.'
            : kind === 'sharing'
              ? 'Use the email address that received this invitation. Review the purpose, permissions and expiry before accepting. No access is active until you agree.'
              : 'You will see the agency and requested access, choose your own profile and confirm sharing before connecting.'}
        </p>
        <div className="action-row">
          <Link className="btn btn-primary" href={`/auth/sign-up?next=${next}`}>
            Create an account
          </Link>
          <Link className="btn btn-secondary" href={`/auth/sign-in?next=${next}`}>
            Sign in
          </Link>
        </div>
        <p className="card-body">
          Already signed in?{' '}
          {kind === 'team' ? (
            <Link href={`/app/invitations/accept?token=${token}`}>Review your invitation</Link>
          ) : kind === 'sharing' ? (
            <Link href={`/app/sharing-invitations/accept?token=${token}`}>
              Review your invitation
            </Link>
          ) : (
            <Link href={`/app/client-invitations/accept?token=${token}`}>
              Review your invitation
            </Link>
          )}
        </p>
        <p className="muted">
          If you need to reset your password, return to this invitation link afterwards.
        </p>
        <p className="muted">
          Invitations expire after 7 days. If this one has expired or was revoked, ask the sender
          for a new invitation.
        </p>
      </article>
    </section>
  );
}
