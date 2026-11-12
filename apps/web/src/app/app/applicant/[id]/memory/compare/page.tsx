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
import { ShowMore } from '../../../../../../components/show-more';
import { PageHeader, StatusBadge } from '../../../../../../components/ui';
import { applicantMemoryCatalog } from '../../../../../../i18n/applicant-memory';
import {
  AMOUNT_BASIS_LABELS,
  RESULT_NEXT_STEPS,
  RESULT_TONES,
  changeLine,
  comparableVersionId,
  compareHref,
  detailName,
  memoryHref,
  profileSectionHref,
  reviewSentence,
} from '../../../../../../lib/application-memory-labels';
import { fieldStatusWords } from '../../../../../../lib/field-state-words';
import { formatDateOnly, formatTimestampDate } from '../../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../../lib/i18n-server';
import { TRAVELLER_LIST_STEP, nextShow, parseShow } from '../../../../../../lib/paging';
import { createKeyManagementPort } from '../../../../../../lib/providers';
import { withSession } from '../../../../../../lib/session';

export const metadata: Metadata = { title: 'Then and Now' };

export const dynamic = 'force-dynamic';

type Search = Promise<{
  snapshot?: string | string[];
  version?: string | string[];
  show?: string | string[];
}>;

/** The id of the n-th change in the list (from 1), so Show More can land on the first new one. */
const changeAnchor = (position: number) => `then-now-change-${position}`;

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
  await primeLocale();
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
      show={query.show}
    />
  );
}

function ChangesView({
  applicantId,
  changes,
  unavailable,
  show,
}: {
  readonly applicantId: string;
  readonly changes: SnapshotChanges;
  readonly unavailable: boolean;
  /** The `show` address value: ten changes at a time, Show More for the next ten (WP-SB1). */
  readonly show: string | string[] | undefined;
}) {
  const t = getServerT(applicantMemoryCatalog);
  const { snapshot } = changes;
  // The changes are already read in full (comparing needs them all), so every one stays reachable.
  const paging = {
    step: TRAVELLER_LIST_STEP,
    max: Math.ceil(changes.changes.length / TRAVELLER_LIST_STEP) * TRAVELLER_LIST_STEP,
  };
  const listed = changes.changes.slice(0, parseShow(show, paging));
  const next = changes.changes.length > listed.length ? nextShow(listed.length, paging) : null;
  return (
    <>
      <PageHeader
        back={{ href: memoryHref(applicantId), label: 'Case History' }}
        eyebrow={t('applicantMemory.appApplicantIdMemoryComparePage.thenAndNow')}
        title={t('applicantMemory.appApplicantIdMemoryComparePage.sinceSnapshotVersion', {
          version: snapshot.version,
        })}
        description={t(
          'applicantMemory.appApplicantIdMemoryComparePage.missiontitleWhatDiffersTodayFromSnapshot',
          {
            missionTitle: snapshot.missionTitle,
            version: snapshot.version,
            formatTimestampDate: formatTimestampDate(snapshot.takenAt),
          },
        )}
        as="h2"
      />
      {unavailable ? (
        <p className="notice notice-warn">
          {t('applicantMemory.appApplicantIdMemoryComparePage.thisComparisonCannotBeShownRight')}
        </p>
      ) : null}
      <article className="card then-now-card">
        <p className="then-now-review">{reviewSentence(snapshot.version, changes.review)}</p>
        {!snapshot.exact ? (
          <p className="then-now-note">
            {t('applicantMemory.appApplicantIdMemoryComparePage.thisOlderSnapshotDidNotRecord')}
          </p>
        ) : changes.changes.length === 0 ? (
          <p className="then-now-note">
            {t(
              'applicantMemory.appApplicantIdMemoryComparePage.nothingDiffersByVersionEveryDetail',
            )}
          </p>
        ) : (
          <>
            <ul className="then-now-changes">
              {listed.map((change, index) => {
                const line = changeLine(change);
                const version = comparableVersionId(change);
                const key =
                  change.kind === 'detail'
                    ? `detail-${change.factId}`
                    : change.kind === 'document'
                      ? `document-${change.documentId}`
                      : `case-${change.caseField}`;
                return (
                  <li key={key} id={changeAnchor(index + 1)}>
                    <span className="case-change-text">
                      <span className="case-change-name">{line.name}</span>: {line.what}
                    </span>
                    {version ? (
                      <Link
                        className="case-change-link"
                        href={compareHref(applicantId, snapshot.id, version)}
                        aria-label={t(
                          'applicantMemory.appApplicantIdMemoryComparePage.compareNameThenAndNow',
                          { name: line.name },
                        )}
                      >
                        {t('applicantMemory.appApplicantIdMemoryComparePage.compare')}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <ShowMore
              id="then-now-more"
              landOn={changeAnchor(listed.length + 1)}
              pathname={`/app/applicant/${applicantId}/memory/compare`}
              searchParams={{ snapshot: snapshot.id }}
              next={next === null ? null : { show: next }}
              shown={listed.length}
              total={changes.changes.length}
              noun={{ one: 'change', other: 'changes' }}
            />
          </>
        )}
        {snapshot.exact && changes.unchangedDetailCount > 0 ? (
          <p className="then-now-note">
            {changes.unchangedDetailCount === 1
              ? t('applicantMemory.appApplicantIdMemoryComparePage.1DetailIsStillTheVersion')
              : t(
                  'applicantMemory.appApplicantIdMemoryComparePage.unchangeddetailcountDetailsAreStillTheVersions',
                  { unchangedDetailCount: changes.unchangedDetailCount },
                )}
          </p>
        ) : null}
        <div className="then-now-actions">
          <Link
            className="btn btn-secondary"
            href={`/app/mission/${snapshot.missionId}/snapshots/${snapshot.id}`}
          >
            {t('applicantMemory.appApplicantIdMemoryComparePage.viewSnapshotVersion', {
              version: snapshot.version,
            })}
          </Link>
          <Link className="btn btn-secondary" href={`/app/mission/${snapshot.missionId}`}>
            {t('applicantMemory.appApplicantIdMemoryComparePage.openTheCase')}
          </Link>
        </div>
      </article>
    </>
  );
}

function SideFacts({
  side,
  hidden,
  noteSaved,
  asOf,
  amount,
}: {
  readonly side: ComparedVersion;
  readonly hidden: boolean;
  /** Whether a note was saved with this side, said even when the note is hidden. */
  readonly noteSaved: boolean;
  readonly asOf: string;
  readonly amount: boolean;
}) {
  const t = getServerT(applicantMemoryCatalog);
  return (
    <dl className="then-now-facts">
      <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.value')}</dt>
      <dd className="then-now-value">
        {hidden
          ? t('applicantMemory.appApplicantIdMemoryComparePage.hiddenHereToKeepItPrivate')
          : (side.value ?? t('applicantMemory.appApplicantIdMemoryComparePage.notRecorded'))}
      </dd>
      {amount ? (
        <>
          <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.currency')}</dt>
          <dd>
            {side.currency ?? t('applicantMemory.appApplicantIdMemoryComparePage.notRecorded')}
          </dd>
          <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.beforeOrAfterTax')}</dt>
          <dd>
            {side.basis
              ? AMOUNT_BASIS_LABELS[side.basis]
              : t('applicantMemory.appApplicantIdMemoryComparePage.notRecorded')}
          </dd>
        </>
      ) : null}
      <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.trueFrom')}</dt>
      <dd>
        {side.effectiveFrom
          ? formatDateOnly(side.effectiveFrom)
          : t('applicantMemory.appApplicantIdMemoryComparePage.notRecorded')}
      </dd>
      <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.savedOn')}</dt>
      <dd>{formatTimestampDate(side.recordedAt)}</dd>
      <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.asOf')}</dt>
      <dd>{asOf}</dd>
      <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.howItWasSaved')}</dt>
      <dd>{fieldStatusWords(side.status)}</dd>
      <dt>{t('applicantMemory.appApplicantIdMemoryComparePage.noteSavedWithIt')}</dt>
      <dd>
        {hidden ? (
          noteSaved ? (
            t('applicantMemory.appApplicantIdMemoryComparePage.aNoteWasSavedHiddenHere')
          ) : (
            t('applicantMemory.appApplicantIdMemoryComparePage.none')
          )
        ) : side.explanation ? (
          <>
            <q>{side.explanation}</q>
            <span className="then-now-assertion">
              {t('applicantMemory.appApplicantIdMemoryComparePage.whatWasWrittenAtTheTime')}
            </span>
          </>
        ) : (
          t('applicantMemory.appApplicantIdMemoryComparePage.none')
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
  const t = getServerT(applicantMemoryCatalog);
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
        eyebrow={t('applicantMemory.appApplicantIdMemoryComparePage.thenAndNow')}
        title={name}
        description={t(
          'applicantMemory.appApplicantIdMemoryComparePage.missiontitleThisDetailAsSnapshotVersion',
          { missionTitle: snapshot.missionTitle, version: snapshot.version },
        )}
        as="h2"
      />

      <section className="card then-now-result" aria-labelledby="then-now-result-heading">
        <h3 className="then-now-kicker" id="then-now-result-heading">
          {t('applicantMemory.appApplicantIdMemoryComparePage.result')}
        </h3>
        <p className="then-now-result-line">
          <StatusBadge tone={RESULT_TONES[comparison.result]}>{comparison.label}</StatusBadge>
          <span>{comparison.reasonText}</span>
        </p>
        <p className="then-now-note">
          {t('applicantMemory.appApplicantIdMemoryComparePage.thisComparesWhatWasRecordedIt')}
        </p>
      </section>

      <div className="then-now-sides">
        <article className="card then-now-side" aria-labelledby="then-now-then">
          <h3 className="card-title" id="then-now-then">
            {t('applicantMemory.appApplicantIdMemoryComparePage.inSnapshotVersion', {
              version: snapshot.version,
            })}
          </h3>
          <SideFacts
            side={comparison.prior}
            hidden={valuesHidden}
            noteSaved={detail.notesSaved.prior}
            amount={amount}
            asOf={`Snapshot taken ${formatTimestampDate(snapshot.takenAt)}`}
          />
        </article>
        <article className="card then-now-side" aria-labelledby="then-now-now">
          <h3 className="card-title" id="then-now-now">
            {t('applicantMemory.appApplicantIdMemoryComparePage.today')}
          </h3>
          <SideFacts
            side={comparison.current}
            hidden={valuesHidden}
            noteSaved={detail.notesSaved.current}
            amount={amount}
            asOf="Your record today"
          />
        </article>
      </div>

      <section className="card then-now-next" aria-labelledby="then-now-next-heading">
        <h3 className="card-title" id="then-now-next-heading">
          {t('applicantMemory.appApplicantIdMemoryComparePage.whatToDoNext')}
        </h3>
        <p className="then-now-review">{reviewSentence(snapshot.version, review)}</p>
        <p>{next.text}</p>
        <div className="then-now-actions">
          {next.updateDetail ? (
            <Link
              className="btn btn-primary"
              href={profileSectionHref(applicantId, comparison.fieldKey)}
            >
              {t('applicantMemory.appApplicantIdMemoryComparePage.updateThisDetail')}
            </Link>
          ) : null}
          <Link
            className={next.updateDetail ? 'btn btn-secondary' : 'btn btn-primary'}
            href={`/app/mission/${snapshot.missionId}#snapshots`}
          >
            {t('applicantMemory.appApplicantIdMemoryComparePage.openTheCase')}
          </Link>
        </div>
        <p className="then-now-note">
          {t('applicantMemory.appApplicantIdMemoryComparePage.snapshotVersionKeepsExactlyWhatIt', {
            version: snapshot.version,
          })}
        </p>
      </section>
    </>
  );
}
