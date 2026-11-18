import type { Metadata } from 'next';
import Link from 'next/link';
import { InstallAppCard } from '../../../components/pwa/install-app-card';
import { WhatsAppShare } from '../../../components/share/whatsapp-share';
import { PageHeader } from '../../../components/ui';
import { supportEmail } from '../../../lib/support-email';
import { supportWhatsAppNumber } from '../../../lib/support-whatsapp';
import { composeShareMessage } from '../../../lib/whatsapp-link';
import { AreaPicture, OpenRowOnLink, TravellerRow, TravellerRows } from '../u7-rows';
export const metadata: Metadata = { title: 'Help and Support' };

export default function HelpPage() {
  const email = supportEmail();
  const whatsAppNumber = supportWhatsAppNumber();
  const help = whatsAppNumber
    ? composeShareMessage({ template: 'support-hello' }, { allowedOrigins: [] })
    : null;
  return (
    <section className="section container workspace-help">
      <PageHeader
        eyebrow="Help and Support"
        title="Find Your Next Step"
        description="Guidance for your records, case work and account."
      />
      <TravellerRows>
        <TravellerRow
          headingLevel={2}
          title="Your Records"
          picture={<AreaPicture mark={{ icon: 'folder', tone: 'blue' }} />}
        >
          <p className="u7-body-text">
            Choose a traveller to open their profile, document wallet, cases and sharing controls.
            Each workspace stays connected to the selected person.
          </p>
          <div className="u7-body-actions">
            <Link href="/app/applicants">Choose or Manage Travellers</Link>
          </div>
        </TravellerRow>
        <TravellerRow
          headingLevel={2}
          title="Your Agency"
          picture={<AreaPicture mark={{ icon: 'building', tone: 'violet' }} />}
        >
          <p className="u7-body-text">
            Choose an agency you belong to from the account menu. Administrators manage clients,
            requests and team access. Team members work on cases assigned to them.
          </p>
          <div className="u7-body-actions">
            <Link href="/app/agency">Find Your Agency Workspace</Link>
          </div>
        </TravellerRow>
        <TravellerRow
          headingLevel={2}
          title="Account and Privacy"
          picture={<AreaPicture mark={{ icon: 'shield', tone: 'teal' }} />}
        >
          <p className="u7-body-text">
            Account settings, consent, shared access and privacy requests are available from your
            account menu. Signing out ends this session.
          </p>
          <div className="u7-body-actions">
            <Link href="/app/account">Account Settings</Link>
            <Link href="/app/privacy">Privacy and Consent</Link>
            <Link href="/app/shared">Shared with Me</Link>
          </div>
        </TravellerRow>
      </TravellerRows>
      <OpenRowOnLink />
      <InstallAppCard />
      <h2 className="card-title u7-help-heading">Common Questions</h2>
      <TravellerRows className="u7-help-questions">
        <TravellerRow
          headingLevel={3}
          title="Why can I not open a document yet?"
          picture={<AreaPicture mark={{ icon: 'file', tone: 'neutral' }} />}
        >
          <p className="u7-body-text">
            Files stay blocked while checks are pending or when they are quarantined. A file
            signature check does not establish that a PDF is safe. Follow the status shown in the
            wallet; upload and preview safeguards still apply.
          </p>
        </TravellerRow>
        <TravellerRow
          headingLevel={3}
          title="Does a readiness percentage predict visa approval?"
          picture={<AreaPicture mark={{ icon: 'check', tone: 'neutral' }} />}
        >
          <p className="u7-body-text">
            No. It counts satisfied requirements for the attached rules. Unknown applicability,
            missing evidence and your confirmation remain separate. The destination authority
            decides your application.
          </p>
        </TravellerRow>
        <TravellerRow
          headingLevel={3}
          title="When does sharing start, and how can I end it?"
          picture={<AreaPicture mark={{ icon: 'share', tone: 'neutral' }} />}
        >
          <p className="u7-body-text">
            A recipient must accept the exact grant before access starts. Review the scope and
            expiry before confirming. Pause stops future access until resumed; revoke ends it.
            Neither can recall copies already downloaded.
          </p>
        </TravellerRow>
        <TravellerRow
          headingLevel={3}
          title="I did not receive a confirmation or password-reset email."
          picture={<AreaPicture mark={{ icon: 'mail', tone: 'neutral' }} />}
        >
          <p className="u7-body-text">
            Check spam and the address you entered. Use the confirmation page to resend a
            verification link, or request another password-reset link. Delivery to a mail server
            does not guarantee inbox placement.
          </p>
          <div className="u7-body-actions">
            <Link href="/auth/verify-email">Resend Confirmation</Link>
            <Link href="/auth/forgot-password">Request a Password-Reset Link</Link>
          </div>
        </TravellerRow>
        <TravellerRow
          headingLevel={3}
          title="Why is a feature unavailable?"
          picture={<AreaPicture mark={{ icon: 'alert', tone: 'neutral' }} />}
        >
          <p className="u7-body-text">
            Some capabilities need an active permission, recorded consent or a configured service.
            The page explains the missing requirement. Current release and service limitations are
            published on the status page.
          </p>
          <div className="u7-body-actions">
            <Link href="/status">What Works Today and Service Status</Link>
          </div>
        </TravellerRow>
      </TravellerRows>
      <article className="card help-contact" id="contact" aria-labelledby="help-contact-heading">
        <h2 className="card-title" id="help-contact-heading">
          Get Help from a Person
        </h2>
        <p>Choose the route that matches your question, so it reaches the right people.</p>
        <TravellerRows className="u-mt-050">
          <TravellerRow
            id="help-contact-case"
            defaultOpen
            headingLevel={3}
            title="A Problem with a Case or an Agency"
            picture={<AreaPicture mark={{ icon: 'clipboard', tone: 'amber' }} />}
          >
            <p>
              Open the case, then Problems and Feedback. A complaint goes to VisaStack quality
              staff, and the agency working your case never sees it. Private feedback is seen only
              by you and those staff. Each complaint keeps its status and history on the case.
            </p>
            <Link href="/app/applicants">Go to Your Travellers</Link>
          </TravellerRow>
          <TravellerRow
            id="help-contact-agency"
            defaultOpen
            headingLevel={3}
            title="A Question for Your Agency"
            picture={<AreaPicture mark={{ icon: 'building', tone: 'violet' }} />}
          >
            <p>
              If an agency invited you, ask them directly about your application. They see only what
              you chose to share with them, and you can end that sharing from the traveller&apos;s
              Sharing page.
            </p>
          </TravellerRow>
          <TravellerRow
            id="help-contact-data"
            defaultOpen
            headingLevel={3}
            title="Your Data and Privacy"
            picture={<AreaPicture mark={{ icon: 'shield', tone: 'teal' }} />}
          >
            <p>
              Download a copy of your data, or ask for your account to be deleted. Both start from
              the privacy page.
            </p>
            <Link href="/app/privacy">Privacy and Data Requests</Link>
          </TravellerRow>
          <TravellerRow
            id="help-contact-status"
            defaultOpen
            headingLevel={3}
            title="Something Is Not Working"
            picture={<AreaPicture mark={{ icon: 'alert', tone: 'red' }} />}
          >
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
            {help?.ok ? (
              <>
                <p>Prefer WhatsApp? Start a chat with VisaStack. You press Send yourself.</p>
                <WhatsAppShare
                  message={help.message}
                  number={whatsAppNumber}
                  title="VisaStack Help"
                  sendOnly
                />
              </>
            ) : null}
          </TravellerRow>
        </TravellerRows>
      </article>
    </section>
  );
}
