import {
  getConsents,
  previewSharingInvitation,
  sharingInvitationSender,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appSharingInvitationsCatalog } from '../../../../i18n/app-sharing-invitations';
import { formatTimestampDate } from '../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { categoryLabel } from '../../../../lib/master-profile';
import { recipientPermissionSentence } from '../../../../lib/permission-phrases';
import { plural } from '../../../../lib/plural';
import { withSession } from '../../../../lib/session';
import { ConsentGate } from '../../client-invitations/accept/consent-gate';
import { AcceptSharingInvitationForm } from './accept-form';

const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export const metadata: Metadata = {
  title: 'Review Shared Access',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

export default async function SharingInvitationPage({
  searchParams,
}: { readonly searchParams: Promise<{ readonly token?: string }> }) {
  await primeLocale();
  const t = getServerT(appSharingInvitationsCatalog);
  if (process.env[sharingInvitationFlag] !== 'true') notFound();
  const { token = '' } = await searchParams;
  return withSession(async ({ db, accountId }) => {
    const result = await previewSharingInvitation(db, {
      actorAccountId: accountId,
      rawToken: token,
    });
    if (!result.ok)
      return (
        <section className="section container">
          <h1 className="section-title">
            {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.invitationUnavailable')}
          </h1>
          <p>{result.error.message}</p>
          <p>
            {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.askTheSenderForANew')}
          </p>
          <Link
            className="btn btn-secondary"
            href={`/auth/sign-in?next=${encodeURIComponent(`/app/sharing-invitations/accept?token=${token}`)}`}
          >
            {t.node(
              'appSharingInvitations.appSharingInvitationsAcceptPage.signInWithTheInvitedEmail',
            )}
          </Link>
          <Link href="/app">
            {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.returnToYourWorkspace')}
          </Link>
        </section>
      );
    const invite = result.value;
    // Who is sharing (friction F3): their email, so the invited person can recognise the sender.
    // Nothing extra is shown if it cannot be found, never a guess.
    const [consent, sender] = await Promise.all([
      getConsents(db, accountId),
      sharingInvitationSender(db, { actorAccountId: accountId, invitation: invite }),
    ]);
    return (
      <section className="section container">
        <h1 className="section-title">
          {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.reviewSharedAccess')}
        </h1>
        <article className="card">
          <p>
            {t.node(
              'appSharingInvitations.appSharingInvitationsAcceptPage.openingThisInvitationGrantsNoAccess',
            )}
          </p>
          <dl className="rows">
            {sender ? (
              <div className="row">
                <dt>{t.node('appSharingInvitations.appSharingInvitationsAcceptPage.sharedBy')}</dt>
                <dd>{sender.email}</dd>
              </div>
            ) : null}
            <div className="row">
              <dt>{t.node('appSharingInvitations.appSharingInvitationsAcceptPage.purpose')}</dt>
              <dd>{invite.purpose}</dd>
            </div>
            <div className="row">
              <dt>{t.node('appSharingInvitations.appSharingInvitationsAcceptPage.permissions')}</dt>
              <dd>
                <ul className="u-m-0">
                  {invite.actions.map((action) => (
                    <li key={action}>{recipientPermissionSentence(action)}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="row">
              <dt>
                {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.profileCategories')}
              </dt>
              <dd>
                {invite.categories?.map(categoryLabel).join(', ') ||
                  t.node(
                    'appSharingInvitations.appSharingInvitationsAcceptPage.allProfileCategories',
                  )}
              </dd>
            </div>
            <div className="row">
              <dt>{t.node('appSharingInvitations.appSharingInvitationsAcceptPage.documents')}</dt>
              <dd>
                {invite.documentIds
                  ? plural(invite.documentIds.length, 'selected document')
                  : invite.documentScopeSnapshot
                    ? t.node(
                        'appSharingInvitations.appSharingInvitationsAcceptPage.pluralCapturedWhenInvited',
                        { plural: plural(invite.documentScopeSnapshot.length, 'document') },
                      )
                    : t.node(
                        'appSharingInvitations.appSharingInvitationsAcceptPage.allDocumentsInThisProfile',
                      )}
              </dd>
            </div>
            <div className="row">
              <dt>{t.node('appSharingInvitations.appSharingInvitationsAcceptPage.accessEnds')}</dt>
              <dd>{formatTimestampDate(invite.grantExpiryAt)}</dd>
            </div>
            <div className="row">
              <dt>
                {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.invitationExpires')}
              </dt>
              <dd>{formatTimestampDate(invite.expiresAt)}</dd>
            </div>
          </dl>
          <ConsentGate core={consent.CORE_PROCESSING} sharing={consent.SHARING} />
          {consent.CORE_PROCESSING && consent.SHARING ? (
            <AcceptSharingInvitationForm token={token} />
          ) : (
            <p>
              Review and turn on the required consent above to continue.{' '}
              <Link href="/privacy">Read the Privacy Notice</Link>.
            </p>
          )}
          <Link href="/app">
            {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.leaveWithoutAccepting')}
          </Link>
        </article>
      </section>
    );
  });
}
