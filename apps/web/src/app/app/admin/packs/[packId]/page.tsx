import {
  getPack,
  listMissionsByPackVersion,
  listPackVersions,
  listRequirements,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  DocumentTypeDatalist,
  FieldKeyDatalist,
} from '../../../../../components/catalogue-datalists';
import { PageHeader, StatusBadge } from '../../../../../components/ui';
import { isPlatformAdmin } from '../../../../../lib/admin';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';
import { formatPrice } from '../../../../../lib/usage-format';
import {
  AddRequirementForm,
  PublicTrustContentForm,
  RequirementSourceReviewForm,
  VerifyChecksumForm,
} from '../pack-forms';
import {
  ApproveVersionButton,
  OfficialFeeStaleButton,
  OpenVersionButton,
  PublicTrustPublishButton,
  PublishVersionButton,
  SourceInaccessibleButton,
  WithdrawVersionButton,
} from '../pack-version-buttons';

export const metadata: Metadata = { title: 'Rule Pack' };

export const dynamic = 'force-dynamic';

const VERSION_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'badge-neutral' },
  APPROVED: { label: 'Approved', tone: 'badge-warning' },
  PUBLISHED: { label: 'Published', tone: 'badge-success' },
  DEPRECATED: { label: 'Deprecated', tone: 'badge-neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'badge-danger' },
};

export default async function PackDetailPage({
  params,
}: {
  readonly params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;

  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const pack = await getPack(db, packId);
    if (!pack) return { admin: true as const, pack: null };
    const versions = await listPackVersions(db, packId);
    const withReqs = await Promise.all(
      versions.map(async (version) => ({
        version,
        requirements: await listRequirements(db, version.id),
        // Impact list (RUL-05) only matters once a version has ever been
        // usable by a mission -- a DRAFT/APPROVED version can never have one
        // attached, so skip the query rather than always paying for it.
        missionCount:
          version.status === 'PUBLISHED' || version.status === 'WITHDRAWN'
            ? (await listMissionsByPackVersion(db, version.id)).length
            : 0,
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
      <PageHeader
        back={{ href: '/app/admin/packs', label: 'Pack Studio' }}
        eyebrow={`Pack · ${data.pack.key}`}
        title={data.pack.name}
        meta={
          <StatusBadge tone={data.pack.authoritative ? 'success' : 'neutral'}>
            {data.pack.authoritative ? 'Official requirement pack' : 'Agency custom checklist'}
          </StatusBadge>
        }
        description={
          <>
            {data.pack.description ?? ''}
            {!data.pack.authoritative
              ? ' Not eligible for the public trust surface (RUL-06): only an authoritative pack can be published there.'
              : ''}
          </>
        }
        actions={<OpenVersionButton packId={packId} />}
      />

      {data.versions.length === 0 ? (
        <article className="card">
          <p className="card-body">
            No versions yet. Open a draft version to start adding cited requirements.
          </p>
        </article>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {data.versions.map(({ version, requirements, missionCount }) => {
            const badge = VERSION_STATUS[version.status] ?? {
              label: version.status,
              tone: 'badge-neutral',
            };
            const isDraft = version.status === 'DRAFT';
            const isApproved = version.status === 'APPROVED';
            const isPublished = version.status === 'PUBLISHED';
            const isWithdrawn = version.status === 'WITHDRAWN';
            return (
              <article className="card" key={version.id}>
                <div className="toolbar" style={{ marginBottom: '1rem', alignItems: 'center' }}>
                  <h2 className="card-title u-m-0">Version {version.version}</h2>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                </div>

                {isWithdrawn ? (
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}
                  >
                    Withdrawn {version.withdrawnAt ? formatTimestampDate(version.withdrawnAt) : ''}:{' '}
                    {version.withdrawnReason}
                  </p>
                ) : null}

                {(isPublished || isWithdrawn) && version.nextReviewDate ? (
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}
                  >
                    Next review: {formatDateOnly(version.nextReviewDate)}
                  </p>
                ) : null}

                {isPublished || isWithdrawn ? (
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginBottom: '1rem' }}
                  >
                    {missionCount === 0
                      ? 'No cases currently attached to this version.'
                      : `${missionCount} case${missionCount === 1 ? '' : 's'} currently attached to this version.`}
                  </p>
                ) : null}

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
                        <span className="muted u-fs-085">Cite: {req.citation}</span>
                        {req.sourceUrl ? (
                          <p className="muted">
                            <a href={req.sourceUrl} target="_blank" rel="noopener noreferrer">
                              {req.sourceTitle ?? 'Source reference'}
                            </a>
                            {req.publisher ? `, ${req.publisher}` : ''}
                            {req.observedDate
                              ? `, checked ${formatDateOnly(req.observedDate)}`
                              : ', checked date not recorded'}
                          </p>
                        ) : null}
                        {isDraft ? (
                          <details>
                            <summary>Record Source Review</summary>
                            <RequirementSourceReviewForm
                              packId={data.pack.id}
                              requirementId={req.id}
                              sourceUrl={req.sourceUrl}
                              sourceTitle={req.sourceTitle}
                              publisher={req.publisher}
                              observedDate={req.observedDate?.toISOString().slice(0, 10) ?? ''}
                            />
                          </details>
                        ) : null}
                        {req.maxAgeDays !== null ? (
                          <span className="muted u-fs-085">
                            Freshness: must be dated within {req.maxAgeDays} day(s)
                          </span>
                        ) : null}
                        {req.sourceInaccessibleAt ? (
                          <span className="badge badge-danger" style={{ alignSelf: 'flex-start' }}>
                            Source inaccessible since{' '}
                            {formatTimestampDate(req.sourceInaccessibleAt)}
                          </span>
                        ) : null}
                        <div style={{ marginTop: '0.2rem' }}>
                          <SourceInaccessibleButton
                            packId={packId}
                            requirementId={req.id}
                            inaccessible={req.sourceInaccessibleAt !== null}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {version.checksum ? (
                  <div style={{ marginTop: '0.75rem' }}>
                    <p
                      className="muted"
                      style={{ fontSize: 'var(--text-caption)', marginBottom: '0.5rem' }}
                    >
                      Checksum: {version.checksum.slice(0, 16)}…
                    </p>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                      <VerifyChecksumForm packVersionId={version.id} />
                      <a
                        href={`/app/admin/packs/${packId}/versions/${version.id}/manifest`}
                        className="btn btn-secondary u-btn-sm"
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
                      <>
                        <DocumentTypeDatalist />
                        <FieldKeyDatalist />
                        <AddRequirementForm packId={packId} packVersionId={version.id} />
                      </>
                    </div>
                    {data.pack.authoritative ? (
                      <div style={{ margin: '1.25rem 0' }}>
                        <p className="card-kicker" style={{ marginBottom: '0.5rem' }}>
                          RUL-06 · Public Trust Lite
                        </p>
                        <PublicTrustContentForm
                          packId={packId}
                          packVersionId={version.id}
                          routeDescription={version.routeDescription}
                          officialFeeMinorUnits={version.officialFeeMinorUnits}
                          officialFeeCurrency={version.officialFeeCurrency}
                          officialChannelName={version.officialChannelName}
                          officialChannelUrl={version.officialChannelUrl}
                          officialReportingUrl={version.officialReportingUrl}
                        />
                      </div>
                    ) : null}
                    <ApproveVersionButton packId={packId} packVersionId={version.id} />
                  </>
                ) : null}

                {isApproved ? (
                  <PublishVersionButton packId={packId} packVersionId={version.id} />
                ) : null}

                {isPublished ? (
                  <>
                    <WithdrawVersionButton packId={packId} packVersionId={version.id} />
                    {data.pack.authoritative ? (
                      <div style={{ marginTop: '1.25rem' }}>
                        <p className="card-kicker" style={{ marginBottom: '0.5rem' }}>
                          RUL-06 · Public Trust Lite
                        </p>
                        <div className="rows" style={{ marginBottom: '0.75rem' }}>
                          <div className="row">
                            <span className="row-key">Route Description</span>
                            <span className="row-val">{version.routeDescription ?? 'Not set'}</span>
                          </div>
                          <div className="row">
                            <span className="row-key">Official Fee</span>
                            <span className="row-val">
                              {version.officialFeeMinorUnits !== null &&
                              version.officialFeeCurrency !== null
                                ? formatPrice(
                                    version.officialFeeMinorUnits,
                                    version.officialFeeCurrency,
                                  )
                                : 'Not set'}
                              {version.officialFeeStaleAt ? (
                                <span
                                  className="badge badge-danger"
                                  style={{ marginLeft: '0.5rem' }}
                                >
                                  Marked Stale
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div className="row">
                            <span className="row-key">Status</span>
                            <span
                              className={`badge ${version.publicTrustPublishedAt ? 'badge-success' : 'badge-neutral'}`}
                            >
                              {version.publicTrustPublishedAt ? 'Live' : 'Not published'}
                            </span>
                          </div>
                        </div>
                        {version.publicTrustPublishedAt ? (
                          <div style={{ marginBottom: '0.75rem' }}>
                            <OfficialFeeStaleButton
                              packId={packId}
                              packVersionId={version.id}
                              stale={version.officialFeeStaleAt !== null}
                            />
                          </div>
                        ) : null}
                        <PublicTrustPublishButton
                          packId={packId}
                          packVersionId={version.id}
                          published={version.publicTrustPublishedAt !== null}
                        />
                        {version.publicTrustPublishedAt ? (
                          <p
                            className="muted"
                            style={{ fontSize: 'var(--text-small)', marginTop: '0.5rem' }}
                          >
                            Live at{' '}
                            <a href={`/trust/${data.pack.key}`} target="_blank" rel="noreferrer">
                              /trust/{data.pack.key}
                            </a>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {data.versions.length >= 2 ? (
        <article className="card u-mt-150">
          <p className="card-kicker">RUL-05</p>
          <h2 className="card-title">Compare Versions</h2>
          <p className="muted" style={{ margin: '0.35rem 0 1rem', fontSize: 'var(--text-small)' }}>
            See exactly which requirements were added, removed, or changed between two versions of
            this pack.
          </p>
          <form
            method="get"
            action={`/app/admin/packs/${packId}/diff`}
            style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div className="field-row">
              <label className="field-label" htmlFor="diff-from">
                From
              </label>
              <select id="diff-from" name="from" required className="input" defaultValue="">
                <option value="" disabled>
                  Choose a version…
                </option>
                {data.versions.map(({ version }) => (
                  <option key={version.id} value={version.id}>
                    Version {version.version} (
                    {VERSION_STATUS[version.status]?.label ?? version.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor="diff-to">
                To
              </label>
              <select id="diff-to" name="to" required className="input" defaultValue="">
                <option value="" disabled>
                  Choose a version…
                </option>
                {data.versions.map(({ version }) => (
                  <option key={version.id} value={version.id}>
                    Version {version.version} (
                    {VERSION_STATUS[version.status]?.label ?? version.status})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">
              Compare
            </button>
          </form>
        </article>
      ) : null}
    </section>
  );
}
