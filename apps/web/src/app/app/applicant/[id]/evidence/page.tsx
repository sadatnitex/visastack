import { getApplicant, listEvidenceRequestsForApplicant } from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withSession } from '../../../../../lib/session';
import { RespondButtons } from './respond-buttons';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

export default async function EvidencePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const requests = await listEvidenceRequestsForApplicant(db, accountId, id);
    return { applicant, requests: requests.ok ? requests.value : [] };
  });

  if (!data) notFound();

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href={`/app/applicant/${id}`} className="muted" style={{ fontSize: '0.9rem' }}>
          ← {data.applicant.displayName}
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Evidence requests</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Requests from agencies
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Organizations can ask you for a specific field or document. You decide whether to fulfil
            or decline each request.
          </p>
        </div>
      </div>

      <article className="card">
        {data.requests.length === 0 ? (
          <p className="card-body">
            No evidence requests. When an agency asks for something, it appears here.
          </p>
        ) : (
          <div className="rows">
            {data.requests.map((req) => {
              const badge = STATUS_BADGE[req.status] ?? {
                label: req.status,
                tone: 'badge-neutral',
              };
              const target = req.kind === 'FIELD' ? req.fieldKey : req.docType;
              return (
                <div
                  className="row"
                  key={req.id}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
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
                      {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target ?? '(unspecified)'}
                    </span>
                    <span className={`badge ${badge.tone}`}>{badge.label}</span>
                  </div>
                  {req.message ? (
                    <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                      “{req.message}”
                    </p>
                  ) : null}
                  {req.status === 'OPEN' ? (
                    <RespondButtons applicantId={id} requestId={req.id} />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
