import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { getConsents, listApplicants } from '@visastack/services';
import { signOut } from '@workos-inc/authkit-nextjs';
import Link from 'next/link';
import { withSession } from '../../lib/session';
import { createApplicantAction, setConsentAction } from './actions';

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
  const data = await withSession(async ({ db, accountId, email }) => ({
    email,
    consents: await getConsents(db, accountId),
    applicants: await listApplicants(db, accountId),
  }));
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
                <form action={setConsentAction}>
                  <input type="hidden" name="type" value={type} />
                  <input type="hidden" name="granted" value={String(!data.consents[type])} />
                  <button
                    type="submit"
                    className={`btn ${data.consents[type] ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ padding: '0.35rem 1rem', fontSize: '0.85rem' }}
                  >
                    {data.consents[type] ? 'Revoke' : 'Grant'}
                  </button>
                </form>
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
            <form
              action={createApplicantAction}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                marginTop: '1rem',
              }}
            >
              <input
                name="displayName"
                placeholder="Full name"
                required
                style={{
                  padding: '0.6rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid var(--hairline)',
                  background: 'var(--bg-subtle)',
                  color: 'var(--text)',
                  fontSize: '0.95rem',
                }}
              />
              <select
                name="relationship"
                defaultValue="SELF"
                style={{
                  padding: '0.6rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid var(--hairline)',
                  background: 'var(--bg-subtle)',
                  color: 'var(--text)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="SELF">Myself</option>
                <option value="FAMILY_MEMBER">Family member</option>
                <option value="MINOR_GUARDIAN">Minor (guardian)</option>
              </select>
              <button type="submit" className="btn btn-primary">
                Add applicant
              </button>
            </form>
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
