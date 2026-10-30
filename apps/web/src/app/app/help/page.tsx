import type { Metadata } from 'next';
import Link from 'next/link';
import { InstallAppCard } from '../../../components/pwa/install-app-card';
import { PageHeader } from '../../../components/ui';
import { supportEmail } from '../../../lib/support-email';
export const metadata: Metadata = { title: 'Help and Support' };

export default function HelpPage() {
  const email = supportEmail();
  return (
    <section className="section container workspace-help">
      <PageHeader
        eyebrow="Help and Support"
        title="Find Your Next Step"
        description="Guidance for your records, case work and account."
      />
      <div className="help-guide-grid">
        <article className="card">
          <h2 className="card-title">Your Records</h2>
          <p>
            Choose a traveller to open their profile, document wallet, cases and sharing controls.
            Each workspace stays connected to the selected person.
          </p>
          <Link href="/app/applicants">Choose or Manage Travellers</Link>
        </article>
        <article className="card">
          <h2 className="card-title">Your Agency</h2>
          <p>
            Choose an agency you belong to from the account menu. Administrators manage clients,
            requests and team access. Team members work on cases assigned to them.
          </p>
          <Link href="/app/agency">Find Your Agency Workspace</Link>
        </article>
        <article className="card">
          <h2 className="card-title">Account and Privacy</h2>
          <p>
            Account settings, consent, shared access and privacy requests are available from your
            account menu. Signing out ends this session.
          </p>
          <Link href="/app/account">Account Settings</Link>
          <Link href="/app/privacy">Privacy and Consent</Link>
          <Link href="/app/shared">Shared with Me</Link>
        </article>
        <InstallAppCard />
      </div>
      <article className="card help-questions">
        <h2 className="card-title">Common Questions</h2>
        <details>
          <summary>Why can I not open a document yet?</summary>
          <p>
            Files stay blocked while checks are pending or when they are quarantined. A file
            signature check does not establish that a PDF is safe. Follow the status shown in the
            wallet; upload and preview safeguards still apply.
          </p>
        </details>
        <details>
          <summary>Does a readiness percentage predict visa approval?</summary>
          <p>
            No. It counts satisfied requirements for the attached rules. Unknown applicability,
            missing evidence and your confirmation remain separate. The destination authority
            decides your application.
          </p>
        </details>
        <details>
          <summary>When does sharing start, and how can I end it?</summary>
          <p>
            A recipient must accept the exact grant before access starts. Review the scope and
            expiry before confirming. Pause stops future access until resumed; revoke ends it.
            Neither can recall copies already downloaded.
          </p>
        </details>
        <details>
          <summary>I did not receive a confirmation or password-reset email.</summary>
          <p>
            Check spam and the address you entered. Use the confirmation page to resend a
            verification link, or request another password-reset link. Delivery to a mail server
            does not guarantee inbox placement.
          </p>
          <Link href="/auth/verify-email">Resend Confirmation</Link>
          <Link href="/auth/forgot-password">Request a Password-Reset Link</Link>
        </details>
        <details>
          <summary>Why is a feature unavailable?</summary>
          <p>
            Some capabilities need an active permission, recorded consent or a configured service.
            The page explains the missing requirement. Current release and service limitations are
            published on the status page.
          </p>
          <Link href="/status">What Works Today and Service Status</Link>
        </details>
      </article>
      <article className="card help-contact" id="contact" aria-labelledby="help-contact-heading">
        <h2 className="card-title" id="help-contact-heading">
          Get Help from a Person
        </h2>
        <p>Choose the route that matches your question, so it reaches the right people.</p>
        <section className="help-contact-route" aria-labelledby="help-contact-case">
          <h3 id="help-contact-case">A Problem with a Case or an Agency</h3>
          <p>
            Open the case, then Problems and Feedback. A complaint goes to VisaStack quality staff,
            and the agency working your case never sees it. Private feedback is seen only by you and
            those staff. Each complaint keeps its status and history on the case.
          </p>
          <Link href="/app/applicants">Go to Your Travellers</Link>
        </section>
        <section className="help-contact-route" aria-labelledby="help-contact-agency">
          <h3 id="help-contact-agency">A Question for Your Agency</h3>
          <p>
            If an agency invited you, ask them directly about your application. They see only what
            you chose to share with them, and you can end that sharing from the traveller&apos;s
            Sharing page.
          </p>
        </section>
        <section className="help-contact-route" aria-labelledby="help-contact-data">
          <h3 id="help-contact-data">Your Data and Privacy</h3>
          <p>
            Download a copy of your data, or ask for your account to be deleted. Both start from the
            privacy page.
          </p>
          <Link href="/app/privacy">Privacy and Data Requests</Link>
        </section>
        <section className="help-contact-route" aria-labelledby="help-contact-status">
          <h3 id="help-contact-status">Something Is Not Working</h3>
          <p>
            Check the status page first: it says what works today and lists known problems. If the
            problem is not listed, raise it from the case it affects, under Problems and Feedback:
            it reaches VisaStack staff. If a page showed an error with a reference, include that
            reference.
          </p>
          <Link href="/status">Service Status</Link>
          {email ? (
            <p>
              No case to raise it from, or nothing here fits? Email VisaStack support at{' '}
              <a href={`mailto:${email}`}>{email}</a>.
            </p>
          ) : null}
        </section>
      </article>
    </section>
  );
}
