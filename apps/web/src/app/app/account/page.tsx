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
import { getLocale } from '../../../lib/locale';
import { loadOwnPhoto } from '../../../lib/profile-photos';
import { withSession } from '../../../lib/session';
import { signOutCurrentUser } from '../../../lib/sign-out';
import { readWhatsAppConfig } from '../../../lib/whatsapp';
import { setLocaleAction } from '../../actions';

export const metadata: Metadata = { title: 'Account' };

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  await primeLocale();
  const t = getServerT(appAccountCatalog);
  const locale = await getLocale();
  const depth = await readDepth('account');
  const data = await withSession(async ({ db, accountId, email }) => {
    const [isAdmin, memberships, photo, whatsapp] = await Promise.all([
      holdsPlatformRole(db, { accountId, email }),
      listMembershipsForAccount(db, accountId),
      loadOwnPhoto(db, accountId),
      getWhatsAppConnection(db, accountId),
    ]);
    return {
      email,
      isAdmin,
      hasAgencyAccess: memberships.length > 0,
      photo,
      whatsappConnected: whatsapp.connected,
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
  const copy = depthCopy({
    glance: depthWord('depth.account.glance'),
    browse: depthWord('depth.account.browse', { parts: joinParts(browseParts, locale) }),
    everything: depthWord('depth.account.everything', {
      parts: everythingParts.length
        ? joinParts(everythingParts, locale)
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
          <article className="card">
            <p className="card-kicker">{t('appAccount.appAccountPage.session')}</p>
            <h2 className="card-title">{t('appAccount.appAccountPage.signedIn')}</h2>
            <p className="card-body u-mb-125">
              {t('appAccount.appAccountPage.signOutOfThisDevice')}
            </p>
            <form
              action={async () => {
                'use server';
                await signOutCurrentUser();
              }}
            >
              <button type="submit" className="btn btn-secondary">
                {t('appAccount.appAccountPage.signOut')}
              </button>
            </form>
          </article>

          {data.photo ? (
            <div className="depth-item" {...atLevel('browse')}>
              <AccountPhotoCard photo={data.photo} />
            </div>
          ) : null}

          {/* Shown while language choice is on (see LANGUAGE_CHOICE_ENABLED). */}
          {LANGUAGE_CHOICE_ENABLED ? (
            <article className="card" {...atLevel('browse')}>
              <p className="card-kicker">Preferences</p>
              <h2 className="card-title">Language</h2>
              <p className="card-body u-mb-125">Applies immediately across the whole product.</p>
              <form action={setLocaleAction}>
                <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
                <button type="submit" className="btn btn-secondary">
                  Switch to{' '}
                  <span lang={locale === 'en' ? 'bn' : 'en'}>
                    {locale === 'en' ? 'বাংলা' : 'English'}
                  </span>
                </button>
              </form>
            </article>
          ) : null}

          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">{t('appAccount.appAccountPage.plan')}</p>
            <h2 className="card-title">{t('appAccount.appAccountPage.planUsage')}</h2>
            <p className="card-body u-mb-125">
              {t('appAccount.appAccountPage.yourPlanWhatItIncludesAnd')}
            </p>
            <Link href="/app/account/plan" className="btn btn-secondary">
              {t('appAccount.appAccountPage.openPlanUsage')}
            </Link>
          </article>

          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">{t('appAccount.appAccountPage.dataRights')}</p>
            <h2 className="card-title">{t('appAccount.appAccountPage.privacy')}</h2>
            <p className="card-body u-mb-125">
              {t('appAccount.appAccountPage.exportYourDataReviewConsentHistory')}
            </p>
            <Link href="/app/privacy" className="btn btn-secondary">
              {t('appAccount.appAccountPage.openPrivacy')}
            </Link>
          </article>

          {showWhatsApp ? (
            <article className="card" {...atLevel('everything')}>
              <p className="card-kicker">{t('appAccount.appAccountPage.optional')}</p>
              <h2 className="card-title">{t('appAccount.appAccountPage.whatsapp')}</h2>
              <p className="card-body u-mb-125">
                {t('appAccount.appAccountPage.askAboutYourCasesFromWhatsapp')}
              </p>
              <Link href="/app/account/whatsapp" className="btn btn-secondary">
                {t('appAccount.appAccountPage.openWhatsappSettings')}
              </Link>
            </article>
          ) : null}

          {showRoles ? (
            <article className="card" {...atLevel('everything')}>
              <p className="card-kicker">{t('appAccount.appAccountPage.roles')}</p>
              <h2 className="card-title">
                {t('appAccount.appAccountPage.otherAreasYouCanAccess')}
              </h2>
              <div className="rows u-mt-050">
                {data.hasAgencyAccess ? (
                  <Link className="row row-link" href="/app/agency">
                    <span className="row-key">{t('appAccount.appAccountPage.agencyDesk')}</span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ) : null}
                {data.isAdmin ? (
                  <Link className="row row-link" href="/app/admin">
                    <span className="row-key">
                      {t('appAccount.appAccountPage.platformAdministration')}
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
      </DepthScope>
    </section>
  );
}
