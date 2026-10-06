import { diffPackVersions, getPack } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformAdmin } from '../../../../../../lib/admin';
import { withSession } from '../../../../../../lib/session';

export const metadata: Metadata = { title: 'Rule pack changes' };

export const dynamic = 'force-dynamic';

const CHANGE_TONE: Record<string, string> = {
  added: 'badge-success',
  removed: 'badge-danger',
  changed: 'badge-warning',
  unchanged: 'badge-neutral',
};

export default async function PackVersionDiffPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ packId: string }>;
  readonly searchParams: Promise<{ readonly from?: string; readonly to?: string }>;
}) {
  const { packId } = await params;
  const { from, to } = await searchParams;

  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const pack = await getPack(db, packId);
    if (!pack) return { admin: true as const, pack: null };
    if (!from || !to) {
      return {
        admin: true as const,
        pack,
        diff: null,
        error: 'Choose two versions to compare.',
      };
    }
    const diff = await diffPackVersions(db, from, to);
    if (!diff.ok) return { admin: true as const, pack, diff: null, error: diff.error.message };
    return { admin: true as const, pack, diff: diff.value, error: null };
  });

  if (!data.admin) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">This area is restricted to platform administrators.</p>
        </article>
      </section>
    );
  }
  if (!data.pack) notFound();

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href={`/app/admin/packs/${packId}`} className="muted" style={{ fontSize: '0.9rem' }}>
          ← {data.pack.name}
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Pack · {data.pack.key} · RUL-05</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Version diff
          </h1>
          {data.diff ? (
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Version {data.diff.fromVersion.version} to Version {data.diff.toVersion.version}
            </p>
          ) : null}
        </div>
      </div>

      {data.error ? (
        <article className="card">
          <p className="card-body">{data.error}</p>
        </article>
      ) : data.diff ? (
        <article className="card">
          <p className="card-kicker">Requirement changes</p>
          <h2 className="card-title">
            {data.diff.entries.length} requirement{data.diff.entries.length === 1 ? '' : 's'} total
          </h2>
          {data.diff.entries.length === 0 ? (
            <p className="card-body">Neither version has any requirements.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.75rem' }}>
              {data.diff.entries.map((entry) => {
                const req = entry.to ?? entry.from;
                if (!req) return null;
                return (
                  <div
                    className="row"
                    key={entry.key}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}
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
                        {entry.kind === 'FIELD' ? 'Field' : 'Document'}:{' '}
                        {req.fieldKey ?? req.docType}
                      </span>
                      <span className={`badge ${CHANGE_TONE[entry.change] ?? 'badge-neutral'}`}>
                        {entry.change}
                      </span>
                    </div>
                    {entry.change === 'changed' ? (
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        Changed: {entry.changedFields.join(', ')}
                      </span>
                    ) : null}
                    {entry.change === 'added' && entry.to ? (
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        Cite: {entry.to.citation}
                      </span>
                    ) : null}
                    {entry.change === 'removed' && entry.from ? (
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        Was cited: {entry.from.citation}
                      </span>
                    ) : null}
                    {entry.change === 'unchanged' ? (
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        Cite: {req.citation}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}
