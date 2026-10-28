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
import { EmptyState, PageHeader, StatusBadge, type Tone } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { plural } from '../../../../../lib/plural';
import { withSession } from '../../../../../lib/session';
import {
  CLOCK_EXPIRY_PAGE_LIMIT,
  deadlineLines,
  loadDeadlineEntries,
} from '../../../deadline-clock-data';

export const metadata: Metadata = { title: 'Expiry' };

export const dynamic = 'force-dynamic';

/**
 * The Expiry Centre (NTF-01, Part 5 §1): tracks intrinsic expiry,
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
 * Why a document shows no expiry date, and what to do. Today an expiry date is only ever filled in
 * from a passport's machine-readable lines (intake), so the wording never suggests a date can be
 * typed in, and never guesses one.
 */
function missingExpiryNote(docType: string | null): string {
  if (docType === 'PASSPORT') {
    return 'No expiry date has been read from this passport yet. It is read from the two lines of letters and numbers at the bottom of the photo page. If they were not clear, open it on Documents to check it again, or upload a sharper scan.';
  }
  // Nothing is saved about what a document is until the person accepts its kind, so an
  // unconfirmed passport has no type yet: say what to do first rather than guess.
  if (docType === null) {
    return 'No expiry date is on file. Confirm what kind of document this is on Documents. For a passport, the date is then read from the two lines at the bottom of the photo page.';
  }
  return 'No expiry date is on file. For now, expiry dates are read only from passports, so check the date printed on this document yourself.';
}

export default async function ExpiryCentrePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    // Started now so it runs beside the reads below; it never throws (a failed read is null).
    const deadlinesRead = loadDeadlineEntries(db, accountId, id, now, CLOCK_EXPIRY_PAGE_LIMIT);

    const documents = await listDocumentsDetailed(db, accountId, id);
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

  return (
    <>
      <PageHeader
        eyebrow="Expiry Centre"
        title={<>Expiry &amp; Freshness</>}
        description="Three separate signals - a document's own expiry, whether a route needs it more recently dated, and how long an issuer confirmation stays valid. Never merged into one status."
        as="h2"
        actions={
          <Link href={`/app/applicant/${id}/calendar`} className="btn btn-secondary">
            Add Dates to My Calendar
          </Link>
        }
      />

      <div className="u-mb-150">
        <DeadlineClock
          heading="Deadline Clock"
          headingId="expiry-deadline-clock-heading"
          lines={
            data.deadlines === null ? null : deadlineLines(data.deadlines, { showPerson: false })
          }
          addAction={{ href: `/app/applicant/${id}/documents`, label: 'Add a Document' }}
        />
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Intrinsic Expiry</p>
          <h2 className="card-title">Documents</h2>
          {data.intrinsic.length === 0 ? (
            <EmptyState
              icon="file"
              title="No Documents Yet"
              action={{ href: `/app/applicant/${id}/documents`, label: 'Add a Document' }}
            >
              Documents with an expiry date, such as a passport, appear here so you hear about them
              before they run out.
            </EmptyState>
          ) : (
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
                .map(({ doc, classification }) => {
                  const badge = URGENCY_BADGE[classification.urgency];
                  return (
                    <div className="row" key={doc.id}>
                      <span className="attention-text">
                        <span className="row-key">{doc.approvedName ?? doc.originalName}</span>
                        {classification.daysRemaining !== null && doc.expiresAt ? (
                          <span className="attention-detail">
                            {classification.daysRemaining >= 0
                              ? `Expires in ${plural(classification.daysRemaining, 'day')}`
                              : `Expired ${plural(Math.abs(classification.daysRemaining), 'day')} ago`}
                            {' · '}
                            {formatTimestampDate(doc.expiresAt)}
                          </span>
                        ) : classification.urgency === 'unknown' ? (
                          <span className="attention-detail">{missingExpiryNote(doc.docType)}</span>
                        ) : null}
                      </span>
                      <StatusBadge tone={badge.tone.replace('badge-', '') as Tone}>
                        {badge.label}
                      </StatusBadge>
                    </div>
                  );
                })}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Case-Specific Freshness</p>
          <h2 className="card-title">Route Rules</h2>
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '0.75rem' }}>
            Some requirements demand evidence dated within a set window, separate from the
            document's own expiry.
          </p>
          {data.freshnessRows.length === 0 ? (
            <EmptyState icon="calendar" title="No Date Rules Yet">
              Some visa routes need a document dated within a set window, such as a bank statement
              from the last 30 days. They appear here once a case uses such a route.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {data.freshnessRows.map(({ mission, requirementKey, document }) => {
                const badge = STALENESS_BADGE[document.staleness.status];
                return (
                  <div
                    className="row"
                    key={`${mission.id}-${requirementKey}-${document.documentId}`}
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
                          This route needs a recently dated document, and no date has been entered
                          for this one, so it cannot be checked. Enter the date printed on it under
                          Document Date on{' '}
                          <Link href={`/app/applicant/${id}/documents`}>Documents</Link>.
                        </span>
                      ) : null}
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Verification Expiry</p>
          <h2 className="card-title">Issuer Confirmations</h2>
          {data.verifications.length === 0 ? (
            <EmptyState icon="check" title="No Confirmations Yet">
              When an issuer, such as a bank or employer, confirms a document, the confirmation and
              how long it stays valid appear here.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {data.verifications.map(({ doc, verification }) => {
                const classification = classifyExpiry(verification.validUntil, now);
                const badge = URGENCY_BADGE[classification.urgency];
                return (
                  <div className="row" key={verification.id}>
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
          )}
        </article>
      </div>
    </>
  );
}
