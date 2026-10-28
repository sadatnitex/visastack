import { createTranslator } from '@visastack/i18n';
import { getConsents, listApplicants } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../components/ui';
import { getLocale } from '../../../lib/locale';
import { relationshipLabel } from '../../../lib/relationship-labels';
import { withSession } from '../../../lib/session';
import { AddApplicantForm } from '../add-applicant-form';

export const metadata: Metadata = { title: 'All Travellers' };

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
      <PageHeader
        eyebrow="Travellers"
        title="People on Your Account"
        description="Yourself and anyone you manage records for - family members or a minor under your guardianship."
      />

      <div className="grid">
        <article className="card">
          <p className="card-kicker">All Travellers</p>
          <h2 className="card-title">
            {data.applicants.length} {data.applicants.length === 1 ? 'person' : 'people'}
          </h2>
          {data.applicants.length === 0 ? (
            <EmptyState icon="users" title="No Travellers Yet">
              Add yourself first. Your passport details and documents are entered once and reused
              for every application.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {data.applicants.map((a) => (
                <Link className="row row-link" key={a.id} href={`/app/applicant/${a.id}`}>
                  <span className="row-key">{a.displayName}</span>
                  <span className="row-end">
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
          <h2 className="card-title">Add a Traveller</h2>
          {data.coreGranted ? (
            <AddApplicantForm selfAdded={data.applicants.some((a) => a.relationship === 'SELF')} />
          ) : (
            <p className="card-body">
              Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
              <Link href="/app">Home</Link> to start adding applicant records.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
