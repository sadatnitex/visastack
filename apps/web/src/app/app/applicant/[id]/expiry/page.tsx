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
import { notFound } from 'next/navigation';
import { withSession } from '../../../../../lib/session';

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
  unknown: { label: 'Unknown', tone: 'badge-neutral' },
  ok: { label: 'OK', tone: 'badge-success' },
  reminder: { label: 'Expiring soon', tone: 'badge-warning' },
  expired: { label: 'Expired', tone: 'badge-danger' },
};

const STALENESS_BADGE: Record<StalenessStatus, { label: string; tone: string }> = {
  not_applicable: { label: 'No freshness rule', tone: 'badge-neutral' },
  unknown: { label: 'Freshness unknown', tone: 'badge-neutral' },
  fresh: { label: 'Fresh', tone: 'badge-success' },
  stale: { label: 'Too old for this route', tone: 'badge-danger' },
};

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

    return { intrinsic, verifications, freshnessRows };
  });

  if (!data) notFound();

  return (
    <>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Expiry Centre</span>
          <h2 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Expiry &amp; freshness
          </h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Three separate signals - a document's own expiry, whether a route needs it more recently
            dated, and how long an issuer confirmation stays valid. Never merged into one status.
          </p>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Intrinsic expiry</p>
          <h2 className="card-title">Documents</h2>
          {data.intrinsic.length === 0 ? (
            <p className="card-body">No documents yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.intrinsic.map(({ doc, thresholds }) => {
                const classification = classifyExpiry(
                  doc.expiresAt ? new Date(doc.expiresAt) : null,
                  now,
                  thresholds,
                );
                const badge = URGENCY_BADGE[classification.urgency];
                return (
                  <div className="row" key={doc.id}>
                    <span className="row-key">{doc.approvedName ?? doc.originalName}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {classification.daysRemaining !== null ? (
                        <span className="muted" style={{ fontSize: '0.75rem' }}>
                          {classification.daysRemaining >= 0
                            ? `${classification.daysRemaining}d left`
                            : `${Math.abs(classification.daysRemaining)}d ago`}
                        </span>
                      ) : null}
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Case-specific freshness</p>
          <h2 className="card-title">Route rules</h2>
          <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>
            Some requirements demand evidence dated within a set window, separate from the
            document's own expiry.
          </p>
          {data.freshnessRows.length === 0 ? (
            <p className="card-body">No active freshness rules apply to your cases yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.freshnessRows.map(({ mission, requirementKey, document }) => {
                const badge = STALENESS_BADGE[document.staleness.status];
                return (
                  <div
                    className="row"
                    key={`${mission.id}-${requirementKey}-${document.documentId}`}
                  >
                    <span className="row-key">
                      {requirementKey}
                      <span className="muted" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                        {mission.title}
                      </span>
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Verification expiry</p>
          <h2 className="card-title">Issuer confirmations</h2>
          {data.verifications.length === 0 ? (
            <p className="card-body">No issuer confirmations yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.verifications.map(({ doc, verification }) => {
                const classification = classifyExpiry(verification.validUntil, now);
                const badge = URGENCY_BADGE[classification.urgency];
                return (
                  <div className="row" key={verification.id}>
                    <span className="row-key">
                      {verification.issuerIdentity}
                      <span className="muted" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>
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
