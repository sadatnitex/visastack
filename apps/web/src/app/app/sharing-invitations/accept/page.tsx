import { getConsents, previewSharingInvitation } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { humanizeCode } from '../../../../lib/format-code';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { ConsentGate } from '../../client-invitations/accept/consent-gate';
import { AcceptSharingInvitationForm } from './accept-form';

const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export const metadata: Metadata = {
  title: 'Review shared access',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

export default async function SharingInvitationPage({
  searchParams,
}: { readonly searchParams: Promise<{ readonly token?: string }> }) {
  if (process.env[sharingInvitationFlag] !== 'true') notFound();
  const { token = '' } = await searchParams;
  return withSession(async ({ db, accountId }) => {
    const result = await previewSharingInvitation(db, {
      actorAccountId: accountId,
      rawToken: token,
    });
    if (!result.ok)
      return (
        <section className="section">
          <h1 className="section-title">Invitation unavailable</h1>
          <p>{result.error.message}</p>
          <p>Ask the sender for a new link or sign in with the invited email address.</p>
          <Link
            className="btn btn-secondary"
            href={`/auth/sign-in?next=${encodeURIComponent(`/app/sharing-invitations/accept?token=${token}`)}`}
          >
            Sign in with the invited email
          </Link>
          <Link href="/app">Return to your workspace</Link>
        </section>
      );
    const invite = result.value;
    const consent = await getConsents(db, accountId);
    return (
      <section className="section">
        <h1 className="section-title">Review shared access</h1>
        <article className="card">
          <p>Opening this invitation grants no access. Review everything before accepting.</p>
          <dl className="rows">
            <div className="row">
              <dt>Purpose</dt>
              <dd>{invite.purpose}</dd>
            </div>
            <div className="row">
              <dt>Permissions</dt>
              <dd>{invite.actions.map(humanizeCode).join(', ')}</dd>
            </div>
            <div className="row">
              <dt>Profile categories</dt>
              <dd>{invite.categories?.map(humanizeCode).join(', ') || 'All profile categories'}</dd>
            </div>
            <div className="row">
              <dt>Documents</dt>
              <dd>
                {invite.documentIds
                  ? `${invite.documentIds.length} selected documents`
                  : invite.documentScopeSnapshot
                    ? `${invite.documentScopeSnapshot.length} documents captured when invited`
                    : 'All documents in this profile'}
              </dd>
            </div>
            <div className="row">
              <dt>Access ends</dt>
              <dd>{formatTimestampDate(invite.grantExpiryAt)}</dd>
            </div>
            <div className="row">
              <dt>Invitation expires</dt>
              <dd>{formatTimestampDate(invite.expiresAt)}</dd>
            </div>
          </dl>
          <ConsentGate core={consent.CORE_PROCESSING} sharing={consent.SHARING} />
          {consent.CORE_PROCESSING && consent.SHARING ? (
            <AcceptSharingInvitationForm token={token} />
          ) : (
            <p>
              Review and grant the required consent above to continue.{' '}
              <Link href="/privacy">Read the privacy policy</Link>.
            </p>
          )}
          <Link href="/app">Leave without accepting</Link>
        </article>
      </section>
    );
  });
}
