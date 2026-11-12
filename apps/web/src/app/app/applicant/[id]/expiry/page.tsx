import {
  type ExpiryUrgency,
  type StalenessStatus,
  classifyExpiry,
  getApplicant,
  getEvidenceCandidates,
  getReminderThresholds,
  listDocumentsDetailed,
  listIssuerVerificationsForDocument,
  listMissions,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeadlineClock } from '../../../../../components/deadline-clock';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { ShowMore } from '../../../../../components/show-more';
import { EmptyState, PageHeader, StatusBadge, type Tone } from '../../../../../components/ui';
import { AboutDisclosure } from '../../../../../components/ui-lift';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { formatDateOnly } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import {
  type SearchParamsRecord,
  TRAVELLER_LIST_STEP,
  nextShow,
  parseShow,
} from '../../../../../lib/paging';
import { plural } from '../../../../../lib/plural';
import { withSession } from '../../../../../lib/session';
import {
  CLOCK_EXPIRY_PAGE_LIMIT,
  deadlineLines,
  loadDeadlineEntries,
} from '../../../deadline-clock-data';

export const metadata: Metadata = { title: 'Dates & Expiry' };

export const dynamic = 'force-dynamic';

/**
 * Dates & Expiry, formerly the Expiry Centre (NTF-01, Part 5 §1): tracks intrinsic expiry,
 * case-specific staleness, and verification expiry SEPARATELY - three
 * sections below, never merged into one status, matching the directive's own
 * "never mutate the document's intrinsic validity to represent a route
 * rule."
 */

const URGENCY_BADGE: Record<ExpiryUrgency, { label: string; tone: string }> = {
  // No date is stored for it: say so, rather than "Unknown", which reads like a fault.
  unknown: { label: 'No Date on File', tone: 'badge-neutral' },
  ok: { label: 'OK', tone: 'badge-success' },
  reminder: { label: 'Expiring Soon', tone: 'badge-warning' },
  expired: { label: 'Expired', tone: 'badge-danger' },
};

const STALENESS_BADGE: Record<StalenessStatus, { label: string; tone: string }> = {
  not_applicable: { label: 'No Freshness Rule', tone: 'badge-neutral' },
  unknown: { label: 'Document Date Not Entered', tone: 'badge-neutral' },
  fresh: { label: 'Fresh', tone: 'badge-success' },
  stale: { label: 'Too Old for This Route', tone: 'badge-danger' },
};

/**
 * Why a document shows no expiry date, and what to do. A date is read from a passport's
 * machine-readable lines (intake) or typed by the person; the wording never guesses one.
 * `canType` is false until typed dates are switched on.
 */
function missingExpiryNote(docType: string | null, canType: boolean): string {
  if (docType === 'PASSPORT') {
    return canType
      ? 'No expiry date has been read from this passport yet. Check the file again on Documents, or enter the date yourself.'
      : 'No expiry date has been read from this passport yet. It is read from the two lines of letters and numbers at the bottom of the photo page. If they were not clear, open it on Documents to check it again, or upload a sharper scan.';
  }
  // Nothing is saved about what a document is until the person accepts its kind, so an
  // unconfirmed passport has no type yet: say what to do first rather than guess.
  if (docType === null) {
    return canType
      ? 'No expiry date is on file. Enter the date printed on this document yourself.'
      : 'No expiry date is on file. Confirm what kind of document this is on Documents. For a passport, the date is then read from the two lines at the bottom of the photo page.';
  }
  return canType
    ? 'No expiry date is on file. Enter the date printed on this document yourself.'
    : 'No expiry date is on file. For now, expiry dates are read only from passports, so check the date printed on this document yourself.';
}

/** The three lists, each with its own Show More (WP-SB4): `?docs=`, `?rules=`, `?checks=`. */
type ExpiryList = 'docs' | 'rules' | 'checks';

const ROW_NOUNS: Readonly<Record<ExpiryList, { one: string; other: string }>> = {
  docs: { one: 'document', other: 'documents' },
  rules: { one: 'date rule', other: 'date rules' },
  checks: { one: 'confirmation', other: 'confirmations' },
};

/**
 * The steps of one list. The page already holds every row (these lists are read whole for the
 * urgency sort), so Show More can reach the last row, however long the list is.
 */
function listPaging(total: number): { readonly step: number; readonly max: number } {
  const step = TRAVELLER_LIST_STEP;
  return { step, max: Math.max(step, Math.ceil(total / step) * step) };
}

/**
 * The end of one capped list: the count, and Show More while rows are left. Focus lands on the
 * first row that was added.
 */
function ListEnd({
  list,
  pathname,
  query,
  shown,
  total,
}: {
  readonly list: ExpiryList;
  readonly pathname: string;
  readonly query: SearchParamsRecord;
  readonly shown: number;
  readonly total: number;
}) {
  if (total <= TRAVELLER_LIST_STEP) return null;
  const next = shown < total ? nextShow(shown, listPaging(total)) : null;
  return (
    <ShowMore
      id={`expiry-${list}-more`}
      landOn={`expiry-${list}-${shown}`}
      pathname={pathname}
      searchParams={query}
      next={next === null ? null : { [list]: next }}
      shown={Math.min(shown, total)}
      total={total}
      noun={ROW_NOUNS[list]}
    />
  );
}

export default async function ExpiryCentrePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const locale = await primeLocale();
  const t = getServerT(appApplicantCatalog);
  const { id } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const pathname = `/app/applicant/${id}/expiry`;
  const showing = (list: ExpiryList, total: number) => parseShow(query[list], listPaging(total));
  const now = new Date();

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    // Started now so it runs beside the reads below; it never throws (a failed read is null).
    const deadlinesRead = loadDeadlineEntries(db, accountId, id, now, CLOCK_EXPIRY_PAGE_LIMIT);

    // Only everyday documents are watched for expiry: an archived file raises no reminder (LC-Z).
    const documents = await listDocumentsDetailed(db, accountId, id, {
      lifecycle: 'everyday',
      withExpiry: true,
    });
    const documentRows = documents.ok ? documents.value : [];

    const intrinsic = await Promise.all(
      documentRows.map(async (doc) => ({
        doc,
        thresholds: await getReminderThresholds(db, doc.docType),
      })),
    );

    const verificationLists = await Promise.all(
      documentRows.map((doc) => listIssuerVerificationsForDocument(db, doc.id)),
    );
    const verifications = documentRows.flatMap((doc, i) =>
      (verificationLists[i] ?? []).map((v) => ({ doc, verification: v })),
    );

    const missions = await listMissions(db, accountId, id);
    const missionRows = missions.ok ? missions.value : [];
    const candidatesByMission = await Promise.all(
      missionRows.map((m) => getEvidenceCandidates(db, accountId, m.id)),
    );
    const freshnessRows = missionRows.flatMap((mission, i) => {
      const candidates = candidatesByMission[i];
      if (!candidates || !candidates.ok) return [];
      return candidates.value
        .filter((c) => c.kind === 'DOCUMENT')
        .flatMap((c) =>
          c.documentCandidates
            .filter((d) => d.staleness.status !== 'not_applicable')
            .map((d) => ({ mission, requirementKey: c.key, document: d })),
        );
    });

    return { intrinsic, verifications, freshnessRows, deadlines: await deadlinesRead };
  });

  if (!data) notFound();
  const shownDocs = showing('docs', data.intrinsic.length);
  const shownRules = showing('rules', data.freshnessRows.length);
  const shownChecks = showing('checks', data.verifications.length);
  const depth = await readDepth('expiry');
  const depthWords = depthCopyFor('expiry');

  return (
    <>
      <PageHeader
        eyebrow={t('appApplicant.appApplicantIdExpiryPage.record')}
        title={t('appApplicant.appApplicantIdExpiryPage.datesExpiry')}
        actions={
          <Link href={`/app/applicant/${id}/calendar`} className="btn btn-secondary">
            {t('appApplicant.appApplicantIdExpiryPage.addDatesToMyCalendar')}
          </Link>
        }
      />

      {/* Owner, 5 Nov 2026: no page should have more than 30 words. What the three signals are, one tap away. */}
      <AboutDisclosure summary={t('appApplicant.appApplicantIdExpiryPage.aboutTheseDates')}>
        <p>{t('appApplicant.appApplicantIdExpiryPage.threeSeparateDatesWhenADocument')}</p>
      </AboutDisclosure>

      <DepthScope family="expiry" depth={depth}>
        <DepthSwitch family="expiry" initial={depth} copy={depthWords} />
        <div className="u-mb-150">
          <DeadlineClock
            heading={t('appApplicant.appApplicantIdExpiryPage.deadlineClock')}
            headingId="expiry-deadline-clock-heading"
            lines={
              data.deadlines === null ? null : deadlineLines(data.deadlines, { showPerson: false })
            }
            addAction={{ href: `/app/applicant/${id}/documents/add`, label: 'Add a Document' }}
          />
        </div>

        <div className="grid">
          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">
              {t('appApplicant.appApplicantIdExpiryPage.documentExpiry')}
            </p>
            <h2 className="card-title">{t('appApplicant.appApplicantIdExpiryPage.documents')}</h2>
            {data.intrinsic.length === 0 ? (
              <EmptyState
                icon="file"
                title={t('appApplicant.appApplicantIdExpiryPage.noDocumentsYet')}
                action={{ href: `/app/applicant/${id}/documents/add`, label: 'Add a Document' }}
              >
                {t('appApplicant.appApplicantIdExpiryPage.documentsWithAnExpiryDateSuch')}
              </EmptyState>
            ) : (
              <>
                <div className="rows u-mt-050">
                  {data.intrinsic
                    .map(({ doc, thresholds }) => ({
                      doc,
                      classification: classifyExpiry(
                        doc.expiresAt ? new Date(doc.expiresAt) : null,
                        now,
                        thresholds,
                      ),
                    }))
                    // Most urgent first: already expired, then soonest to expire; no date last.
                    .sort(
                      (a, b) =>
                        (a.classification.daysRemaining ?? Number.POSITIVE_INFINITY) -
                        (b.classification.daysRemaining ?? Number.POSITIVE_INFINITY),
                    )
                    .slice(0, shownDocs)
                    .map(({ doc, classification }, index) => {
                      const badge = URGENCY_BADGE[classification.urgency];
                      return (
                        <div className="row" key={doc.id} id={`expiry-docs-${index}`}>
                          <span className="attention-text">
                            <span className="row-key">{doc.approvedName ?? doc.originalName}</span>
                            {classification.daysRemaining !== null && doc.expiresAt ? (
                              <span className="attention-detail">
                                {classification.daysRemaining >= 0
                                  ? t('appApplicant.appApplicantIdExpiryPage.expiresInPlural', {
                                      plural: plural(classification.daysRemaining, 'day'),
                                    })
                                  : t('appApplicant.appApplicantIdExpiryPage.expiredPluralAgo', {
                                      plural: plural(Math.abs(classification.daysRemaining), 'day'),
                                    })}
                                {' · '}
                                {formatDateOnly(doc.expiresAt, locale)}
                              </span>
                            ) : classification.urgency === 'unknown' ? (
                              <span className="attention-detail">
                                {missingExpiryNote(doc.docType, doc.expiry?.canType === true)}
                                {doc.expiry?.canType ? (
                                  <>
                                    {' '}
                                    <Link
                                      href={`/app/applicant/${id}/documents?document=${doc.id}#expiry-${doc.id}`}
                                      aria-label={`Set Expiry Date: ${doc.approvedName ?? doc.originalName}`}
                                    >
                                      {t('appApplicant.appApplicantIdExpiryPage.setExpiryDate')}
                                    </Link>
                                  </>
                                ) : null}
                              </span>
                            ) : null}
                            {doc.expiresAt && doc.expiry?.origin === 'TYPED' ? (
                              <span className="attention-detail">
                                {t('appApplicant.appApplicantIdExpiryPage.enteredByYou')}
                              </span>
                            ) : null}
                            {doc.expiry?.mismatch ? (
                              <span className="attention-detail">
                                {t(
                                  'appApplicant.appApplicantIdExpiryPage.youEnteredADifferentDateCheck',
                                )}
                              </span>
                            ) : null}
                          </span>
                          <StatusBadge tone={badge.tone.replace('badge-', '') as Tone}>
                            {badge.label}
                          </StatusBadge>
                        </div>
                      );
                    })}
                </div>
                <ListEnd
                  list="docs"
                  pathname={pathname}
                  query={query}
                  shown={shownDocs}
                  total={data.intrinsic.length}
                />
              </>
            )}
          </article>

          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">
              {t('appApplicant.appApplicantIdExpiryPage.routeDateRules')}
            </p>
            <h2 className="card-title">{t('appApplicant.appApplicantIdExpiryPage.routeRules')}</h2>
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.75rem' }}>
              {t('appApplicant.appApplicantIdExpiryPage.someRequirementsDemandEvidenceDatedWithin')}
            </p>
            {data.freshnessRows.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={t('appApplicant.appApplicantIdExpiryPage.noDateRulesYet')}
              >
                {t('appApplicant.appApplicantIdExpiryPage.someVisaRoutesNeedADocument')}
              </EmptyState>
            ) : (
              <>
                <div className="rows u-mt-050">
                  {data.freshnessRows
                    .slice(0, shownRules)
                    .map(({ mission, requirementKey, document }, index) => {
                      const badge = STALENESS_BADGE[document.staleness.status];
                      return (
                        <div
                          className="row"
                          key={`${mission.id}-${requirementKey}-${document.documentId}`}
                          id={`expiry-rules-${index}`}
                        >
                          <span className="attention-text">
                            <span className="row-key">
                              {requirementKey}
                              <span
                                className="muted"
                                style={{ fontSize: 'var(--text-caption)', marginLeft: '0.5rem' }}
                              >
                                {mission.title}
                              </span>
                            </span>
                            {document.staleness.status === 'unknown' ? (
                              <span className="attention-detail">
                                This route needs a recently dated document, and no date has been
                                entered for this one, so it cannot be checked. Enter the date
                                printed on it under Document Date on{' '}
                                <Link href={`/app/applicant/${id}/documents`}>Documents</Link>.
                              </span>
                            ) : null}
                          </span>
                          <span className={`badge ${badge.tone}`}>{badge.label}</span>
                        </div>
                      );
                    })}
                </div>
                <ListEnd
                  list="rules"
                  pathname={pathname}
                  query={query}
                  shown={shownRules}
                  total={data.freshnessRows.length}
                />
              </>
            )}
          </article>

          <article className="card" {...atLevel('browse')}>
            <p className="card-kicker">
              {t('appApplicant.appApplicantIdExpiryPage.confirmationDates')}
            </p>
            <h2 className="card-title">
              {t('appApplicant.appApplicantIdExpiryPage.confirmationsFromIssuers')}
            </h2>
            {data.verifications.length === 0 ? (
              <EmptyState
                icon="check"
                title={t('appApplicant.appApplicantIdExpiryPage.noConfirmationsYet')}
              >
                {t('appApplicant.appApplicantIdExpiryPage.whenAnIssuerSuchAsA')}
              </EmptyState>
            ) : (
              <>
                <div className="rows u-mt-050">
                  {data.verifications.slice(0, shownChecks).map(({ doc, verification }, index) => {
                    const classification = classifyExpiry(verification.validUntil, now);
                    const badge = URGENCY_BADGE[classification.urgency];
                    return (
                      <div className="row" key={verification.id} id={`expiry-checks-${index}`}>
                        <span className="row-key">
                          {verification.issuerIdentity}
                          <span
                            className="muted"
                            style={{ fontSize: 'var(--text-caption)', marginLeft: '0.5rem' }}
                          >
                            {doc.approvedName ?? doc.originalName}
                          </span>
                        </span>
                        <span className={`badge ${badge.tone}`}>{badge.label}</span>
                      </div>
                    );
                  })}
                </div>
                <ListEnd
                  list="checks"
                  pathname={pathname}
                  query={query}
                  shown={shownChecks}
                  total={data.verifications.length}
                />
              </>
            )}
          </article>
        </div>
      </DepthScope>
    </>
  );
}
