import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../components/ui';
export const metadata: Metadata = { title: 'Help and support' };
export default function HelpPage() {
  return (
    <section className="section container workspace-help">
      <PageHeader
        eyebrow="Help and support"
        title="Find your next step"
        description="Guidance for your records, case work and account."
      />
      <div className="help-guide-grid">
        <article className="card">
          <h2 className="card-title">Your records</h2>
          <p>
            Choose a traveller to open their profile, document wallet, cases and sharing controls.
            Each workspace stays connected to the selected person.
          </p>
          <Link href="/app/applicants">Choose or manage travellers</Link>
        </article>
        <article className="card">
          <h2 className="card-title">Your agency</h2>
          <p>
            Choose an agency you belong to from the account menu. Administrators manage clients,
            requests and team access. Team members work on cases assigned to them.
          </p>
          <Link href="/app/agency">Find your agency workspace</Link>
        </article>
        <article className="card">
          <h2 className="card-title">Account and privacy</h2>
          <p>
            Account settings, consent, shared access and privacy requests are available from your
            account menu. Signing out ends this session.
          </p>
          <Link href="/app/account">Account settings</Link>
          <Link href="/app/privacy">Privacy and consent</Link>
          <Link href="/app/shared">Shared with me</Link>
        </article>
      </div>
      <article className="card help-questions">
        <h2 className="card-title">Common questions</h2>
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
          <Link href="/auth/verify-email">Resend confirmation</Link>
          <Link href="/auth/forgot-password">Request a password-reset link</Link>
        </details>
        <details>
          <summary>Why is a feature unavailable?</summary>
          <p>
            Some capabilities need an active permission, recorded consent or a configured service.
            The page explains the missing requirement. Current release and service limitations are
            published on the status page.
          </p>
          <Link href="/status">What works today and service status</Link>
        </details>
      </article>
    </section>
  );
}
