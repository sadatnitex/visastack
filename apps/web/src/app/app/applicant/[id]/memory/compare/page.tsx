import {
  type ComparedVersion,
  type SnapshotChanges,
  type SnapshotDetailComparison,
  accountPrincipal,
  compareSnapshotDetail,
  listChangesSinceSnapshot,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, StatusBadge } from '../../../../../../components/ui';
import {
  AMOUNT_BASIS_LABELS,
  FACT_STATUS_LABELS,
  RESULT_NEXT_STEPS,
  RESULT_TONES,
  changeLine,
  comparableVersionId,
  compareHref,
  detailName,
  memoryHref,
  reviewSentence,
} from '../../../../../../lib/application-memory-labels';
import { formatDateOnly, formatTimestampDate } from '../../../../../../lib/format-date';
import { createKeyManagementPort } from '../../../../../../lib/providers';
import { withSession } from '../../../../../../lib/session';

export const metadata: Metadata = { title: 'Then and Now' };

export const dynamic = 'force-dynamic';

type Search = Promise<{ snapshot?: string | string[]; version?: string | string[] }>;

/** Reasons that only arise for an amount, whose currency and tax basis are then shown. */
const AMOUNT_REASONS: ReadonlySet<string> = new Set([
  'currency_unknown',
  'different_currency',
  'basis_unknown',
  'different_basis',
]);

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

type Loaded =
  | { readonly kind: 'changes'; readonly changes: SnapshotChanges }
  | { readonly kind: 'detail'; readonly detail: SnapshotDetailComparison }
  | { readonly kind: 'unavailable'; readonly changes: SnapshotChanges };

/**
 * E03 prior-versus-current view (WP-V3 part 3). With only `snapshot`, lists
 * what differs from today by name. With `version` too, shows one detail as
 * that snapshot recorded it beside the version in use now: values (unless
 * sensitive), dates, how each was saved, the note saved with each version as
 * a statement, the result in the fixed vocabulary, and the next step through
 * the existing ways to fix a detail and confirm a case. Owner only.
 */
export default async function ThenAndNowPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Search;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const snapshotId = one(query.snapshot);
  const versionId = one(query.version);
  if (!snapshotId) notFound();

  const loaded = await withSession(async ({ db, accountId }): Promise<Loaded | null> => {
    const principal = accountPrincipal(accountId);
    const viewGate = await requireAccess(
      db,
      principal,
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'application_memory' },
    );
    if (!viewGate.ok) return null;
    const changes = await listChangesSinceSnapshot(viewGate.value, snapshotId);
    if (!changes.ok) return null;
    if (!versionId) return { kind: 'changes', changes: changes.value };

    const manageGate = await requireAccess(
      db,
      principal,
      'MANAGE',
      { applicantId: id },
      { purpose: 'application_memory' },
    );
    if (!manageGate.ok) return null;
    const encryption = createKeyManagementPort();
    const detail = await compareSnapshotDetail(manageGate.value, {
      snapshotId,
      factVersionId: versionId,
      ...(encryption ? { encryption } : {}),
    });
    if (detail.ok) return { kind: 'detail', detail: detail.value };
    if (detail.error.code === 'not_found' || detail.error.code === 'forbidden') return null;
    return { kind: 'unavailable', changes: changes.value };
  });
  if (!loaded) notFound();

  if (loaded.kind === 'detail') return <DetailView applicantId={id} detail={loaded.detail} />;
  return (
    <ChangesView
      applicantId={id}
      changes={loaded.changes}
      unavailable={loaded.kind === 'unavailable'}
    />
  );
}

function ChangesView({
  applicantId,
  changes,
  unavailable,
}: {
  readonly applicantId: string;
  readonly changes: SnapshotChanges;
  readonly unavailable: boolean;
}) {
  const { snapshot } = changes;
  return (
    <>
      <PageHeader
        back={{ href: memoryHref(applicantId), label: 'Application Memory' }}
        eyebrow="Then and Now"
        title={`Since Snapshot ${snapshot.version}`}
        description={`${snapshot.missionTitle}: what differs today from snapshot ${snapshot.version}, taken on ${formatTimestampDate(snapshot.takenAt)}. Names only; open a detail to compare it.`}
        as="h2"
      />
      {unavailable ? (
        <p className="notice notice-warn">
          This comparison cannot be shown right now. Try again later.
        </p>
      ) : null}
      <article className="card then-now-card">
        <p className="then-now-review">{reviewSentence(snapshot.version, changes.review)}</p>
        {!snapshot.exact ? (
          <p className="then-now-note">
            This older snapshot did not record exact versions, so the changes cannot be listed.
          </p>
        ) : changes.changes.length === 0 ? (
          <p className="then-now-note">
            Nothing differs by version: every detail and document in this snapshot is still the one
            in use.
          </p>
        ) : (
          <ul className="then-now-changes">
            {changes.changes.map((change) => {
              const line = changeLine(change);
              const version = comparableVersionId(change);
              const key =
                change.kind === 'detail'
                  ? `detail-${change.factId}`
                  : change.kind === 'document'
                    ? `document-${change.documentId}`
                    : `case-${change.caseField}`;
              return (
                <li key={key}>
                  <span className="case-change-text">
                    <span className="case-change-name">{line.name}</span>: {line.what}
                  </span>
                  {version ? (
                    <Link
                      className="case-change-link"
                      href={compareHref(applicantId, snapshot.id, version)}
                      aria-label={`Compare ${line.name}, then and now`}
                    >
                      Compare
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {snapshot.exact && changes.unchangedDetailCount > 0 ? (
          <p className="then-now-note">
            {changes.unchangedDetailCount === 1
              ? '1 detail is still the version this snapshot used.'
              : `${changes.unchangedDetailCount} details are still the versions this snapshot used.`}
          </p>
        ) : null}
        <div className="then-now-actions">
          <Link
            className="btn btn-secondary"
            href={`/app/mission/${snapshot.missionId}/snapshots/${snapshot.id}`}
          >
            View Snapshot {snapshot.version}
          </Link>
          <Link className="btn btn-secondary" href={`/app/mission/${snapshot.missionId}`}>
            Open the Case
          </Link>
        </div>
      </article>
    </>
  );
}

function SideFacts({
  side,
  hidden,
  asOf,
  amount,
}: {
  readonly side: ComparedVersion;
  readonly hidden: boolean;
  readonly asOf: string;
  readonly amount: boolean;
}) {
  return (
    <dl className="then-now-facts">
      <dt>Value</dt>
      <dd className="then-now-value">
        {hidden ? 'Hidden here to keep it private' : (side.value ?? 'Not recorded')}
      </dd>
      {amount ? (
        <>
          <dt>Currency</dt>
          <dd>{side.currency ?? 'Not recorded'}</dd>
          <dt>Before or After Tax</dt>
          <dd>{side.basis ? AMOUNT_BASIS_LABELS[side.basis] : 'Not recorded'}</dd>
        </>
      ) : null}
      <dt>True From</dt>
      <dd>{side.effectiveFrom ? formatDateOnly(side.effectiveFrom) : 'Not recorded'}</dd>
      <dt>Saved On</dt>
      <dd>{formatTimestampDate(side.recordedAt)}</dd>
      <dt>As Of</dt>
      <dd>{asOf}</dd>
      <dt>How It Was Saved</dt>
      <dd>{FACT_STATUS_LABELS[side.status] ?? 'Recorded'}</dd>
      <dt>Note Saved with It</dt>
      <dd>
        {side.explanation ? (
          <>
            <q>{side.explanation}</q>
            <span className="then-now-assertion">
              What was written at the time. A statement, not proof.
            </span>
          </>
        ) : (
          'None'
        )}
      </dd>
    </dl>
  );
}

function DetailView({
  applicantId,
  detail,
}: {
  readonly applicantId: string;
  readonly detail: SnapshotDetailComparison;
}) {
  const { snapshot, comparison, review, valuesHidden } = detail;
  const name = detailName(comparison.fieldKey);
  const next = RESULT_NEXT_STEPS[comparison.result];
  const amount =
    AMOUNT_REASONS.has(comparison.reason) ||
    comparison.prior.currency !== null ||
    comparison.current.currency !== null;
  return (
    <>
      <PageHeader
        back={{
          href: compareHref(applicantId, snapshot.id),
          label: `Since Snapshot ${snapshot.version}`,
        }}
        eyebrow="Then and Now"
        title={name}
        description={`${snapshot.missionTitle}: this detail as snapshot ${snapshot.version} recorded it, beside the version in use today.`}
        as="h2"
      />

      <section className="card then-now-result" aria-labelledby="then-now-result-heading">
        <h3 className="then-now-kicker" id="then-now-result-heading">
          Result
        </h3>
        <p className="then-now-result-line">
          <StatusBadge tone={RESULT_TONES[comparison.result]}>{comparison.label}</StatusBadge>
          <span>{comparison.reasonText}</span>
        </p>
        <p className="then-now-note">
          This compares what was recorded. It does not say which value is true.
        </p>
      </section>

      <div className="then-now-sides">
        <article className="card then-now-side" aria-labelledby="then-now-then">
          <h3 className="card-title" id="then-now-then">
            In Snapshot {snapshot.version}
          </h3>
          <SideFacts
            side={comparison.prior}
            hidden={valuesHidden}
            amount={amount}
            asOf={`Snapshot taken ${formatTimestampDate(snapshot.takenAt)}`}
          />
        </article>
        <article className="card then-now-side" aria-labelledby="then-now-now">
          <h3 className="card-title" id="then-now-now">
            Today
          </h3>
          <SideFacts
            side={comparison.current}
            hidden={valuesHidden}
            amount={amount}
            asOf="Your record today"
          />
        </article>
      </div>

      <section className="card then-now-next" aria-labelledby="then-now-next-heading">
        <h3 className="card-title" id="then-now-next-heading">
          What to Do Next
        </h3>
        <p className="then-now-review">{reviewSentence(snapshot.version, review)}</p>
        <p>{next.text}</p>
        <div className="then-now-actions">
          {next.updateDetail ? (
            <Link className="btn btn-primary" href={`/app/applicant/${applicantId}/profile`}>
              Update This Detail
            </Link>
          ) : null}
          <Link
            className={next.updateDetail ? 'btn btn-secondary' : 'btn btn-primary'}
            href={`/app/mission/${snapshot.missionId}#snapshots`}
          >
            Open the Case
          </Link>
        </div>
        <p className="then-now-note">
          Snapshot {snapshot.version} keeps exactly what it held. Updating a detail adds a new
          version and never changes a snapshot.
        </p>
      </section>
    </>
  );
}
