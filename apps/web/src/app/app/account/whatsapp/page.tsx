import { getWhatsAppConnection } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { appAccountCatalog } from '../../../../i18n/app-account';
import { formatDateOnly } from '../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../lib/i18n-server';
import { withSession } from '../../../../lib/session';
import { readWhatsAppConfig } from '../../../../lib/whatsapp';
import { disconnectWhatsAppAction } from './actions';
import { ConnectWhatsAppForm } from './connect-form';

export const metadata: Metadata = { title: 'WhatsApp' };

export const dynamic = 'force-dynamic';

/**
 * Connect or disconnect WhatsApp (Lane D contract sections 6 and 11). The connection is optional:
 * nothing in VisaStack depends on it, and losing the phone never locks anyone out.
 */
export default async function WhatsAppPage() {
  const locale = await primeLocale();
  const t = getServerT(appAccountCatalog);
  const available = readWhatsAppConfig() !== null;
  const connection = await withSession(({ db, accountId }) => getWhatsAppConnection(db, accountId));
  const ready = available && connection.available;
  // A connected person can always disconnect, even while the channel itself is switched off.
  const showConnected = connection.connected;

  return (
    <section className="section container">
      <PageHeader
        eyebrow={t('appAccount.appAccountPage.account')}
        title={t('appAccount.appAccountPage.whatsapp')}
        description={t('appAccount.appAccountWhatsappPage.askAboutYourCasesFromWhatsapp')}
      />
      <div className="grid">
        {showConnected ? (
          <article className="card">
            <p className="card-kicker">{t.node('appAccount.appAccountWhatsappPage.connected')}</p>
            <h2 className="card-title">
              {t.node('appAccount.appAccountWhatsappPage.yourWhatsappIsConnected')}
            </h2>
            <div className="rows rows-grid u-mt-050">
              {connection.maskedNumber ? (
                <p className="row">
                  <span className="row-key">
                    {t.node('appAccount.appAccountWhatsappPage.number')}
                  </span>
                  <span className="row-val">{connection.maskedNumber}</span>
                </p>
              ) : null}
              {connection.connectedAt ? (
                <p className="row">
                  <span className="row-key">
                    {t.node('appAccount.appAccountWhatsappPage.connectedOn')}
                  </span>
                  <span className="row-val">{formatDateOnly(connection.connectedAt, locale)}</span>
                </p>
              ) : null}
              <p className="row">
                <span className="row-key">
                  {t.node('appAccount.appAccountWhatsappPage.messages')}
                </span>
                <span className="row-val">
                  {connection.messagesOff
                    ? t.node('appAccount.appAccountWhatsappPage.offSendStartToTurnThem')
                    : t.node('appAccount.appAccountWhatsappPage.on')}
                </span>
              </p>
            </div>
            <p className="card-body u-mt-050">
              {t.node('appAccount.appAccountWhatsappPage.sendMenuInWhatsappToSee')}
            </p>
            <form action={disconnectWhatsAppAction}>
              <button type="submit" className="btn btn-secondary">
                {t.node('appAccount.appAccountWhatsappPage.disconnectWhatsapp')}
              </button>
            </form>
          </article>
        ) : !ready ? (
          <article className="card">
            <h2 className="card-title">
              {t.node('appAccount.appAccountWhatsappPage.whatsappIsNotAvailableYet')}
            </h2>
            <p className="card-body">
              {t.node('appAccount.appAccountWhatsappPage.youCanUseEverythingInVisastack')}
            </p>
          </article>
        ) : (
          <article className="card">
            <p className="card-kicker">
              {t.node('appAccount.appAccountWhatsappPage.notConnected')}
            </p>
            <h2 className="card-title">
              {t.node('appAccount.appAccountWhatsappPage.connectWhatsapp')}
            </h2>
            <p className="card-body u-mb-125">
              {t.node('appAccount.appAccountWhatsappPage.getAOneTimeCodeHere')}
            </p>
            <ConnectWhatsAppForm />
          </article>
        )}

        <article className="card">
          <p className="card-kicker">{t.node('appAccount.appAccountPage.privacy')}</p>
          <h2 className="card-title">
            {t.node('appAccount.appAccountWhatsappPage.whatHappensInWhatsapp')}
          </h2>
          <ul className="card-body">
            <li>{t.node('appAccount.appAccountWhatsappPage.youCanAskWhereYourCases')}</li>
            <li>{t.node('appAccount.appAccountWhatsappPage.visastackNeverAsksForPassportId')}</li>
            <li>{t.node('appAccount.appAccountWhatsappPage.documentsAreAddedInVisastackNot')}</li>
            <li>
              {t.node('appAccount.appAccountWhatsappPage.messagesPassThroughWhatsappWhichIs')}
            </li>
          </ul>
          <Link href="/app/privacy">
            {t.node('appAccount.appAccountWhatsappPage.privacyAndConsent')}
          </Link>
        </article>
      </div>
    </section>
  );
}
