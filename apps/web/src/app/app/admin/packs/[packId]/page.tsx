import { getPack, listPackVersions, listRequirements } from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isPlatformAdmin } from '../../../../../lib/admin';
import { withSession } from '../../../../../lib/session';
import { AddRequirementForm, VerifyChecksumForm } from '../pack-forms';
import {
  ApproveVersionButton,
  OpenVersionButton,
  PublishVersionButton,
} from '../pack-version-buttons';

export const dynamic = 'force-dynamic';

const VERSION_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'badge-neutral' },
  APPROVED: { label: 'Approved', tone: 'badge-warning' },
  PUBLISHED: { label: 'Published', tone: 'badge-success' },
  DEPRECATED: { label: 'Deprecated', tone: 'badge-neutral' },
};

export default async function PackDetailPage({
  params,
}: {
  readonly params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;

  const data = await withSession(async ({ db, email }) => {
    if (!isPlatformAdmin(email)) return { admin: false as const };
    const pack = await getPack(db, packId);
    if (!pack) return { admin: true as const, pack: null };
    const versions = await listPackVersions(db, packId);
    const withReqs = await Promise.all(
      versions.map(async (version) => ({
        version,
        requirements: await listRequirements(db, version.id),
      })),
    );
    return { admin: true as const, pack, versions: withReqs };
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
        <Link href="/app/admin/packs" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Pack Studio
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Pack · {data.pack.key}</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.pack.name}
          </h1>
          {data.pack.description ? (
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              {data.pack.description}
            </p>
          ) : null}
        </div>
        <OpenVersionButton packId={packId} />
      </div>

      {data.versions.length === 0 ? (
        <article className="card">
          <p className="card-body">
            No versions yet. Open a draft version to start adding cited requirements.
          </p>
        </article>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {data.versions.map(({ version, requirements }) => {
            const badge = VERSION_STATUS[version.status] ?? {
              label: version.status,
              tone: 'badge-neutral',
            };
            const isDraft = version.status === 'DRAFT';
            const isApproved = version.status === 'APPROVED';
            return (
              <article className="card" key={version.id}>
                <div className="toolbar" style={{ marginBottom: '1rem', alignItems: 'center' }}>
                  <h2 className="card-title" style={{ margin: 0 }}>
                    Version {version.version}
                  </h2>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                </div>

                {requirements.length === 0 ? (
                  <p className="card-body">No requirements yet.</p>
                ) : (
                  <div className="rows" style={{ marginBottom: isDraft ? '1.25rem' : 0 }}>
                    {requirements.map((req) => (
                      <div
                        className="row"
                        key={req.id}
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
                            {req.kind === 'FIELD' ? 'Field' : 'Document'}:{' '}
                            {req.fieldKey ?? req.docType}
                          </span>
                          <span className="badge badge-neutral">
                            {req.optional ? 'Optional' : 'Required'}
                          </span>
                        </div>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          Cite: {req.citation}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {version.checksum ? (
                  <div style={{ marginTop: '0.75rem' }}>
                    <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                      Checksum: {version.checksum.slice(0, 16)}…
                    </p>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                      <VerifyChecksumForm packVersionId={version.id} />
                      <a
                        href={`/app/admin/packs/${packId}/versions/${version.id}/manifest`}
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                        download
                      >
                        Download manifest
                      </a>
                    </div>
                  </div>
                ) : null}

                {isDraft ? (
                  <>
                    <div style={{ margin: '1.25rem 0' }}>
                      <AddRequirementForm packId={packId} packVersionId={version.id} />
                    </div>
                    <ApproveVersionButton packId={packId} packVersionId={version.id} />
                  </>
                ) : null}

                {isApproved ? (
                  <PublishVersionButton packId={packId} packVersionId={version.id} />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
