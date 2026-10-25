import { listMembershipsForAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountPhotoCard } from '../../../components/profile-photo/account-photo-card';
import { PageHeader } from '../../../components/ui';
import { isPlatformAdmin } from '../../../lib/admin';
import { getLocale } from '../../../lib/locale';
import { loadOwnPhoto } from '../../../lib/profile-photos';
import { withSession } from '../../../lib/session';
import { signOutCurrentUser } from '../../../lib/sign-out';
import { setLocaleAction } from '../../actions';

export const metadata: Metadata = { title: 'Account' };

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const locale = await getLocale();
  const data = await withSession(async ({ db, accountId, email }) => {
    const [isAdmin, memberships, photo] = await Promise.all([
      isPlatformAdmin(db, { accountId, email }),
      listMembershipsForAccount(db, accountId),
      loadOwnPhoto(db, accountId),
    ]);
    return { email, isAdmin, hasAgencyAccess: memberships.length > 0, photo };
  });

  return (
    <section className="section container">
      <PageHeader eyebrow="Account" title={data.email} />

      <div className="grid">
        {data.photo ? <AccountPhotoCard photo={data.photo} /> : null}

        <article className="card">
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

        <article className="card">
          <p className="card-kicker">Data Rights</p>
          <h2 className="card-title">Privacy</h2>
          <p className="card-body u-mb-125">
            Export your data, review consent history, or delete your account.
          </p>
          <Link href="/app/privacy" className="btn btn-secondary">
            Open Privacy
          </Link>
        </article>

        {data.hasAgencyAccess || data.isAdmin ? (
          <article className="card">
            <p className="card-kicker">Roles</p>
            <h2 className="card-title">Other areas you can access</h2>
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
              Sign out
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}
