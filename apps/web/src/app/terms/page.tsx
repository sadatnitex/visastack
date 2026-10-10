import { SIGNUP_TERMS_VERSION } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Terms of use' };

export default function TermsPage() {
  return (
    <section className="section container" style={{ maxWidth: '48rem' }}>
      <h1 className="page-title">Terms of use</h1>
      <p className="card-body">
        Version {SIGNUP_TERMS_VERSION}. These beta terms await legal review.
      </p>
      <h2>Current test pilot</h2>
      <p>
        Use made-up applicant details and test documents only. Creating an account does not grant
        access to an invited workspace or enable real-document intake.
      </p>
      <h2>Your information and access</h2>
      <p>
        Only provide information and files you are authorized to use. Keep your sign-in details
        private. You control whom you share your records with; creating an account gives no agency
        automatic access. Do not try to access another person's records or misuse the service.
      </p>
      <h2>Free access and availability</h2>
      <p>
        Account creation is free. Available features depend on your role, permissions, safety checks
        and capacity limits. Access may be restricted to prevent abuse or protect records. Features
        and availability may change while the beta is being completed.
      </p>
      <h2>Visa decisions</h2>
      <p>
        VisaStack helps organize records and workflows. It does not guarantee a visa, certify a
        document's authenticity or replace advice from an appropriate professional. A readiness
        status describes the recorded workflow, not the likelihood of approval.
      </p>
      <p>
        <Link href="/privacy">Read the privacy notice</Link> or{' '}
        <Link href="/auth/sign-up">return to account creation</Link>.
      </p>
    </section>
  );
}
