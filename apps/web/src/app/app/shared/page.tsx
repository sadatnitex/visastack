import { type MessageKey, createTranslator } from '@visastack/i18n';
import { listGrantsForRecipientAccount } from '@visastack/services';
import Link from 'next/link';
import { getLocale } from '../../../lib/locale';
import { withSession } from '../../../lib/session';
import { acceptGrantAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, { key: MessageKey; tone: string }> = {
  PENDING_ACCEPTANCE: { key: 'grant.status.awaitingYourAcceptance', tone: 'badge-warning' },
  ACTIVE: { key: 'grant.status.active', tone: 'badge-success' },
  PAUSED: { key: 'grant.status.paused', tone: 'badge-neutral' },
  REVOKED: { key: 'grant.status.revoked', tone: 'badge-danger' },
  EXPIRED: { key: 'grant.status.expired', tone: 'badge-neutral' },
};

export default async function SharedWithMePage() {
  const t = createTranslator(await getLocale());
  const grants = await withSession(async ({ db, accountId }) =>
    listGrantsForRecipientAccount(db, accountId),
  );

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Workspace
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Shared with you</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Access others have shared
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Someone granted you access to their records. Access only begins once you accept.
          </p>
        </div>
      </div>

      <article className="card">
        {grants.length === 0 ? (
          <p className="card-body">
            Nothing has been shared with you yet. When someone grants you access, it appears here.
          </p>
        ) : (
          <div className="rows">
            {grants.map(({ grant, applicantName }) => {
              const entry = STATUS_BADGE[grant.status];
              const badge = entry
                ? { label: t(entry.key), tone: entry.tone }
                : { label: grant.status, tone: 'badge-neutral' };
              return (
                <div
                  className="row"
                  key={grant.id}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <span className="row-key">
                      {applicantName} — {grant.purpose}
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                    {grant.actions.length} permission{grant.actions.length === 1 ? '' : 's'}
                    {grant.expiryAt
                      ? ` · expires ${new Date(grant.expiryAt).toLocaleDateString()}`
                      : ''}
                  </p>
                  {grant.status === 'PENDING_ACCEPTANCE' ? (
                    <form action={acceptGrantAction}>
                      <input type="hidden" name="grantId" value={grant.id} />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ padding: '0.35rem 1rem', fontSize: '0.85rem' }}
                      >
                        Accept access
                      </button>
                    </form>
                  ) : null}
                  {grant.status === 'ACTIVE' ? (
                    <Link
                      href={`/app/shared/${grant.id}`}
                      className="btn btn-secondary"
                      style={{
                        padding: '0.35rem 1rem',
                        fontSize: '0.85rem',
                        alignSelf: 'flex-start',
                      }}
                    >
                      Open workspace
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
