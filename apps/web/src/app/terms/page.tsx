import { SIGNUP_TERMS_VERSION } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Terms of Use' };

export default function TermsPage() {
  return (
    <section className="section container" style={{ maxWidth: '48rem' }}>
      <h1 className="page-title">Terms of Use</h1>
      <p className="card-body">
        Version {SIGNUP_TERMS_VERSION}. These beta terms await legal review.
      </p>
      <h2>Free public beta, at your own risk</h2>
      <p>
        VisaStack is a free public beta, provided as it is. You may use your own details and
        documents, at your own risk: some protections, such as virus scanning of uploads, are not
        switched on yet, and the status page lists what works today. Creating an account does not
        grant access to an agency workspace.
      </p>
      <h2>Your Information and Access</h2>
      <p>
        Only provide information and files you are authorized to use. Keep your sign-in details
        private. You control whom you share your records with; creating an account gives no agency
        automatic access. Do not try to access another person's records or misuse the service.
      </p>
      <h2>Free Access and Availability</h2>
      <p>
        Account creation is free. Available features depend on your role, permissions, safety checks
        and capacity limits. Access may be restricted to prevent abuse or protect records. Features
        and availability may change while the beta is being completed.
      </p>
      <h2>Visa Decisions</h2>
      <p>
        VisaStack helps organize records and workflows. It does not guarantee a visa, certify a
        document's authenticity or replace advice from an appropriate professional. A readiness
        status describes the recorded workflow, not the likelihood of approval.
      </p>
      <p>
        <Link href="/privacy">Read the Privacy Notice</Link> or{' '}
        <Link href="/auth/sign-up">return to account creation</Link>.
      </p>
    </section>
  );
}
