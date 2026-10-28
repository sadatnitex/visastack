import { accountPrincipal, getTravellerInsights, requireAccess } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  type AttentionEntry,
  AttentionList,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
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

export const dynamic = 'force-dynamic';

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
      eyebrow="Document Insights"
      title="What Your Documents Show"
      description="A summary of your saved documents and profile. It never shows the details themselves, and nothing here changes your profile."
      back={{ href: documentsHref, label: 'Documents' }}
    />
  );
  if (!loaded.ok) {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          We could not put this summary together just now. Refresh to try again. Nothing is reported
          as missing while it cannot load.
        </p>
      </>
    );
  }
  const insights = loaded.value;
  const documentHref = (documentId: string) =>
    `${documentsHref}?document=${encodeURIComponent(documentId)}`;
  const uploadHref = (kind: string) =>
    `${documentsHref}?type=${encodeURIComponent(kind)}#document-upload`;

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
            href: `/app/applicant/${id}/profile`,
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

  const summary = [
    { key: 'documents', label: 'Documents', value: insights.summary.documents },
    { key: 'check', label: 'Details to Check', value: insights.summary.toCheck },
    {
      key: 'expiry',
      label: 'Expired or Expiring Soon',
      value: insights.summary.expired + insights.summary.expiringSoon,
    },
    {
      key: 'coverage',
      label: 'Sections Without a Document',
      value: insights.summary.sectionsWithoutDocument,
    },
  ];
  const missingSections = insights.coverage.sections.filter((section) => !section.covered);
  const coveredSections = insights.coverage.sections.filter((section) => section.covered);

  return (
    <>
      {header}

      <ul className="insights-summary" aria-label="Summary">
        {summary.map((item) => (
          <li key={item.key} className="insights-summary-item">
            <span className="insights-summary-value">{item.value}</span>
            <span className="insights-summary-label">{item.label}</span>
          </li>
        ))}
      </ul>

      <div className="insights-grid">
        <section className="card insights-card" aria-labelledby="insights-check">
          <p className="card-kicker">Differences</p>
          <h3 className="card-title" id="insights-check">
            Details to Check
          </h3>
          {toCheck.length === 0 ? (
            <EmptyState icon="check" title="Nothing to Check">
              No saved detail differs from what was read in your documents.
            </EmptyState>
          ) : (
            <>
              <p className="insights-note">
                We only say that two details differ and where. Open each one to see both and decide.
              </p>
              <AttentionList items={toCheck} />
            </>
          )}
          {insights.notCompared > 0 ? (
            <p className="insights-note">
              {plural(insights.notCompared, 'protected detail')} could not be compared just now.
              Check {insights.notCompared === 1 ? 'it' : 'them'} on the{' '}
              <Link href={documentsHref}>Documents page</Link>.
            </p>
          ) : null}
        </section>

        <section className="card insights-card" aria-labelledby="insights-expiry">
          <p className="card-kicker">Coming Up</p>
          <h3 className="card-title" id="insights-expiry">
            Expiry Timeline
          </h3>
          {insights.expiry.length === 0 ? (
            <EmptyState icon="calendar" title="No Expiry Dates Yet">
              Documents with an end date, such as a passport, appear here in the order they run out.
            </EmptyState>
          ) : (
            <ol className="insights-list insights-timeline">
              {insights.expiry.map((entry) => {
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
          <Link className="btn btn-secondary insights-action" href={`/app/applicant/${id}/expiry`}>
            Open Dates &amp; Expiry
          </Link>
        </section>

        <section className="card insights-card" aria-labelledby="insights-cases">
          <p className="card-kicker">Cases</p>
          <h3 className="card-title" id="insights-cases">
            Readiness by Case
          </h3>
          {insights.cases.length === 0 ? (
            <EmptyState
              icon="folder"
              title="No Open Cases"
              action={{ href: `/app/applicant/${id}/missions`, label: 'Start a Case' }}
            >
              Each visa application is a case. Its readiness appears here once you start one.
            </EmptyState>
          ) : (
            <ul className="insights-list">
              {insights.cases.map((entry) => {
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
        </section>

        <section className="card insights-card" aria-labelledby="insights-originals">
          <p className="card-kicker">Paper Copies</p>
          <h3 className="card-title" id="insights-originals">
            Originals to Bring
          </h3>
          <p className="insights-note">
            Embassies usually want these handed in as the original paper. The scan on file keeps
            your application ready; keep the original safe.
          </p>
          {insights.originals.cases.length > 0 ? (
            insights.originals.cases.map((entry) => (
              <div key={entry.caseId} className="insights-group">
                <h4 className="insights-group-title">{entry.title}</h4>
                {entry.unavailable ? (
                  <p className="insights-note">
                    What this case needs could not be loaded just now.{' '}
                    <Link href={`/app/mission/${entry.caseId}`}>Open the case</Link> to see it.
                  </p>
                ) : (
                  <ul className="insights-list">
                    {entry.items.map((item) => {
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
                              <span className="insights-row-detail">Optional for this case</span>
                            ) : null}
                          </span>
                          <span className="insights-row-end">
                            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                            {needsUpload ? (
                              <Link
                                className="btn btn-secondary insights-action"
                                href={uploadHref(item.kind)}
                              >
                                Upload
                                <span className="sr-only"> {documentTypeLabel(item.kind)}</span>
                              </Link>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))
          ) : insights.originals.onFile.length > 0 ? (
            <ul className="insights-list">
              {insights.originals.onFile.map((ref) => (
                <li key={ref.id} className="insights-row">
                  <span className="insights-row-label">{documentName(ref)}</span>
                  <StatusBadge tone="neutral">Usually Original</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="file" title="No Originals Listed Yet">
              Once a case lists its documents, or you add one usually handed in as the original, it
              appears here.
            </EmptyState>
          )}
        </section>

        <section className="card insights-card" aria-labelledby="insights-coverage">
          <p className="card-kicker">Profile Coverage</p>
          <h3 className="card-title" id="insights-coverage">
            Sections Backed by a Document
          </h3>
          {insights.coverage.sections.length === 0 ? (
            <EmptyState icon="folder" title="No Sections to Back Yet">
              Open a profile section that a document can back, and it appears here.
            </EmptyState>
          ) : (
            <>
              <p className="insights-note">
                {insights.coverage.covered} of{' '}
                {plural(insights.coverage.sections.length, 'open section')}{' '}
                {insights.coverage.covered === 1 ? 'has' : 'have'} a supporting document.
              </p>
              {missingSections.length > 0 ? (
                <div className="insights-group">
                  <h4 className="insights-group-title">No Document Yet</h4>
                  <ul className="insights-list">
                    {missingSections.map((section) => {
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
                              Upload
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
                  <h4 className="insights-group-title">Backed</h4>
                  <ul className="insights-list">
                    {coveredSections.map((section) => (
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
                        <StatusBadge tone="success">Backed</StatusBadge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="card insights-card" aria-labelledby="insights-evidence">
          <p className="card-kicker">Evidence Map</p>
          <h3 className="card-title" id="insights-evidence">
            Documents Behind Your Details
          </h3>
          {insights.evidence.length === 0 ? (
            <EmptyState
              icon="file"
              title="No Documents Yet"
              action={{ href: `${documentsHref}#document-upload`, label: 'Add a Document' }}
            >
              Add a document and accept what was found in it, and this shows which details it backs.
            </EmptyState>
          ) : (
            <ul className="insights-list">
              {insights.evidence.map((entry) => (
                <li key={entry.document.id} className="insights-row insights-row-stack">
                  <span className="insights-row-label">
                    {documentName(entry.document)}
                    {entry.document.restricted ? (
                      <>
                        {' '}
                        <StatusBadge tone="neutral">Protected</StatusBadge>
                      </>
                    ) : null}
                  </span>
                  <span className="insights-row-detail">
                    {entry.backedCount === 0
                      ? 'Backs no saved details yet.'
                      : entry.backedFieldKeys.length > 0
                        ? `Backs ${plural(entry.backedCount, 'saved detail')}: ${entry.backedFieldKeys.map(detailName).join(', ')}.`
                        : entry.backedSections.length > 0
                          ? `Backs ${plural(entry.backedCount, 'saved detail')} in ${entry.backedSections.map((s) => s.label).join(', ')}.`
                          : `Backs ${plural(entry.backedCount, 'saved detail')}.`}
                  </span>
                  {entry.canBackSections.length > 0 ? (
                    <span className="insights-row-detail">
                      Can back: {entry.canBackSections.map((s) => s.label).join(', ')}.
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
