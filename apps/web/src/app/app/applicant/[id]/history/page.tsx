import {
  type MissionUsingField,
  getApplicant,
  listApplicantProfile,
  listFactHistory,
  listMissionsUsingField,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { fieldLabel } from '../../../../../lib/master-profile';
import { withSession } from '../../../../../lib/session';

export const metadata: Metadata = { title: 'History' };

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  DECLARED: 'Declared',
  EXTRACTED_PENDING: 'Extracted (Pending)',
  APPLICANT_CONFIRMED: 'Confirmed',
  DOCUMENT_SUPPORTED: 'Document-supported',
  AGENCY_REVIEWED: 'Agency-reviewed',
  CONFLICTED: 'Conflicted',
  STALE: 'Stale',
  SUPERSEDED: 'Superseded',
};

const METHOD_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  DOCUMENT: 'From Document',
  API: 'API',
  SYSTEM: 'System',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function HistoryPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const entries = await listApplicantProfile(db, id);

    const uniqueFieldKeys = [...new Set(entries.map((e) => e.fieldKey))];
    const missionUseByFieldKey = new Map<string, MissionUsingField[]>();
    await Promise.all(
      uniqueFieldKeys.map(async (fieldKey) => {
        const result = await listMissionsUsingField(db, accountId, id, fieldKey);
        missionUseByFieldKey.set(fieldKey, result.ok ? result.value : []);
      }),
    );

    const withHistory = await Promise.all(
      entries.map(async (entry) => ({
        fieldKey: entry.fieldKey,
        repeatingRecordKey: entry.repeatingRecordKey,
        missionUse: missionUseByFieldKey.get(entry.fieldKey) ?? [],
        versions: (await listFactHistory(db, entry.factId)).map((v) => ({
          id: v.id,
          value: v.value,
          // A protected detail is stored locked, so its text is not on this page.
          isProtected: v.protectedKeyVersion !== null,
          status: v.status,
          method: v.method,
          reason: v.reason,
          createdAt: v.createdAt.toISOString(),
        })),
      })),
    );
    return { applicant, facts: withHistory };
  });

  if (!data) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Provenance"
        title="Fact History"
        description="Every value is an immutable version - nothing is ever overwritten. This is the full, ordered trail with its provenance."
        as="h2"
      />

      {data.facts.length === 0 ? (
        <article className="card">
          <EmptyState
            icon="activity"
            title="Nothing Saved to This Profile Yet"
            action={{ href: `/app/applicant/${id}/profile`, label: 'Add Your Essentials' }}
          >
            History lists every saved version of a profile detail, with when and how it was saved.
            Nothing has been saved to this profile yet, so there is nothing to list. Add a detail on
            the profile, or upload a document and approve the details it suggests. Each save then
            appears here.
          </EmptyState>
        </article>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {data.facts.map((fact) => (
            <article
              className="card"
              key={`${fact.fieldKey}-${fact.repeatingRecordKey ?? 'single'}`}
            >
              <h2 className="card-title u-mb-100">
                {fieldLabel(fact.fieldKey) ?? fact.fieldKey}
                {fact.repeatingRecordKey ? (
                  <span
                    className="muted"
                    style={{
                      fontSize: 'var(--text-caption)',
                      fontWeight: 400,
                      marginLeft: '0.5rem',
                    }}
                  >
                    (record {fact.repeatingRecordKey.slice(0, 8)})
                  </span>
                ) : null}
              </h2>
              {fact.missionUse.length > 0 ? (
                <p
                  className="muted"
                  style={{ fontSize: 'var(--text-small)', marginBottom: '0.75rem' }}
                >
                  Used by:{' '}
                  {fact.missionUse.map((m, i) => (
                    <span key={m.missionId}>
                      {i > 0 ? ', ' : ''}
                      <Link href={`/app/mission/${m.missionId}`}>{m.title}</Link>
                    </span>
                  ))}
                </p>
              ) : null}
              <div className="rows">
                {fact.versions.map((v, i) => (
                  <div
                    className="row"
                    key={v.id}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <span className="row-key" style={{ fontFamily: 'var(--font-mono)' }}>
                        {v.value ??
                          (v.isProtected ? 'Protected Detail (Hidden Here)' : 'No Value Recorded')}
                      </span>
                      <span
                        className={`badge ${i === fact.versions.length - 1 ? 'badge-success' : 'badge-neutral'}`}
                      >
                        {i === fact.versions.length - 1 ? 'Current' : 'Superseded'}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: 'var(--text-caption)' }}>
                      {STATUS_LABELS[v.status] ?? v.status} · {METHOD_LABELS[v.method] ?? v.method}{' '}
                      · {formatDateTime(v.createdAt)}
                      {v.reason ? ` · ${v.reason}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
