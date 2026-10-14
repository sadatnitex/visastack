import {
  listDocumentExpiryPolicies,
  listPackVersionsDueForReview,
  listPacks,
  listPublicTrustPublished,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin } from '../../../../lib/admin';
import { formatDateOnly } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import { withSession } from '../../../../lib/session';
import { CreatePackForm, SetDocumentExpiryPolicyForm } from './pack-forms';

export const metadata: Metadata = { title: 'Rules' };

export const dynamic = 'force-dynamic';

export default async function PackStudioPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    return {
      admin: true as const,
      packs: await listPacks(db),
      expiryPolicies: await listDocumentExpiryPolicies(db),
      reviewQueue: await listPackVersionsDueForReview(db),
      publicTrust: await listPublicTrustPublished(db),
    };
  });

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin" className="muted u-fs-085">
          ← Admin
        </Link>
      </div>
      <PageHeader
        eyebrow="Pack Studio"
        title="Requirement packs"
        description="Author versioned, cited requirement packs. A published version becomes attachable by cases."
      />

      {!data.admin ? (
        <article className="card">
          <p className="card-body">This area is restricted to platform administrators.</p>
        </article>
      ) : (
        <div className="grid">
          <article className="card">
            <p className="card-kicker">Catalog</p>
            <h2 className="card-title">Packs</h2>
            {data.packs.length === 0 ? (
              <p className="card-body">No packs yet.</p>
            ) : (
              <div className="rows u-mt-050">
                {data.packs.map((pack) => (
                  <Link className="row row-link" key={pack.id} href={`/app/admin/packs/${pack.id}`}>
                    <span className="row-key">
                      {pack.name}
                      <span
                        className="muted"
                        style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                      >
                        {pack.key}
                      </span>
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </article>

          <article className="card">
            <p className="card-kicker">RUL-05</p>
            <h2 className="card-title">Review queue</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: 'var(--text-small)' }}>
              Published versions whose next-review date has passed, most overdue first.
            </p>
            {data.reviewQueue.length === 0 ? (
              <p className="card-body" style={{ marginTop: '0.75rem' }}>
                Nothing due for review.
              </p>
            ) : (
              <div className="rows u-mt-050">
                {data.reviewQueue.map((due) => (
                  <Link
                    className="row row-link"
                    key={due.packVersionId}
                    href={`/app/admin/packs/${due.packId}`}
                  >
                    <span className="row-key">
                      {due.packName}
                      <span
                        className="muted"
                        style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                      >
                        v{due.version}
                      </span>
                    </span>
                    <span className="muted u-fs-085">due {formatDateOnly(due.nextReviewDate)}</span>
                  </Link>
                ))}
              </div>
            )}
          </article>

          <article className="card">
            <p className="card-kicker">RUL-06</p>
            <h2 className="card-title">Public Trust Lite</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: 'var(--text-small)' }}>
              Routes currently live on the public trust surface.
            </p>
            {data.publicTrust.length === 0 ? (
              <p className="card-body" style={{ marginTop: '0.75rem' }}>
                Nothing published yet.
              </p>
            ) : (
              <div className="rows u-mt-050">
                {data.publicTrust.map((route) => (
                  <a
                    className="row row-link"
                    key={route.packKey}
                    href={`/trust/${route.packKey}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="row-key">{route.packName}</span>
                    <span className="muted u-fs-085">/trust/{route.packKey} ↗</span>
                  </a>
                ))}
              </div>
            )}
          </article>

          <article className="card">
            <p className="card-kicker">New</p>
            <h2 className="card-title">Create a pack</h2>
            <CreatePackForm />
          </article>

          <article className="card">
            <p className="card-kicker">Expiry Centre</p>
            <h2 className="card-title">Reminder thresholds by document type</h2>
            <p
              className="muted"
              style={{ margin: '0.35rem 0 1rem', fontSize: 'var(--text-small)' }}
            >
              Default for every document type: 90, 60, 30, 7 and 0 days before expiry. Override per
              type below.
            </p>
            {data.expiryPolicies.length > 0 ? (
              <div className="rows u-mb-125">
                {data.expiryPolicies.map((p) => (
                  <div className="row" key={p.id}>
                    <span className="row-key">{documentTypeLabel(p.docType)}</span>
                    <span className="row-val">{p.thresholdDays.join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <SetDocumentExpiryPolicyForm />
          </article>
        </div>
      )}
    </section>
  );
}
