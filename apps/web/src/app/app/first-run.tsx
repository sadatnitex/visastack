import type { Locale } from '@visastack/i18n';
import Link from 'next/link';
import { CountryChecklistPicker } from '../../components/country-checklist-picker';
import type { StartData } from '../../lib/country-start';
import { appHrefForCountry, permissionStepHref } from '../../lib/country-start-links';
import { AddApplicantForm } from './add-applicant-form';
import { ConsentButton } from './consent-button';

/**
 * Task-first first run (WP-V3, decision D8, preview approved 25 Oct 2026). Screen 1 asks for core
 * processing alone; screen 2 asks who the record is for; screen 3 asks what the person wants to
 * do, offering only choices whose destination exists. Each screen uses the existing consent and
 * applicant actions with unchanged values. Nothing here grants anything by itself.
 *
 * Growth G2 puts one screen before them: pick a country and see its checklist at once. It is
 * skipped for someone who came for a task (an invitation), so those people see two screens as
 * before. The country rides in the address (`country`), never a cookie, and is shown again on the
 * screens that follow.
 */

/** Where "Not now" and "See all permissions" lead: the ordinary home with every consent control. */
export const SETUP_LATER_HREF = '/app?setup=later';

/** Step `current` of `total`. With the country step there are three; without it, two. */
function Steps({ current, total }: { readonly current: number; readonly total: 2 | 3 }) {
  return (
    <>
      <p className="eyebrow">
        Step {current} of {total}
      </p>
      <ol className="first-run-steps" aria-hidden="true">
        {Array.from({ length: total }, (_, at) => (
          <li key={`step-${at + 1}`} className={at < current ? 'on' : undefined} />
        ))}
      </ol>
    </>
  );
}

/** The country chosen on the first screen, shown again so the choice is never lost. */
function ChosenCountry({
  name,
  changeHref,
}: { readonly name: string | null; readonly changeHref?: string }) {
  if (!name) return null;
  return (
    <p className="first-run-country">
      Your Country: <b>{name}</b>
      {changeHref ? (
        <>
          {' '}
          <Link href={changeHref}>Change</Link>
        </>
      ) : null}
    </p>
  );
}

export function FirstRunCountry({
  data,
  iso2,
  action,
}: {
  readonly data: StartData;
  /** A country already chosen (from the home page or an earlier visit), checked against the data. */
  readonly iso2: string | null;
  /** Records the confirmed choice, then moves on to the permission screen. */
  readonly action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <section
      className="section container first-run first-run-wide"
      aria-labelledby="first-run-title"
    >
      <Steps current={1} total={3} />
      <h1 className="section-title" id="first-run-title">
        Where do you want <em>to go?</em>
      </h1>
      <p className="card-body">
        Pick a country and see what is usually asked for, right away. You can change it any time.
      </p>
      <CountryChecklistPicker variant="first-run" data={data} initialIso2={iso2} action={action} />
      <p className="first-run-later">
        <Link href={permissionStepHref(iso2)}>Skip for Now</Link>
      </p>
    </section>
  );
}

export function FirstRunConsent({
  locale,
  laterHref = SETUP_LATER_HREF,
  hasCountryStep = false,
  countryName = null,
  countryIso2 = null,
}: {
  readonly locale: Locale;
  readonly laterHref?: string;
  /** True when the country screen came first, which makes this screen 2 of 3. */
  readonly hasCountryStep?: boolean;
  readonly countryName?: string | null;
  readonly countryIso2?: string | null;
}) {
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <Steps current={hasCountryStep ? 2 : 1} total={hasCountryStep ? 3 : 2} />
      <h1 className="section-title" id="first-run-title">
        Allow VisaStack to <em>process your details</em>
      </h1>
      <ChosenCountry
        name={countryName}
        {...(hasCountryStep && countryIso2 ? { changeHref: appHrefForCountry(countryIso2) } : {})}
      />
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

export function FirstRunName({
  laterHref = SETUP_LATER_HREF,
  hasCountryStep = false,
  countryName = null,
}: {
  readonly laterHref?: string;
  readonly hasCountryStep?: boolean;
  readonly countryName?: string | null;
}) {
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <Steps current={hasCountryStep ? 3 : 2} total={hasCountryStep ? 3 : 2} />
      <h1 className="section-title" id="first-run-title">
        Who is this <em>record for?</em>
      </h1>
      <ChosenCountry name={countryName} />
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
  /** The country chosen on the first screen, and where its full page is, when there is one. */
  readonly countryName?: string | null;
  readonly countryHref?: string | null;
}

export function FirstRunTask({
  requestHref,
  recordsHref,
  briefHref = null,
  countryName = null,
  countryHref = null,
}: FirstRunTaskProps) {
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <h1 className="section-title" id="first-run-title">
        What do you want <em>to do?</em>
      </h1>
      <ul className="first-run-tasks">
        {countryName && countryHref ? (
          <li>
            <Link href={countryHref}>
              <b>See Your {countryName} Checklist</b>
              <span>What is usually asked for, and where each fact came from</span>
            </Link>
          </li>
        ) : null}
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
