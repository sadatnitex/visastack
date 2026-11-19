import type { Metadata } from 'next';
import Link from 'next/link';
import { appInvitationsCatalog } from '../../../../i18n/app-invitations';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';

export const metadata: Metadata = {
  title: 'Invitation Declined',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * DECL1: where a person lands after saying no to a sharing, client, contributor or agency
 * invitation. It reads nothing and names nothing: the decline has already happened, and the same
 * page follows every kind, so the address says nothing about which invitation it was.
 */
export default async function InvitationDeclinedPage() {
  await primeLocale();
  const t = getServerT(appInvitationsCatalog);
  return (
    <section className="section container">
      <h1 className="section-title">
        {t.node('appInvitations.appInvitationsDecl1.declinedTitle')}
      </h1>
      <article className="card">
        <p className="card-body">{t.node('appInvitations.appInvitationsDecl1.declinedBody')}</p>
        <Link className="btn btn-secondary" href="/app">
          {t.node('appInvitations.appInvitationsDecl1.returnToYourWorkspace')}
        </Link>
      </article>
    </section>
  );
}
