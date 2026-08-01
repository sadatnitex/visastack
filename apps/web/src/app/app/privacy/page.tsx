import type { ConsentType } from '@visastack/core';
import { getPendingDeletion, listConsentHistory } from '@visastack/services';
import { withSession } from '../../../lib/session';
import { DeletionPanel } from './deletion-panel';

export const dynamic = 'force-dynamic';

const CONSENT_LABELS: Record<ConsentType, string> = {
  CORE_PROCESSING: 'Core processing',
  AI_EXTRACTION: 'AI extraction',
  SHARING: 'Sharing',
  MARKETING: 'Marketing',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function PrivacyPage() {
  const data = await withSession(async ({ db, accountId }) => {
    const [history, pending] = await Promise.all([
      listConsentHistory(db, accountId),
      getPendingDeletion(db, accountId),
    ]);
    return {
      history: history.map((row) => ({
        type: row.type as ConsentType,
        granted: row.grantedAt !== null && row.revokedAt === null,
        at: (row.grantedAt ?? row.revokedAt ?? row.createdAt).toISOString(),
      })),
      scheduledFor: pending ? pending.scheduledFor.toISOString() : null,
    };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Privacy</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Your data rights
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Export everything, review your consent history, or delete your account.
          </p>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Portability</p>
          <h2 className="card-title">Export your data</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Download a complete, structured JSON snapshot of your account: identity, consents,
            applicants, Master Profile facts with full history, document metadata, and your audit
            trail.
          </p>
          <a href="/app/privacy/export" className="btn btn-primary" download>
            Download export
          </a>
        </article>

        <article className="card">
          <p className="card-kicker">Erasure</p>
          <h2 className="card-title">Delete your account</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Deletion is reversible during a 7-day grace window, then permanent. Your audit trail is
            preserved and anonymized. An active legal hold blocks deletion until released.
          </p>
          <DeletionPanel scheduledFor={data.scheduledFor} />
        </article>
      </div>

      <article className="card" style={{ marginTop: '1.5rem' }}>
        <p className="card-kicker">Transparency</p>
        <h2 className="card-title">Consent history</h2>
        {data.history.length === 0 ? (
          <p className="card-body">No consent changes recorded yet.</p>
        ) : (
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {data.history.map((entry, i) => (
              <div className="row" key={`${entry.type}-${entry.at}-${i}`}>
                <span className="row-key">{CONSENT_LABELS[entry.type] ?? entry.type}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`badge ${entry.granted ? 'badge-success' : 'badge-neutral'}`}>
                    {entry.granted ? 'Granted' : 'Revoked'}
                  </span>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {formatDateTime(entry.at)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
