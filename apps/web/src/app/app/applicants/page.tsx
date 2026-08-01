import { createTranslator } from '@visastack/i18n';
import { getConsents, listApplicants } from '@visastack/services';
import Link from 'next/link';
import { getLocale } from '../../../lib/locale';
import { relationshipLabel } from '../../../lib/relationship-labels';
import { withSession } from '../../../lib/session';
import { AddApplicantForm } from '../add-applicant-form';

export const dynamic = 'force-dynamic';

export default async function ApplicantsPage() {
  const t = createTranslator(await getLocale());
  const data = await withSession(async ({ db, accountId }) => {
    const [applicants, consents] = await Promise.all([
      listApplicants(db, accountId),
      getConsents(db, accountId),
    ]);
    return { applicants, coreGranted: Boolean(consents.CORE_PROCESSING) };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Applicants</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            People on your account
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Yourself and anyone you manage records for — family members or a minor under your
            guardianship.
          </p>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">All applicants</p>
          <h2 className="card-title">{data.applicants.length} record(s)</h2>
          {data.applicants.length === 0 ? (
            <p className="card-body">No applicant records yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.applicants.map((a) => (
                <Link className="row row-link" key={a.id} href={`/app/applicant/${a.id}`}>
                  <span className="row-key">{a.displayName}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="badge badge-neutral">
                      {relationshipLabel(a.relationship, t)}
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">New</p>
          <h2 className="card-title">Add an applicant</h2>
          {data.coreGranted ? (
            <AddApplicantForm />
          ) : (
            <p className="card-body">
              Grant <strong>Core processing</strong> consent from <Link href="/app">Home</Link> to
              start adding applicant records.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
