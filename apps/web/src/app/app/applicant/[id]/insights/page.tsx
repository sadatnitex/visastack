import { accountPrincipal, getTravellerInsights, requireAccess } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../../../components/icons';
import {
  type AttentionEntry,
  AttentionList,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '../../../../../components/ui';
import { applicantInsightsCatalog } from '../../../../../i18n/applicant-insights';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import {
  EXPIRY_BADGE,
  ORIGINAL_STATE_BADGE,
  READINESS_BADGE,
  detailName,
  documentName,
  plural,
  readinessLine,
  timeUntilExpiry,
} from '../../../../../lib/insights-wording';
import { documentTypeLabel } from '../../../../../lib/labels';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';

export const metadata: Metadata = { title: 'Document Insights' };

/** WP-SB3: each card lists at most this many rows; the rest are on the card's own page. */
const CARD_ROWS = 5;

/** A page that lists the rest of a capped card. */
interface MorePage {
  readonly href: string;
  readonly label: string;
}

/** Under a capped card list: how many rows show, and the page or pages that list them all. */
function MoreOnItsPage({
  shown,
  total,
  noun,
  href,
  label,
  pages,
}: {
  readonly shown: number;
  readonly total: number;
  readonly noun: string;
  readonly href?: string;
  readonly label?: string;
  /** More than one page, when the rows that are not shown are resolved in different places. */
  readonly pages?: readonly MorePage[];
}) {
  const t = getServerT(applicantInsightsCatalog);
  if (total <= shown) return null;
  const links = pages ?? (href && label ? [{ href, label }] : []);
  return (
    <p className="insights-more">
      <span className="insights-note">
        {t.node('applicantInsights.appApplicantIdInsightsPage.showingShownOfTotalNoun', {
          shown,
          total,
          noun,
        })}
      </span>{' '}
      {links.map((link) => (
        <Link key={link.href} className="btn btn-secondary insights-action" href={link.href}>
          {link.label}
        </Link>
      ))}
    </p>
  );
}

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal';

/**
 * One insights card that opens and closes (WP-SB3). The kicker and heading stay above the toggle,
 * so the card is still found by its heading; the toggle names what it holds and how many.
 */
function InsightsCard({
  id,
  kicker,
  title,
  tone,
  icon,
  listName,
  count,
  open,
  children,
}: {
  readonly id: string;
  /** The colour this card speaks in, so a person can tell the cards apart before reading them. */
  readonly tone: Tone;
  readonly icon: IconName;
  readonly kicker: string;
  readonly title: string;
  /** What the card lists, as the toggle names it ("Dates", "Cases"). */
  readonly listName: string;
  readonly count: number;
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className="card insights-card" aria-labelledby={id} data-tone={tone}>
      <div className="insights-card-head">
        <span className="insights-card-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <div>
          <p className="card-kicker">{kicker}</p>
          <h3 className="card-title" id={id}>
            {title}
          </h3>
        </div>
      </div>
      <details className="insights-card-fold" open={open || undefined}>
        <summary className="insights-card-summary">
          <span className="insights-card-list">{listName}</span>
          <span className="insights-card-count" aria-hidden="true">
            {count}
          </span>
          <span className="sr-only">{`, ${count}`}</span>
        </summary>
        <div className="insights-card-body">{children}</div>
      </details>
    </section>
  );
}

/**
 * Document Insights (AI data plan Phase 2, deterministic first slice): one summary page per
 * traveller, built from what is already stored. Owner-only through the central access gate.
 * Nothing on this page shows a saved value, a value read from a document, or a file name: the
 * service returns kinds, detail names, section names, counts and expiry dates only.
 */
export default async function DocumentInsightsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  await primeLocale();
  const t = getServerT(applicantInsightsCatalog);
  const { id } = await params;
  const loaded = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'self' },
    );
    // Owner-only: anyone else, including someone the traveller shared with, sees "not found".
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') return null;
    const encryption = createKeyManagementPort();
    return getTravellerInsights(access.value, encryption ? { encryption } : {});
  });
  if (!loaded) notFound();

  const documentsHref = `/app/applicant/${id}/documents`;
  const header = (
    <PageHeader
      as="h2"
      eyebrow={t('applicantInsights.appApplicantIdInsightsPage.documentInsights')}
      title={t('applicantInsights.appApplicantIdInsightsPage.whatYourDocumentsShow')}
      description={t('applicantInsights.appApplicantIdInsightsPage.aSummaryOfYourSavedDocuments')}
      back={{ href: documentsHref, label: 'Documents' }}
    />
  );
  if (!loaded.ok) {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          {t.node('applicantInsights.appApplicantIdInsightsPage.weCouldNotPutThisSummary')}
        </p>
      </>
    );
  }
  const insights = loaded.value;
  const profileHref = `/app/applicant/${id}/profile`;
  const documentHref = (documentId: string) =>
    `${documentsHref}?document=${encodeURIComponent(documentId)}`;
  const uploadHref = (kind: string) => `${documentsHref}/add?type=${encodeURIComponent(kind)}`;

  const toCheck: AttentionEntry[] = [
    ...insights.mismatches.map((mismatch) => {
      // A detail from a restricted document is named by its section only (owner decision).
      const named = mismatch.fieldKey !== null;
      const section = mismatch.section?.label ?? null;
      const detail = mismatch.fieldKey
        ? detailName(mismatch.fieldKey)
        : section
          ? `a detail in ${section}`
          : 'a detail';
      const where = [
        mismatch.document ? `your ${documentName(mismatch.document)}` : null,
        named ? section : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');
      return mismatch.source === 'pending_reading'
        ? {
            key: mismatch.key,
            href: mismatch.document ? documentHref(mismatch.document.id) : documentsHref,
            label: `${named ? detail : `A${detail.slice(1)}`} differs from your saved detail`,
            detail: `Read from ${where}. Check which is right.`,
            tone: 'warning' as const,
          }
        : {
            key: mismatch.key,
            href: profileHref,
            label: `Two values for ${detail}`,
            detail: `${where ? `One came from ${where}. ` : ''}Pick the right one on your profile.`,
            tone: 'danger' as const,
          };
    }),
    ...insights.checksToReview.map(({ document, count }) => ({
      key: `check:${document.id}`,
      href: documentHref(document.id),
      label: `${documentName(document)}: ${plural(count, 'point')} to look at`,
      detail: 'The document check found something that may not match your profile.',
      count,
    })),
  ];

  // A count that asks for something is coloured by what it asks; a zero is green, so the page reads at a glance.
  const calm = (value: number, asking: Tone): Tone => (value > 0 ? asking : 'green');
  const summary: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly tone: Tone;
    readonly icon: IconName;
  }[] = [
    {
      key: 'documents',
      label: 'Documents',
      value: insights.summary.documents,
      tone: 'blue',
      icon: 'file',
    },
    {
      key: 'check',
      label: 'Details to Check',
      value: insights.summary.toCheck,
      tone: calm(insights.summary.toCheck, 'amber'),
      icon: 'alert',
    },
    {
      key: 'expiry',
      label: 'Expired or Expiring Soon',
      value: insights.summary.expired + insights.summary.expiringSoon,
      tone: calm(insights.summary.expired + insights.summary.expiringSoon, 'red'),
      icon: 'clock',
    },
    {
      key: 'coverage',
      label: 'Sections Without a Document',
      value: insights.summary.sectionsWithoutDocument,
      tone: calm(insights.summary.sectionsWithoutDocument, 'violet'),
      icon: 'clipboard',
    },
  ];
  const missingSections = insights.coverage.sections.filter((section) => !section.covered);
  const coveredSections = insights.coverage.sections.filter((section) => section.covered);
  // The cards that need the person start open; with nothing to act on, the first one does.
  const expiringNow = insights.summary.expired + insights.summary.expiringSoon > 0;
  const checkOpen = toCheck.length > 0 || !expiringNow;
  const originalCases = insights.originals.cases.slice(0, CARD_ROWS);
  // A difference not shown is settled on the profile (two saved values) or the documents page
  // (a reading or a check), so the card links to whichever pages hold the rest.
  const unseenChecks = toCheck.slice(CARD_ROWS);
  const checkPages: MorePage[] = [
    ...(unseenChecks.some((entry) => entry.href !== profileHref)
      ? [{ href: documentsHref, label: 'Open Documents' }]
      : []),
    ...(unseenChecks.some((entry) => entry.href === profileHref)
      ? [{ href: profileHref, label: 'Open Profile' }]
      : []),
  ];

  return (
    <>
      {header}

      <ul
        className="insights-summary"
        aria-label={t('applicantInsights.appApplicantIdInsightsPage.summary')}
      >
        {summary.map((item) => (
          <li key={item.key} className="insights-summary-item" data-tone={item.tone}>
            <span className="insights-summary-icon" aria-hidden="true">
              <Icon name={item.icon} size={20} />
            </span>
            <span className="insights-summary-value">{item.value}</span>
            <span className="insights-summary-label">{item.label}</span>
          </li>
        ))}
      </ul>

      <div className="insights-grid">
        <InsightsCard
          id="insights-check"
          tone="amber"
          icon="alert"
          kicker={t('applicantInsights.appApplicantIdInsightsPage.differences')}
          title={t('applicantInsights.appApplicantIdInsightsPage.detailsToCheck')}
          listName="Details"
          count={toCheck.length}
          open={checkOpen}
        >
          {toCheck.length === 0 ? (
            <EmptyState
              icon="check"
              title={t('applicantInsights.appApplicantIdInsightsPage.nothingToCheck')}
            >
              {t.node('applicantInsights.appApplicantIdInsightsPage.noSavedDetailDiffersFromWhat')}
            </EmptyState>
          ) : (
            <>
              <p className="insights-note">
                {t.node('applicantInsights.appApplicantIdInsightsPage.weOnlySayThatTwoDetails')}
              </p>
              <AttentionList items={toCheck.slice(0, CARD_ROWS)} />
              <MoreOnItsPage
                shown={Math.min(CARD_ROWS, toCheck.length)}
                total={toCheck.length}
                noun="details to check"
                pages={checkPages}
              />
            </>
          )}
          {insights.notCompared > 0 ? (
            <p className="insights-note">
              {plural(insights.notCompared, 'protected detail')} could not be compared just now.
              Check {insights.notCompared === 1 ? 'it' : 'them'} on the{' '}
              <Link href={documentsHref}>Documents page</Link>.
            </p>
          ) : null}
        </InsightsCard>

        <InsightsCard
          id="insights-expiry"
          tone="red"
          icon="calendar"
          kicker={t('applicantInsights.appApplicantIdInsightsPage.comingUp')}
          title={t('applicantInsights.appApplicantIdInsightsPage.expiryTimeline')}
          listName="Dates"
          count={insights.expiry.length}
          open={expiringNow}
        >
          {insights.expiry.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={t('applicantInsights.appApplicantIdInsightsPage.noExpiryDatesYet')}
            >
              {t.node('applicantInsights.appApplicantIdInsightsPage.documentsWithAnEndDateSuch')}
            </EmptyState>
          ) : (
            <ol className="insights-list insights-timeline">
              {insights.expiry.slice(0, CARD_ROWS).map((entry) => {
                const badge = EXPIRY_BADGE[entry.urgency];
                return (
                  <li key={entry.document.id} className="insights-row">
                    <span className="insights-row-text">
                      <span className="insights-row-label">{documentName(entry.document)}</span>
                      <span className="insights-row-detail">
                        {timeUntilExpiry(entry.daysRemaining, entry.urgency === 'expired')} ·{' '}
                        {formatTimestampDate(entry.expiresAt)}
                      </span>
                    </span>
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                  </li>
                );
              })}
            </ol>
          )}
          {insights.expiry.length > CARD_ROWS ? (
            <p className="insights-note">
              {t.node('applicantInsights.appApplicantIdInsightsPage.showingCardRowsOfLengthDates', {
                CARD_ROWS,
                length: insights.expiry.length,
              })}
            </p>
          ) : null}
          <Link className="btn btn-secondary insights-action" href={`/app/applicant/${id}/expiry`}>
            {t.node('applicantInsights.appApplicantIdInsightsPage.openDatesExpiry')}
          </Link>
        </InsightsCard>

        <InsightsCard
          id="insights-cases"
          tone="blue"
          icon="briefcase"
          kicker={t('applicantInsights.appApplicantIdInsightsPage.cases')}
          title={t('applicantInsights.appApplicantIdInsightsPage.readinessByCase')}
          listName="Cases"
          count={insights.cases.length}
          open={false}
        >
          {insights.cases.length === 0 ? (
            <EmptyState
              icon="folder"
              title={t('applicantInsights.appApplicantIdInsightsPage.noOpenCases')}
              action={{ href: `/app/applicant/${id}/missions#start-case`, label: 'Start a Case' }}
            >
              {t.node('applicantInsights.appApplicantIdInsightsPage.eachVisaApplicationIsACase')}
            </EmptyState>
          ) : (
            <ul className="insights-list">
              {insights.cases.slice(0, CARD_ROWS).map((entry) => {
                const badge = READINESS_BADGE[entry.state];
                return (
                  <li key={entry.caseId} className="insights-row">
                    <Link
                      className="insights-row-text insights-row-link"
                      href={`/app/mission/${entry.caseId}`}
                    >
                      <span className="insights-row-label">{entry.title}</span>
                      <span className="insights-row-detail">
                        {readinessLine(entry.state, entry.satisfiedRequired, entry.requiredCount)}
                      </span>
                    </Link>
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}
          <MoreOnItsPage
            shown={Math.min(CARD_ROWS, insights.cases.length)}
            total={insights.cases.length}
            noun="cases"
            href={`/app/applicant/${id}/missions`}
            label={t('applicantInsights.appApplicantIdInsightsPage.openCases')}
          />
        </InsightsCard>

        <InsightsCard
          id="insights-originals"
          tone="violet"
          icon="file"
          kicker={t('applicantInsights.appApplicantIdInsightsPage.paperCopies')}
          title={t('applicantInsights.appApplicantIdInsightsPage.originalsToBring')}
          listName="Originals"
          count={
            insights.originals.cases.length > 0
              ? insights.originals.cases.length
              : insights.originals.onFile.length
          }
          open={false}
        >
          <p className="insights-note">
            {t.node(
              'applicantInsights.appApplicantIdInsightsPage.embassiesUsuallyWantTheseHandedIn',
            )}
          </p>
          {insights.originals.cases.length > 0 ? (
            originalCases.map((entry) => (
              <div key={entry.caseId} className="insights-group">
                <h4 className="insights-group-title">{entry.title}</h4>
                {entry.unavailable ? (
                  <p className="insights-note">
                    What this case needs could not be loaded just now.{' '}
                    <Link href={`/app/mission/${entry.caseId}`}>Open the case</Link> to see it.
                  </p>
                ) : (
                  <ul className="insights-list">
                    {entry.items.slice(0, CARD_ROWS).map((item) => {
                      // The case's own verdict, so this list and Readiness by Case always agree.
                      const badge = ORIGINAL_STATE_BADGE[item.state];
                      const needsUpload =
                        item.state === 'CRITICAL_GAP' ||
                        item.state === 'EXPIRING_STALE' ||
                        item.state === 'ATTENTION';
                      return (
                        <li key={item.kind} className="insights-row">
                          <span className="insights-row-text">
                            <span className="insights-row-label">
                              {documentTypeLabel(item.kind)}
                            </span>
                            {item.optional ? (
                              <span className="insights-row-detail">
                                {t.node(
                                  'applicantInsights.appApplicantIdInsightsPage.optionalForThisCase',
                                )}
                              </span>
                            ) : null}
                          </span>
                          <span className="insights-row-end">
                            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                            {needsUpload ? (
                              <Link
                                className="btn btn-secondary insights-action"
                                href={uploadHref(item.kind)}
                              >
                                {t.node('applicantInsights.appApplicantIdInsightsPage.upload')}
                                <span className="sr-only"> {documentTypeLabel(item.kind)}</span>
                              </Link>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {entry.unavailable ? null : (
                  <MoreOnItsPage
                    shown={Math.min(CARD_ROWS, entry.items.length)}
                    total={entry.items.length}
                    noun="documents"
                    href={`/app/mission/${entry.caseId}`}
                    label={t('applicantInsights.appApplicantIdInsightsPage.openTheCase')}
                  />
                )}
              </div>
            ))
          ) : insights.originals.onFile.length > 0 ? (
            <ul className="insights-list">
              {insights.originals.onFile.slice(0, CARD_ROWS).map((ref) => (
                <li key={ref.id} className="insights-row">
                  <span className="insights-row-label">{documentName(ref)}</span>
                  <StatusBadge tone="neutral">
                    {t.node('applicantInsights.appApplicantIdInsightsPage.usuallyOriginal')}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="file"
              title={t('applicantInsights.appApplicantIdInsightsPage.noOriginalsListedYet')}
            >
              {t.node('applicantInsights.appApplicantIdInsightsPage.onceACaseListsItsDocuments')}
            </EmptyState>
          )}
          {insights.originals.cases.length > 0 ? (
            <MoreOnItsPage
              shown={originalCases.length}
              total={insights.originals.cases.length}
              noun="cases"
              href={`/app/applicant/${id}/missions`}
              label={t('applicantInsights.appApplicantIdInsightsPage.openCases')}
            />
          ) : (
            <MoreOnItsPage
              shown={Math.min(CARD_ROWS, insights.originals.onFile.length)}
              total={insights.originals.onFile.length}
              noun="documents"
              href={documentsHref}
              label={t('applicantInsights.appApplicantIdInsightsPage.openDocuments')}
            />
          )}
        </InsightsCard>

        <InsightsCard
          id="insights-coverage"
          tone="teal"
          icon="clipboard"
          kicker={t('applicantInsights.appApplicantIdInsightsPage.profileCoverage')}
          title={t('applicantInsights.appApplicantIdInsightsPage.sectionsBackedByADocument')}
          listName="Sections"
          count={insights.coverage.sections.length}
          open={false}
        >
          {insights.coverage.sections.length === 0 ? (
            <EmptyState
              icon="folder"
              title={t('applicantInsights.appApplicantIdInsightsPage.noSectionsToBackYet')}
            >
              {t.node('applicantInsights.appApplicantIdInsightsPage.openAProfileSectionThatA')}
            </EmptyState>
          ) : (
            <>
              <p className="insights-note">
                {t.node(
                  'applicantInsights.appApplicantIdInsightsPage.coveredOfPluralHaveASupporting',
                  {
                    covered: insights.coverage.covered,
                    plural: plural(insights.coverage.sections.length, 'open section'),
                  },
                )}
              </p>
              {missingSections.length > 0 ? (
                <div className="insights-group">
                  <h4 className="insights-group-title">
                    {t.node('applicantInsights.appApplicantIdInsightsPage.noDocumentYet')}
                  </h4>
                  <ul className="insights-list">
                    {missingSections.slice(0, CARD_ROWS).map((section) => {
                      const first = section.kinds[0];
                      return (
                        <li key={section.key} className="insights-row">
                          <span className="insights-row-text">
                            <span className="insights-row-label">{section.label}</span>
                            <span className="insights-row-detail">
                              Backed by{' '}
                              {section.kinds
                                .slice(0, 3)
                                .map((kind) => documentTypeLabel(kind.kind))
                                .join(', ')}
                              {section.kinds.length > 3
                                ? ` and ${section.kinds.length - 3} more`
                                : ''}
                            </span>
                          </span>
                          {first ? (
                            <Link
                              className="btn btn-secondary insights-action"
                              href={uploadHref(first.kind)}
                            >
                              {t.node('applicantInsights.appApplicantIdInsightsPage.upload')}
                              <span className="sr-only"> {documentTypeLabel(first.kind)}</span>
                            </Link>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {coveredSections.length > 0 ? (
                <div className="insights-group">
                  <h4 className="insights-group-title">
                    {t.node('applicantInsights.appApplicantIdInsightsPage.backed')}
                  </h4>
                  <ul className="insights-list">
                    {coveredSections.slice(0, CARD_ROWS).map((section) => (
                      <li key={section.key} className="insights-row">
                        <span className="insights-row-text">
                          <span className="insights-row-label">{section.label}</span>
                          <span className="insights-row-detail">
                            {section.kinds
                              .filter((kind) => kind.onFile > 0)
                              .map((kind) => documentTypeLabel(kind.kind))
                              .join(', ')}
                          </span>
                        </span>
                        <StatusBadge tone="success">
                          {t.node('applicantInsights.appApplicantIdInsightsPage.backed')}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <MoreOnItsPage
                shown={
                  Math.min(CARD_ROWS, missingSections.length) +
                  Math.min(CARD_ROWS, coveredSections.length)
                }
                total={insights.coverage.sections.length}
                noun="sections"
                href={profileHref}
                label={t('applicantInsights.appApplicantIdInsightsPage.openProfile')}
              />
            </>
          )}
        </InsightsCard>

        <InsightsCard
          id="insights-evidence"
          tone="blue"
          icon="share"
          kicker={t('applicantInsights.appApplicantIdInsightsPage.evidenceMap')}
          title={t('applicantInsights.appApplicantIdInsightsPage.documentsBehindYourDetails')}
          listName="Documents"
          count={insights.evidence.length}
          open={false}
        >
          {insights.evidence.length === 0 ? (
            <EmptyState
              icon="file"
              title={t('applicantInsights.appApplicantIdInsightsPage.noDocumentsYet')}
              action={{ href: `${documentsHref}/add`, label: 'Add a Document' }}
            >
              {t.node('applicantInsights.appApplicantIdInsightsPage.addADocumentAndAcceptWhat')}
            </EmptyState>
          ) : (
            <ul className="insights-list">
              {insights.evidence.slice(0, CARD_ROWS).map((entry) => (
                <li key={entry.document.id} className="insights-row insights-row-stack">
                  <span className="insights-row-label">
                    {documentName(entry.document)}
                    {entry.document.restricted ? (
                      <>
                        {' '}
                        <StatusBadge tone="neutral">
                          {t.node('applicantInsights.appApplicantIdInsightsPage.protected')}
                        </StatusBadge>
                      </>
                    ) : null}
                  </span>
                  <span className="insights-row-detail">
                    {entry.backedCount === 0
                      ? t.node(
                          'applicantInsights.appApplicantIdInsightsPage.backsNoSavedDetailsYet',
                        )
                      : entry.backedFieldKeys.length > 0
                        ? t.node('applicantInsights.appApplicantIdInsightsPage.backsPluralJoin', {
                            plural: plural(entry.backedCount, 'saved detail'),
                            join: entry.backedFieldKeys.map(detailName).join(', '),
                          })
                        : entry.backedSections.length > 0
                          ? t.node(
                              'applicantInsights.appApplicantIdInsightsPage.backsPluralInJoin',
                              {
                                plural: plural(entry.backedCount, 'saved detail'),
                                join: entry.backedSections.map((s) => s.label).join(', '),
                              },
                            )
                          : t.node('applicantInsights.appApplicantIdInsightsPage.backsPlural', {
                              plural: plural(entry.backedCount, 'saved detail'),
                            })}
                  </span>
                  {entry.canBackSections.length > 0 ? (
                    <span className="insights-row-detail">
                      {t.node('applicantInsights.appApplicantIdInsightsPage.canBackJoin', {
                        join: entry.canBackSections.map((s) => s.label).join(', '),
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <MoreOnItsPage
            shown={Math.min(CARD_ROWS, insights.evidence.length)}
            total={insights.evidence.length}
            noun="documents"
            href={documentsHref}
            label={t('applicantInsights.appApplicantIdInsightsPage.openDocuments')}
          />
        </InsightsCard>
      </div>
    </>
  );
}
