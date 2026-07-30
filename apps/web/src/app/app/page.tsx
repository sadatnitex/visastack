import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import {
  getAccountEvidenceBytes,
  getConsents,
  listApplicants,
  listDocuments,
  listGrantsForRecipientAccount,
  loadUploadQuotaConfig,
} from '@visastack/services';
import { signOut } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import { isPlatformAdmin } from '../../lib/admin';
import { withSession } from '../../lib/session';
import { AddApplicantForm } from './add-applicant-form';
import { UsageMeter } from './applicant/[id]/usage-meter';
import { ConsentButton } from './consent-button';

export const dynamic = 'force-dynamic';

const CONSENT_LABELS: Record<ConsentType, string> = {
  CORE_PROCESSING: 'Core processing',
  AI_EXTRACTION: 'AI extraction',
  SHARING: 'Sharing',
  MARKETING: 'Marketing',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  SELF: 'Myself',
  FAMILY_MEMBER: 'Family member',
  MINOR_GUARDIAN: 'Minor (guardian)',
};

export default async function AppPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    const applicants = await listApplicants(db, accountId);
    const [consents, evidenceBytes, incomingGrants, documentCounts] = await Promise.all([
      getConsents(db, accountId),
      getAccountEvidenceBytes(db, accountId),
      listGrantsForRecipientAccount(db, accountId),
      Promise.all(
        applicants.map(async (a) => {
          const docs = await listDocuments(db, accountId, a.id);
          return docs.ok ? docs.value.length : 0;
        }),
      ),
    ]);
    return {
      email,
      isAdmin: isPlatformAdmin(email),
      consents,
      applicants,
      quota: loadUploadQuotaConfig(),
      evidenceBytes,
      pendingGrants: incomingGrants.filter((g) => g.grant.status === 'PENDING_ACCEPTANCE').length,
      documentCount: documentCounts.reduce((sum, n) => sum + n, 0),
    };
  });
  const coreGranted = data.consents.CORE_PROCESSING;

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Signed in</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Your workspace
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {data.email}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <Link href="/app/shared" className="btn btn-secondary">
            Shared with you
          </Link>
          <Link href="/app/agency" className="btn btn-secondary">
            Agency
          </Link>
          {data.isAdmin ? (
            <Link href="/app/admin" className="btn btn-secondary">
              Admin
            </Link>
          ) : null}
          <Link href="/app/privacy" className="btn btn-secondary">
            Privacy
          </Link>
          <form
            action={async () => {
              'use server';
              await signOut();
            }}
          >
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Overview</p>
        <h2 className="card-title">At a glance</h2>
        <div className="grid" style={{ marginBottom: '1.25rem' }}>
          <div className="row">
            <span className="row-key">Applicants</span>
            <span className="row-val">{data.applicants.length}</span>
          </div>
          <div className="row">
            <span className="row-key">Documents uploaded</span>
            <span className="row-val">{data.documentCount}</span>
          </div>
          <div className="row">
            <span className="row-key">Grants awaiting your acceptance</span>
            {data.pendingGrants > 0 ? (
              <Link href="/app/shared" className="badge badge-warning">
                {data.pendingGrants} pending
              </Link>
            ) : (
              <span className="badge badge-neutral">None</span>
            )}
          </div>
        </div>
        <UsageMeter
          label="Evidence storage (all applicants)"
          usedBytes={data.evidenceBytes}
          limitBytes={data.quota.maxAccountEvidenceBytes}
        />
      </article>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Consent</p>
          <h2 className="card-title">Permissions you control</h2>
          <p className="card-body" style={{ marginBottom: '1rem' }}>
            Each purpose is granted and revoked independently. Core processing is required before
            any records can be created.
          </p>
          <div className="rows">
            {CONSENT_TYPES.map((type) => (
              <div className="row" key={type}>
                <span className="row-key">{CONSENT_LABELS[type]}</span>
                <ConsentButton type={type} granted={Boolean(data.consents[type])} />
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <p className="card-kicker">Applicants</p>
          <h2 className="card-title">People on your account</h2>
          {data.applicants.length === 0 ? (
            <p className="card-body">No applicant records yet.</p>
          ) : (
            <div className="rows" style={{ marginBottom: '1rem' }}>
              {data.applicants.map((a) => (
                <Link className="row row-link" key={a.id} href={`/app/applicant/${a.id}`}>
                  <span className="row-key">{a.displayName}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="badge badge-neutral">
                      {RELATIONSHIP_LABELS[a.relationship] ?? a.relationship}
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          {coreGranted ? (
            <AddApplicantForm />
          ) : (
            <p className="card-body" style={{ marginTop: '1rem' }}>
              Grant <strong>Core processing</strong> consent to start adding applicant records.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
