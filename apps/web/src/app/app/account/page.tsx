import { getWhatsAppConnection, listMembershipsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { AccountPhotoCard } from '../../../components/profile-photo/account-photo-card';
import { PageHeader } from '../../../components/ui';
import { appAccountCatalog } from '../../../i18n/app-account';
import { holdsPlatformRole } from '../../../lib/admin';
import { depthCopy, joinParts } from '../../../lib/ccd/depth-copy';
import { depthWord } from '../../../lib/ccd/depth-words';
import { readDepth } from '../../../lib/ccd/depth.server';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
import { LANGUAGE_CHOICE_ENABLED } from '../../../lib/language-choice';
import { passkeysEnabled } from '../../../lib/passkeys';
import { loadOwnPhoto } from '../../../lib/profile-photos';
import { ClearShareInboxOnSubmit } from '../../../lib/pwa/clear-share-inbox-on-submit';
import { withSession } from '../../../lib/session';
import { signOutCurrentUser } from '../../../lib/sign-out';
import { webPushReady } from '../../../lib/web-push';
import { readWhatsAppConfig } from '../../../lib/whatsapp';
import { setLocaleAction } from '../../actions';
import { AreaPicture, TravellerRow, TravellerRows } from '../u7-rows';
import { PushCard, TurnOffPushOnSubmit } from './push-card';

export const metadata: Metadata = { title: 'Account' };

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const locale = await primeLocale();
  const t = getServerT(appAccountCatalog);
  const depth = await readDepth('account');
  const data = await withSession(async ({ db, accountId, email }) => {
    const [isAdmin, memberships, photo, whatsapp, push] = await Promise.all([
      holdsPlatformRole(db, { accountId, email }),
      listMembershipsForAccount(db, accountId),
      loadOwnPhoto(db, accountId),
      getWhatsAppConnection(db, accountId),
      webPushReady(db),
    ]);
    return {
      email,
      isAdmin,
      hasAgencyAccess: memberships.length > 0,
      photo,
      whatsappConnected: whatsapp.connected,
      push,
    };
  });

  const showWhatsApp = Boolean(readWhatsAppConfig()) || data.whatsappConnected;
  const showRoles = data.hasAgencyAccess || data.isAdmin;
  const browseParts = [
    data.photo ? depthWord('depth.account.part.photo') : null,
    LANGUAGE_CHOICE_ENABLED ? depthWord('depth.account.part.language') : null,
    depthWord('depth.account.part.plan'),
    depthWord('depth.account.part.privacy'),
  ].filter((part): part is string => part !== null);
  const everythingParts = [
    showWhatsApp ? depthWord('depth.account.part.whatsapp') : null,
    showRoles ? depthWord('depth.account.part.roles') : null,
  ].filter((part): part is string => part !== null);
  // The depth lines and their parts are English, so the list is joined with the English "and".
  const copy = depthCopy({
    glance: depthWord('depth.account.glance'),
    browse: depthWord('depth.account.browse', { parts: joinParts(browseParts, 'en') }),
    everything: depthWord('depth.account.everything', {
      parts: everythingParts.length
        ? joinParts(everythingParts, 'en')
        : depthWord('depth.account.nothingMore'),
    }),
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow={t('appAccount.appAccountPage.account')}
        title={t('appAccount.appAccountPage.yourAccount')}
        description={<span className="depth-email">{data.email}</span>}
      />

      <DepthScope family="account" depth={depth}>
        <DepthSwitch family="account" initial={depth} copy={copy} />

        <div className="grid">
          <TravellerRow
            headingLevel={2}
            title={t.node('appAccount.appAccountPage.signedIn')}
            chip={{ label: t.node('appAccount.appAccountPage.session'), tone: 'neutral' }}
            picture={<AreaPicture mark={{ icon: 'logout', tone: 'neutral' }} />}
            meta={t.node('appAccount.appAccountPage.signOutOfThisDevice')}
            remember
          >
            <form
              action={async (form: FormData) => {
                'use server';
                await signOutCurrentUser('/', form);
              }}
            >
              <ClearShareInboxOnSubmit />
              <TurnOffPushOnSubmit />
              <button type="submit" className="btn btn-secondary">
                {t.node('appAccount.appAccountPage.signOut')}
              </button>
            </form>
          </TravellerRow>

          {/* WP-PIC18: only while Web Push is on and ready; the card hides itself where the browser cannot alert. */}
          {data.push ? <PushCard publicKey={data.push.publicKey} /> : null}

          {data.photo ? (
            <div className="depth-item" {...atLevel('browse')}>
              <AccountPhotoCard photo={data.photo} />
            </div>
          ) : null}

          {/* Shown while language choice is on (see LANGUAGE_CHOICE_ENABLED). */}
          {LANGUAGE_CHOICE_ENABLED ? (
            <div className="depth-item" {...atLevel('browse')}>
              <TravellerRow
                headingLevel={2}
                title="Language"
                chip={{ label: 'Preferences', tone: 'neutral' }}
                picture={<AreaPicture mark={{ icon: 'globe', tone: 'violet' }} />}
                meta="Applies immediately across the whole product."
              >
                <form action={setLocaleAction}>
                  <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
                  <button type="submit" className="btn btn-secondary">
                    Switch to{' '}
                    <span lang={locale === 'en' ? 'bn' : 'en'}>
                      {locale === 'en' ? 'বাংলা' : 'English'}
                    </span>
                  </button>
                </form>
              </TravellerRow>
            </div>
          ) : null}

          <div className="depth-item" {...atLevel('browse')}>
            <TravellerRow
              headingLevel={2}
              title={t.node('appAccount.appAccountPage.planUsage')}
              chip={{ label: t.node('appAccount.appAccountPage.plan'), tone: 'neutral' }}
              picture={<AreaPicture mark={{ icon: 'activity', tone: 'blue' }} />}
              meta={t.node('appAccount.appAccountPage.yourPlanWhatItIncludesAnd')}
            >
              <Link href="/app/account/plan" className="btn btn-secondary">
                {t.node('appAccount.appAccountPage.openPlanUsage')}
              </Link>
            </TravellerRow>
          </div>

          <div className="depth-item" {...atLevel('browse')}>
            <TravellerRow
              headingLevel={2}
              title={t.node('appAccount.appAccountPage.privacy')}
              chip={{ label: t.node('appAccount.appAccountPage.dataRights'), tone: 'neutral' }}
              picture={<AreaPicture mark={{ icon: 'shield', tone: 'teal' }} />}
              meta={t.node('appAccount.appAccountPage.exportYourDataReviewConsentHistory')}
            >
              <div className="u7-body-actions">
                <Link href="/app/privacy" className="btn btn-secondary">
                  {t.node('appAccount.appAccountPage.openPrivacy')}
                </Link>
                {passkeysEnabled() ? (
                  <Link href="/app/account/passkeys">Manage Your Passkeys</Link>
                ) : null}
              </div>
            </TravellerRow>
          </div>

          {showWhatsApp ? (
            <div className="depth-item" {...atLevel('everything')}>
              <TravellerRow
                headingLevel={2}
                title={t.node('appAccount.appAccountPage.whatsapp')}
                chip={{ label: t.node('appAccount.appAccountPage.optional'), tone: 'neutral' }}
                picture={<AreaPicture mark={{ icon: 'mail', tone: 'green' }} />}
                meta={t.node('appAccount.appAccountPage.askAboutYourCasesFromWhatsapp')}
              >
                <Link href="/app/account/whatsapp" className="btn btn-secondary">
                  {t.node('appAccount.appAccountPage.openWhatsappSettings')}
                </Link>
              </TravellerRow>
            </div>
          ) : null}

          {showRoles ? (
            <article
              className="card depth-item"
              aria-labelledby="account-roles-title"
              {...atLevel('everything')}
            >
              <p className="card-kicker">{t.node('appAccount.appAccountPage.roles')}</p>
              <h2 className="card-title" id="account-roles-title">
                {t.node('appAccount.appAccountPage.otherAreasYouCanAccess')}
              </h2>
              <TravellerRows>
                {data.hasAgencyAccess ? (
                  <TravellerRow
                    headingLevel={3}
                    href="/app/agency"
                    title={t.node('appAccount.appAccountPage.agencyDesk')}
                    picture={<AreaPicture mark={{ icon: 'building', tone: 'blue' }} />}
                  />
                ) : null}
                {data.isAdmin ? (
                  <TravellerRow
                    headingLevel={3}
                    href="/app/admin"
                    title={t.node('appAccount.appAccountPage.platformAdministration')}
                    picture={<AreaPicture mark={{ icon: 'settings', tone: 'violet' }} />}
                  />
                ) : null}
              </TravellerRows>
            </article>
          ) : null}
        </div>
      </DepthScope>
    </section>
  );
}
