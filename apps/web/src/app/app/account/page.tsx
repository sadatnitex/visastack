import { listMembershipsForAccount } from '@visastack/services';
import { signOut } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import { isPlatformAdmin } from '../../../lib/admin';
import { getLocale } from '../../../lib/locale';
import { withSession } from '../../../lib/session';
import { setLocaleAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const locale = await getLocale();
  const data = await withSession(async ({ db, accountId, email }) => {
    const [isAdmin, memberships] = await Promise.all([
      isPlatformAdmin(db, { accountId, email }),
      listMembershipsForAccount(db, accountId),
    ]);
    return { email, isAdmin, hasAgencyAccess: memberships.length > 0 };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Account</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.email}
          </h1>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Preferences</p>
          <h2 className="card-title">Language</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Applies immediately across the whole product.
          </p>
          <form action={setLocaleAction}>
            <input type="hidden" name="locale" value={locale === 'en' ? 'bn' : 'en'} />
            <button type="submit" className="btn btn-secondary">
              Switch to {locale === 'en' ? 'বাংলা' : 'English'}
            </button>
          </form>
        </article>

        <article className="card">
          <p className="card-kicker">Data rights</p>
          <h2 className="card-title">Privacy</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
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
            <div className="rows" style={{ marginTop: '0.5rem' }}>
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
                  <span className="row-key">Platform administration</span>
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
          <h2 className="card-title">Signed in</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Sign out of this device.
          </p>
          <form
            action={async () => {
              'use server';
              await signOut();
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
