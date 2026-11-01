import {
  type PackRequirement,
  getPack,
  listMissionsByPackVersion,
  listPackVersions,
  listRequirements,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DocumentTypeDatalist,
  FieldKeyDatalist,
} from '../../../../../components/catalogue-datalists';
import { ShowMore } from '../../../../../components/show-more';
import { PageHeader, StatusBadge } from '../../../../../components/ui';
import { isPlatformAdmin } from '../../../../../lib/admin';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import {
  type SearchParamsRecord,
  TEAM_LIST_STEP,
  TRAVELLER_LIST_STEP,
  firstParam,
  nextShow,
  pagingHref,
  parseShow,
} from '../../../../../lib/paging';
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

/** Requirements of the open version shown per step, and other versions listed per step. */
const REQUIREMENTS_STEP = TEAM_LIST_STEP;
const VERSIONS_STEP = TRAVELLER_LIST_STEP;
/**
 * Both lists are already read whole (the pack services have no page size), so Show More may grow
 * past the usual 100 rows: nothing in a pack may become unreachable.
 */
const IN_MEMORY_MAX = 100_000;

type RequirementKey = Pick<PackRequirement, 'kind' | 'fieldKey' | 'docType' | 'id'>;

/** Documents first, then fields, each by key, then by id. */
function byRequirementKey(a: RequirementKey, b: RequirementKey): number {
  return (
    a.kind.localeCompare(b.kind) ||
    (a.fieldKey ?? a.docType ?? '').localeCompare(b.fieldKey ?? b.docType ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/**
 * One requirement pack: one version open at a time (WP-SB7), chosen by `?version=` and the newest
 * by default, with its requirements as compact rows 25 at a time; every other version is a short
 * row that opens it. Only the open version's requirements and attached cases are read.
 */
export default async function PackDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ packId: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const { packId } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const { version: versionParam, show, versions: versionsParam } = query;
  const wantedVersion = firstParam(versionParam);
  const requirementsShown = parseShow(show, {
    step: REQUIREMENTS_STEP,
    max: IN_MEMORY_MAX,
  });
  const versionsShown = parseShow(versionsParam, { step: VERSIONS_STEP, max: IN_MEMORY_MAX });

  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const pack = await getPack(db, packId);
    if (!pack) return { admin: true as const, pack: null };
    const versions = await listPackVersions(db, packId);
    const open = versions.find((v) => v.id === wantedVersion) ?? versions[0];
    if (!open) return { admin: true as const, pack, versions, open: null };
    const [requirements, missionCount] = await Promise.all([
      // The read has no order of its own, so the page sorts on fields an edit never changes:
      // a requirement keeps its place (and its Show More page) after a source review is saved.
      listRequirements(db, open.id).then((rows) => [...rows].sort(byRequirementKey)),
      // Impact list (RUL-05) only matters once a version has ever been
      // usable by a mission -- a DRAFT/APPROVED version can never have one
      // attached, so skip the query rather than always paying for it.
      open.status === 'PUBLISHED' || open.status === 'WITHDRAWN'
        ? listMissionsByPackVersion(db, open.id).then((missions) => missions.length)
        : Promise.resolve(0),
    ]);
    return {
      admin: true as const,
      pack,
      versions,
      open: { version: open, requirements, missionCount },
    };
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
            {data.pack.authoritative ? 'Official Requirement Pack' : 'Agency Custom Checklist'}
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

      {data.open === null ? (
        <article className="card">
          <p className="card-body">
            No versions yet. Open a draft version to start adding cited requirements.
          </p>
        </article>
      ) : (
        (() => {
          const { version, missionCount } = data.open;
          const allRequirements = data.open.requirements;
          const requirements = allRequirements.slice(0, requirementsShown);
          const nextRequirements =
            allRequirements.length > requirements.length
              ? nextShow(requirementsShown, { step: REQUIREMENTS_STEP, max: IN_MEMORY_MAX })
              : null;
          const others = data.versions.filter((v) => v.id !== version.id);
          const shownOthers = others.slice(0, versionsShown);
          const nextVersions =
            others.length > shownOthers.length
              ? nextShow(versionsShown, { step: VERSIONS_STEP, max: IN_MEMORY_MAX })
              : null;
          const pathname = `/app/admin/packs/${packId}`;
          const badge = VERSION_STATUS[version.status] ?? {
            label: version.status,
            tone: 'badge-neutral',
          };
          const isDraft = version.status === 'DRAFT';
          const isApproved = version.status === 'APPROVED';
          const isPublished = version.status === 'PUBLISHED';
          const isWithdrawn = version.status === 'WITHDRAWN';
          return (
            <div className="sb7-pack-versions">
              <article className="card" key={version.id} id="pack-open-version">
                <div className="card-head">
                  <h2 className="card-title">Version {version.version}</h2>
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
                  <>
                    <div className="rows sb7-requirements" id="pack-requirements">
                      {requirements.map((req, index) => (
                        <div
                          className="row sb7-stack-row"
                          key={req.id}
                          id={`pack-requirement-${index}`}
                        >
                          <div className="sb7-stack-head">
                            <span className="row-key sb7-break">
                              {req.kind === 'FIELD' ? 'Field' : 'Document'}:{' '}
                              {req.fieldKey ?? req.docType}
                            </span>
                            <span className="row-end">
                              {req.sourceInaccessibleAt ? (
                                <span className="badge badge-danger">
                                  Source inaccessible since{' '}
                                  {formatTimestampDate(req.sourceInaccessibleAt)}
                                </span>
                              ) : null}
                              <span className="badge badge-neutral">
                                {req.optional ? 'Optional' : 'Required'}
                              </span>
                            </span>
                          </div>
                          <span className="muted u-fs-085 sb7-break">Cite: {req.citation}</span>
                          <details className="sb7-fold">
                            <summary>
                              Source and Checks
                              <span className="sr-only"> for {req.fieldKey ?? req.docType}</span>
                            </summary>
                            {req.sourceUrl ? (
                              <p className="muted">
                                <a href={req.sourceUrl} target="_blank" rel="noopener noreferrer">
                                  {req.sourceTitle ?? 'Source Reference'}
                                </a>
                                {req.publisher ? `, ${req.publisher}` : ''}
                                {req.observedDate
                                  ? `, checked ${formatDateOnly(req.observedDate)}`
                                  : ', checked date not recorded'}
                              </p>
                            ) : (
                              <p className="muted u-fs-085">No source recorded yet.</p>
                            )}
                            {req.maxAgeDays !== null ? (
                              <p className="muted u-fs-085">
                                Freshness: must be dated within {req.maxAgeDays} day(s)
                              </p>
                            ) : null}
                            {isDraft ? (
                              <RequirementSourceReviewForm
                                packId={data.pack.id}
                                requirementId={req.id}
                                sourceUrl={req.sourceUrl}
                                sourceTitle={req.sourceTitle}
                                publisher={req.publisher}
                                observedDate={req.observedDate?.toISOString().slice(0, 10) ?? ''}
                              />
                            ) : null}
                            <SourceInaccessibleButton
                              packId={packId}
                              requirementId={req.id}
                              inaccessible={req.sourceInaccessibleAt !== null}
                            />
                          </details>
                        </div>
                      ))}
                    </div>
                    <ShowMore
                      id="pack-requirements-more"
                      pathname={pathname}
                      searchParams={query}
                      next={nextRequirements === null ? null : { show: nextRequirements }}
                      shown={requirements.length}
                      total={allRequirements.length}
                      noun={{ one: 'requirement', other: 'requirements' }}
                      landOn={`pack-requirement-${requirements.length}`}
                    />
                  </>
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
                        Download Manifest
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
                        <div className="rows rows-grid" style={{ marginBottom: '0.75rem' }}>
                          <div className="row row-wide">
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
                              {version.publicTrustPublishedAt ? 'Live' : 'Not Published'}
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
              {others.length > 0 ? (
                <article className="card" id="pack-other-versions">
                  <h2 className="card-title">Other Versions</h2>
                  <div className="rows u-mt-050">
                    {shownOthers.map((other, index) => {
                      const otherBadge = VERSION_STATUS[other.status] ?? {
                        label: other.status,
                        tone: 'badge-neutral',
                      };
                      return (
                        <Link
                          className="row row-link"
                          key={other.id}
                          id={`pack-version-row-${index}`}
                          href={pagingHref(
                            pathname,
                            query,
                            { version: other.id, show: null },
                            'pack-open-version',
                          )}
                        >
                          <span className="row-key">Version {other.version}</span>
                          <span className={`badge ${otherBadge.tone}`}>{otherBadge.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                  <ShowMore
                    id="pack-versions-more"
                    pathname={pathname}
                    searchParams={query}
                    next={nextVersions === null ? null : { versions: nextVersions }}
                    shown={shownOthers.length}
                    total={others.length}
                    noun={{ one: 'other version', other: 'other versions' }}
                    landOn={`pack-version-row-${shownOthers.length}`}
                  />
                </article>
              ) : null}
            </div>
          );
        })()
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
                {data.versions.map((version) => (
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
                {data.versions.map((version) => (
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
