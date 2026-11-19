import {
  getConsents,
  invitationDeclineAvailable,
  previewSharingInvitation,
  sharingInvitationSender,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeclineInvitation } from '../../../../components/decline-invitation';
import { appSharingInvitationsCatalog } from '../../../../i18n/app-sharing-invitations';
import { formatTimestampDate } from '../../../../lib/format-date';
import { getServerLocale, getServerT, primeLocale } from '../../../../lib/i18n-server';
import { categoryLabel } from '../../../../lib/master-profile';
import { recipientPermissionSentence } from '../../../../lib/permission-phrases';
import { plural } from '../../../../lib/plural';
import { serviceErrorText, serviceErrorTranslator } from '../../../../lib/service-error-text';
import { withSession } from '../../../../lib/session';
import { ConsentGate } from '../../client-invitations/accept/consent-gate';
import { AcceptFold, AreaPicture, PersonPicture, TravellerRow } from '../../u7-rows';
import { AcceptSharingInvitationForm } from './accept-form';
import { declineSharingInvitationAction } from './actions';

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
          <p>{serviceErrorText(result.error, serviceErrorTranslator(getServerLocale()))}</p>
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
    // DECL1: Decline is offered only once the update that stores it is in place.
    const [consent, sender, declineReady] = await Promise.all([
      getConsents(db, accountId),
      sharingInvitationSender(db, { actorAccountId: accountId, invitation: invite }),
      invitationDeclineAvailable(db),
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
          <TravellerRow
            headingLevel={2}
            title={sender ? sender.email : invite.purpose}
            picture={
              sender ? (
                <PersonPicture name={sender.email} />
              ) : (
                <AreaPicture mark={{ icon: 'share', tone: 'blue' }} />
              )
            }
            chip={{
              label: `${t('appSharingInvitations.appSharingInvitationsAcceptPage.accessEnds')} ${formatTimestampDate(invite.grantExpiryAt)}`,
              tone: 'neutral',
            }}
          />
          <AcceptFold title={t.node('appSharingInvitations.appSharingInvitationsU7.whatIsShared')}>
            <dl className="rows">
              {sender ? (
                <div className="row">
                  <dt>
                    {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.sharedBy')}
                  </dt>
                  <dd>{sender.email}</dd>
                </div>
              ) : null}
              <div className="row">
                <dt>{t.node('appSharingInvitations.appSharingInvitationsAcceptPage.purpose')}</dt>
                <dd>{invite.purpose}</dd>
              </div>
              <div className="row">
                <dt>
                  {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.permissions')}
                </dt>
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
                  {t.node(
                    'appSharingInvitations.appSharingInvitationsAcceptPage.profileCategories',
                  )}
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
                <dt>
                  {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.accessEnds')}
                </dt>
                <dd>{formatTimestampDate(invite.grantExpiryAt)}</dd>
              </div>
              <div className="row">
                <dt>
                  {t.node(
                    'appSharingInvitations.appSharingInvitationsAcceptPage.invitationExpires',
                  )}
                </dt>
                <dd>{formatTimestampDate(invite.expiresAt)}</dd>
              </div>
            </dl>
          </AcceptFold>
          <ConsentGate core={consent.CORE_PROCESSING} sharing={consent.SHARING} />
          {consent.CORE_PROCESSING && consent.SHARING ? (
            <AcceptSharingInvitationForm token={token} />
          ) : (
            <p>
              Review and turn on the required consent above to continue.{' '}
              <Link href="/privacy">Read the Privacy Notice</Link>.
            </p>
          )}
          {declineReady ? (
            <DeclineInvitation
              token={token}
              action={declineSharingInvitationAction}
              labels={{
                decline: t.node('appSharingInvitations.appSharingInvitationsDecl1.decline'),
                explain: t.node('appSharingInvitations.appSharingInvitationsDecl1.explain'),
                confirm: t.node('appSharingInvitations.appSharingInvitationsDecl1.confirm'),
                busy: t.node('appSharingInvitations.appSharingInvitationsDecl1.busy'),
              }}
            />
          ) : null}
          <Link href="/app">
            {t.node('appSharingInvitations.appSharingInvitationsAcceptPage.leaveWithoutAccepting')}
          </Link>
        </article>
      </section>
    );
  });
}
