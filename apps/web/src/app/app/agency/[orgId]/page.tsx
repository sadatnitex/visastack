import { getOrganization, isOrgAdmin, listEvidenceRequestsForOrg } from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withSession } from '../../../../lib/session';
import { RequestEvidenceForm } from './request-evidence-form';

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

export default async function OrgConsolePage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const org = await getOrganization(db, orgId);
    if (!org) return null;
    const admin = await isOrgAdmin(db, accountId, orgId);
    if (!admin) return { org, admin: false, requests: [] };
    const requests = await listEvidenceRequestsForOrg(db, accountId, orgId);
    return { org, admin: true, requests: requests.ok ? requests.value : [] };
  });

  if (!data) notFound();

  const badge = ORG_STATUS[data.org.status] ?? { label: data.org.status, tone: 'badge-neutral' };

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/agency" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Organizations
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Organization</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.org.name}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Collaboration console
          </p>
        </div>
        <span className={`badge ${badge.tone}`}>{badge.label}</span>
      </div>

      {!data.admin ? (
        <article className="card">
          <p className="card-body">
            You are a member of this organization but not an administrator. Only owners and admins
            can request evidence or export data.
          </p>
        </article>
      ) : (
        <>
          <div className="grid">
            <article className="card">
              <p className="card-kicker">Collect</p>
              <h2 className="card-title">Request evidence</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Ask an applicant for a specific field or document. They decide whether to fulfil it.
              </p>
              <RequestEvidenceForm organizationId={orgId} />
            </article>

            <article className="card">
              <p className="card-kicker">Export</p>
              <h2 className="card-title">Bulk export</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Download the profiles of every applicant who granted this organization an accepted
                export grant. Each applicant is re-checked by the policy engine at export time.
              </p>
              <a
                href={`/app/agency/${orgId}/export?purpose=agency_review`}
                className="btn btn-primary"
                download
              >
                Download bulk export
              </a>
            </article>
          </div>

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Activity</p>
            <h2 className="card-title">Evidence requests</h2>
            {data.requests.length === 0 ? (
              <p className="card-body">No evidence requests raised yet.</p>
            ) : (
              <div className="rows" style={{ marginTop: '0.5rem' }}>
                {data.requests.map((req) => {
                  const rb = REQ_STATUS[req.status] ?? { label: req.status, tone: 'badge-neutral' };
                  const target = req.kind === 'FIELD' ? req.fieldKey : req.docType;
                  return (
                    <div className="row" key={req.id}>
                      <span className="row-key">
                        {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target ?? '(unspecified)'}
                      </span>
                      <span className={`badge ${rb.tone}`}>{rb.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
