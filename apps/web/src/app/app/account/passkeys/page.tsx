import { listPasskeys } from '@visastack/services/passkeys';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../components/ui';
import { formatDateOnly } from '../../../../lib/format-date';
import { primeLocale } from '../../../../lib/i18n-server';
import { passkeysEnabled } from '../../../../lib/passkeys';
import { withSession } from '../../../../lib/session';
import { isStaffContext } from '../../../../lib/session-age';
import { removePasskeyAction, renamePasskeyAction } from '../../../auth/passkey-actions';
import { AddPasskey } from './passkeys-panel';

export const metadata: Metadata = { title: 'Passkeys' };

export const dynamic = 'force-dynamic';

const NOTICES: Record<string, string> = {
  added: 'Your passkey is saved. Use it next time we ask you to confirm it is you.',
  renamed: 'The passkey name is saved.',
  removed: 'The passkey is removed. It no longer works on this account.',
  missing: 'That passkey is no longer on your list.',
  invalid: 'Something in that request was not right. Please try again.',
  unavailable: 'Passkeys are not available right now. Please try again later.',
};

/**
 * Passkeys (Q8, ADR 0028): Face ID, a fingerprint or the screen lock confirms it is you before a
 * sensitive step, instead of typing the password again. A passkey does not sign anyone in, and
 * staff keep the password and authenticator app. Not shown at all while the switch is off.
 */
export default async function PasskeysPage({
  searchParams,
}: { searchParams: Promise<{ n?: string }> }) {
  if (!passkeysEnabled()) notFound();
  const locale = await primeLocale();
  const { n } = await searchParams;
  const notice = n ? NOTICES[n] : undefined;
  const data = await withSession(async ({ db, accountId, email }) => ({
    list: await listPasskeys(db, accountId),
    staff: await isStaffContext(db, { accountId, email }),
  }));

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Account"
        title="Passkeys"
        description="Confirm it is you with Face ID, a fingerprint or your screen lock instead of typing your password again."
        back={{ href: '/app/account', label: 'Account' }}
      />
      {notice ? (
        <output className="field-msg u-mb-100" style={{ display: 'block' }}>
          {notice}
        </output>
      ) : null}
      <div className="grid">
        {data.list.state === 'unavailable' ? (
          <article className="card">
            <h2 className="card-title">Passkeys Are Not Available Yet</h2>
            <p className="card-body">
              You can keep using your password. Passkeys will appear here once they are ready.
            </p>
          </article>
        ) : (
          <>
            <article className="card">
              <h2 className="card-title">How Passkeys Work Here</h2>
              <p className="card-body">
                Before a sensitive step, such as downloading all your records, we ask you to confirm
                it is you. With a passkey you can do that with Face ID, a fingerprint or your screen
                lock. You still sign in the usual way, and your password keeps working.
              </p>
              {data.staff ? (
                <p className="card-body">
                  Staff accounts keep confirming with the password and the authenticator app, so a
                  passkey saved here is not used for staff steps.
                </p>
              ) : null}
              <AddPasskey />
            </article>
            <article className="card">
              <h2 className="card-title">Your Passkeys</h2>
              {data.list.passkeys.length === 0 ? (
                <p className="card-body">You have not added a passkey yet.</p>
              ) : (
                <ul className="rows rows-grid u-mt-050">
                  {data.list.passkeys.map((passkey) => (
                    <li className="row" key={passkey.id}>
                      <span className="row-key">{passkey.label}</span>
                      <span className="row-val">
                        Added {formatDateOnly(passkey.createdAt, locale)}
                        {passkey.lastUsedAt
                          ? `, last used ${formatDateOnly(passkey.lastUsedAt, locale)}`
                          : ', not used yet'}
                        {passkey.synced ? ', kept in sync across your devices' : ''}
                      </span>
                      <form action={renamePasskeyAction} className="field-list u-mt-050">
                        <input type="hidden" name="passkeyId" value={passkey.id} />
                        <label className="field-label" htmlFor={`label-${passkey.id}`}>
                          Name
                        </label>
                        <input
                          id={`label-${passkey.id}`}
                          name="label"
                          className="field-input"
                          defaultValue={passkey.label}
                          maxLength={60}
                          required
                        />
                        <button
                          type="submit"
                          className="btn btn-secondary"
                          aria-label={`Save Name: ${passkey.label}`}
                        >
                          Save Name
                        </button>
                      </form>
                      <details className="u-mt-050">
                        <summary
                          className="btn btn-secondary"
                          aria-label={`Remove Passkey: ${passkey.label}`}
                        >
                          Remove Passkey
                        </summary>
                        <form action={removePasskeyAction} className="field-list u-mt-050">
                          <input type="hidden" name="passkeyId" value={passkey.id} />
                          <p className="card-body">
                            Remove {passkey.label}? It will stop working on this account. You can
                            add it again later.
                          </p>
                          <button
                            type="submit"
                            className="btn btn-primary"
                            aria-label={`Yes, Remove Passkey: ${passkey.label}`}
                          >
                            Yes, Remove It
                          </button>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </>
        )}
      </div>
      <p className="card-body u-mt-100">
        <Link href="/app/account">Back to Account</Link>
      </p>
    </section>
  );
}
