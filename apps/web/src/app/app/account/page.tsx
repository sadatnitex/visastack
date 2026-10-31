import { getWhatsAppConnection, listMembershipsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { AccountPhotoCard } from '../../../components/profile-photo/account-photo-card';
import { PageHeader } from '../../../components/ui';
import { holdsPlatformRole } from '../../../lib/admin';
import { depthCopy, joinParts } from '../../../lib/ccd/depth-copy';
import { depthWord } from '../../../lib/ccd/depth-words';
import { readDepth } from '../../../lib/ccd/depth.server';
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
        eyebrow="Account"
        title="Your Account"
        description={<span className="depth-email">{data.email}</span>}
      />

      <DepthScope family="account" depth={depth}>
        <DepthSwitch family="account" initial={depth} copy={copy} />

        <div className="grid">
          <article className="card">
            <p className="card-kicker">Session</p>
            <h2 className="card-title">Signed In</h2>
            <p className="card-body u-mb-125">Sign out of this device.</p>
            <form
              action={async () => {
                'use server';
                await signOutCurrentUser();
              }}
            >
              <button type="submit" className="btn btn-secondary">
                Sign Out
              </button>
            </form>
          </article>

          {data.photo ? (
            <div className="depth-item" {...atLevel('browse')}>
              <AccountPhotoCard photo={data.photo} />
            </div>
          ) : null}

          {/* Hidden until translation work starts (see LANGUAGE_CHOICE_ENABLED). */}
          {LANGUAGE_CHOICE_ENABLED ? (
            <article className="card" {...atLevel('browse')}>
              <p className="card-kicker">Preferences</p>
              <h2 className="card-title">Language</h2>
              <p className="card-body u-mb-125">Applies immediately across the whole product.</p>
              <form action={setLocaleAction}>
                <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
                <button type="submit" className="btn btn-secondary">
                  Switch to {locale === 'en' ? 'বাংলা' : 'English'}
                </button>
              </form>
            </article>
          ) : null}

          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">Plan</p>
            <h2 className="card-title">Plan &amp; Usage</h2>
            <p className="card-body u-mb-125">
              Your plan, what it includes and how much of it you have used.
            </p>
            <Link href="/app/account/plan" className="btn btn-secondary">
              Open Plan &amp; Usage
            </Link>
          </article>

          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">Data Rights</p>
            <h2 className="card-title">Privacy</h2>
            <p className="card-body u-mb-125">
              Export your data, review consent history, or delete your account.
            </p>
            <Link href="/app/privacy" className="btn btn-secondary">
              Open Privacy
            </Link>
          </article>

          {showWhatsApp ? (
            <article className="card" {...atLevel('everything')}>
              <p className="card-kicker">Optional</p>
              <h2 className="card-title">WhatsApp</h2>
              <p className="card-body u-mb-125">
                Ask about your cases from WhatsApp. You can disconnect it any time.
              </p>
              <Link href="/app/account/whatsapp" className="btn btn-secondary">
                Open WhatsApp Settings
              </Link>
            </article>
          ) : null}

          {showRoles ? (
            <article className="card" {...atLevel('everything')}>
              <p className="card-kicker">Roles</p>
              <h2 className="card-title">Other Areas You Can Access</h2>
              <div className="rows u-mt-050">
                {data.hasAgencyAccess ? (
                  <Link className="row row-link" href="/app/agency">
                    <span className="row-key">Agency Desk</span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ) : null}
                {data.isAdmin ? (
                  <Link className="row row-link" href="/app/admin">
                    <span className="row-key">Platform Administration</span>
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
