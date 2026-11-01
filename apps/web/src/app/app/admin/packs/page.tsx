import {
  listDocumentExpiryPolicies,
  listPackVersionsDueForReview,
  listPacks,
  listPublicTrustPublished,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentTypeDatalist } from '../../../../components/catalogue-datalists';
import { CollapsibleGroup } from '../../../../components/collapsible-group';
import { ShowMore } from '../../../../components/show-more';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin } from '../../../../lib/admin';
import { formatDateOnly } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import {
  type SearchParamsRecord,
  TEAM_LIST_STEP,
  nextShow,
  parseShow,
} from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { CreatePackForm, SetDocumentExpiryPolicyForm } from './pack-forms';

export const metadata: Metadata = { title: 'Rules' };

export const dynamic = 'force-dynamic';

const PATHNAME = '/app/admin/packs';
/** The pack services read whole lists, so Show More may pass 100 rows: no pack becomes unreachable. */
const IN_MEMORY_MAX = 100_000;
const STEP = { step: TEAM_LIST_STEP, max: IN_MEMORY_MAX } as const;

/**
 * Pack Studio (WP-SB7): the pack catalogue 25 at a time with Show More, the review queue in a
 * fixed scrolling panel, and the two forms folded so the lists come first.
 */
export default async function PackStudioPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const packsShown = parseShow(query['show'], STEP);
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

  const nextPacks =
    data.admin && data.packs.length > packsShown ? nextShow(packsShown, STEP) : null;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin" className="muted u-fs-085">
          ← Admin
        </Link>
      </div>
      <PageHeader
        eyebrow="Pack Studio"
        title="Requirement Packs"
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
                {data.packs.slice(0, packsShown).map((pack, index) => (
                  <Link
                    className="row row-link"
                    key={pack.id}
                    id={`pack-row-${index}`}
                    href={`/app/admin/packs/${pack.id}`}
                  >
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
            {data.packs.length > 0 ? (
              <ShowMore
                id="packs-more"
                pathname={PATHNAME}
                searchParams={query}
                next={nextPacks === null ? null : { show: nextPacks }}
                shown={Math.min(packsShown, data.packs.length)}
                total={data.packs.length}
                noun={{ one: 'pack', other: 'packs' }}
                landOn={`pack-row-${packsShown}`}
              />
            ) : null}
          </article>

          <article className="card">
            <p className="card-kicker">RUL-05</p>
            <h2 className="card-title">Review Queue</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: 'var(--text-small)' }}>
              Published versions whose next-review date has passed, most overdue first.
            </p>
            {data.reviewQueue.length === 0 ? (
              <p className="card-body" style={{ marginTop: '0.75rem' }}>
                Nothing due for review.
              </p>
            ) : (
              <section
                className="activity-log-scroll u-mt-050"
                aria-label="Versions due for review"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take keyboard focus to scroll.
                tabIndex={0}
              >
                <div className="rows">
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
                      <span className="muted u-fs-085">
                        due {formatDateOnly(due.nextReviewDate)}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
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
              <section
                className="activity-log-scroll u-mt-050"
                aria-label="Routes live on the public trust surface"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take keyboard focus to scroll.
                tabIndex={0}
              >
                <div className="rows">
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
              </section>
            )}
          </article>

          {/* The two forms span the whole row, so their fields can sit side by side. */}
          <article className="card grid-span-all">
            <p className="card-kicker">New</p>
            <CollapsibleGroup title="Create a Pack">
              <CreatePackForm />
            </CollapsibleGroup>
          </article>

          <article className="card grid-span-all">
            <p className="card-kicker">Expiry Centre</p>
            <CollapsibleGroup
              title="Reminder Thresholds by Document Type"
              count={data.expiryPolicies.length}
              noun={{ one: 'override', other: 'overrides' }}
            >
              <p
                className="muted"
                style={{ margin: '0.35rem 0 1rem', fontSize: 'var(--text-small)' }}
              >
                Default for every document type: 90, 60, 30, 7 and 0 days before expiry. Override
                per type below.
              </p>
              {data.expiryPolicies.length > 0 ? (
                <div className="rows rows-grid u-mb-125">
                  {data.expiryPolicies.map((p) => (
                    <div className="row" key={p.id}>
                      <span className="row-key">{documentTypeLabel(p.docType)}</span>
                      <span className="row-val">{p.thresholdDays.join(', ')}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <>
                <DocumentTypeDatalist />
                <SetDocumentExpiryPolicyForm />
              </>
            </CollapsibleGroup>
          </article>
        </div>
      )}
    </section>
  );
}
