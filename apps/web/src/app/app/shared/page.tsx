import { type MessageKey, createTranslator } from '@visastack/i18n';
import { listGrantsForRecipientAccount } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../components/ui';
import { formatTimestampDate } from '../../../lib/format-date';
import { getLocale } from '../../../lib/locale';
import { withSession } from '../../../lib/session';
import { acceptGrantAction } from './actions';

export const metadata: Metadata = { title: 'Shared with me' };

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
      <PageHeader
        eyebrow="Shared with you"
        title="Access others have shared"
        description="Someone granted you access to their records. Access only begins once you accept."
      />

      <article className="card">
        {grants.length === 0 ? (
          <EmptyState title="Nothing shared with you yet">
            When someone invites you to see their information, the invitation appears here. Nothing
            is shared until you accept.
          </EmptyState>
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
                      {applicantName}: {grant.purpose}
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                    {grant.actions.length} permission{grant.actions.length === 1 ? '' : 's'}
                    {grant.expiryAt ? ` · expires ${formatTimestampDate(grant.expiryAt)}` : ''}
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
