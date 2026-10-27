import type { Locale } from '@visastack/i18n';
import Link from 'next/link';
import { AddApplicantForm } from './add-applicant-form';
import { ConsentButton } from './consent-button';

/**
 * Task-first first run (WP-V3, decision D8, preview approved 25 Oct 2026). Screen 1 asks for core
 * processing alone; screen 2 asks who the record is for; screen 3 asks what the person wants to
 * do, offering only choices whose destination exists. Each screen uses the existing consent and
 * applicant actions with unchanged values. Nothing here grants anything by itself.
 */

/** Where "Not now" and "See all permissions" lead: the ordinary home with every consent control. */
export const SETUP_LATER_HREF = '/app?setup=later';

function Steps({ current }: { readonly current: 1 | 2 }) {
  return (
    <>
      <p className="eyebrow">Step {current} of 2</p>
      <ol className="first-run-steps" aria-hidden="true">
        <li className="on" />
        <li className={current === 2 ? 'on' : undefined} />
      </ol>
    </>
  );
}

export function FirstRunConsent({
  locale,
  laterHref = SETUP_LATER_HREF,
}: { readonly locale: Locale; readonly laterHref?: string }) {
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <Steps current={1} />
      <h1 className="section-title" id="first-run-title">
        Allow VisaStack to <em>process your details</em>
      </h1>
      <p className="card-body">
        This is needed before anything can be saved. You can turn it off at any time.
      </p>
      <p className="first-run-notice">
        This does not turn on AI reading, sharing with an agency or marketing. Those stay off until
        you choose them.
      </p>
      <ConsentButton
        type="CORE_PROCESSING"
        granted={false}
        locale={locale}
        text="Allow core processing"
      />
      <p className="first-run-later">
        <Link href={laterHref}>Not Now</Link>
      </p>
      <p className="muted first-run-note">
        Without it you can still browse countries and read help.{' '}
        <Link href={`${SETUP_LATER_HREF}#permissions`}>See all permissions</Link>
      </p>
    </section>
  );
}

export function FirstRunName({ laterHref = SETUP_LATER_HREF }: { readonly laterHref?: string }) {
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <Steps current={2} />
      <h1 className="section-title" id="first-run-title">
        Who is this <em>record for?</em>
      </h1>
      <AddApplicantForm firstRun />
      <p className="first-run-later">
        <Link href={laterHref}>Not Now</Link>
      </p>
    </section>
  );
}

export interface FirstRunTaskProps {
  /** The page of a request an agency is waiting on, when there is one. */
  readonly requestHref: string | null;
  /** The first applicant's records. */
  readonly recordsHref: string;
  /** Where a brief is prepared (the outputs page of the first applicant), when there is one. */
  readonly briefHref?: string | null;
}

export function FirstRunTask({ requestHref, recordsHref, briefHref = null }: FirstRunTaskProps) {
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <h1 className="section-title" id="first-run-title">
        What do you want <em>to do?</em>
      </h1>
      <ul className="first-run-tasks">
        {requestHref ? (
          <li>
            <Link href={requestHref}>
              <b>Complete a Request</b>
              <span>An agency asked you for something</span>
            </Link>
          </li>
        ) : null}
        {briefHref ? (
          <li>
            <Link href={briefHref}>
              <b>Prepare a Brief</b>
              <span>Choose what goes in, then copy or download it</span>
            </Link>
          </li>
        ) : null}
        <li>
          <Link href={recordsHref}>
            <b>Update or Find My Records</b>
            <span>Documents, details and dates</span>
          </Link>
        </li>
      </ul>
      <p className="first-run-later">
        <Link href="/app">Skip for Now</Link>
      </p>
    </section>
  );
}
