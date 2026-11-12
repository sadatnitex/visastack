import type { Locale } from '@visastack/i18n';
import Link from 'next/link';
import { CountryChecklistPicker } from '../../components/country-checklist-picker';
import { DestinationLabel } from '../../components/destination-label';
import { appHomeCatalog } from '../../i18n/app-home';
import { CONFIRMED_LINE } from '../../lib/confirmed-landing';
import type { StartData } from '../../lib/country-start';
import { appHrefForCountry, permissionStepHref } from '../../lib/country-start-links';
import { getServerT } from '../../lib/i18n-server';
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
  const t = getServerT(appHomeCatalog);
  return (
    <>
      <p className="eyebrow">
        {t.node('appHome.appFirstRun.stepCurrentOfTotal', { current, total })}
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
  const t = getServerT(appHomeCatalog);
  if (!name) return null;
  return (
    <p className="first-run-country">
      Your Country:{' '}
      <b>
        <DestinationLabel destination={name} />
      </b>
      {changeHref ? (
        <>
          {' '}
          <Link href={changeHref}>{t.node('appHome.appFirstRun.change')}</Link>
        </>
      ) : null}
    </p>
  );
}

export function FirstRunCountry({
  data,
  iso2,
  action,
  confirmed = false,
}: {
  readonly data: StartData;
  /** True right after the email confirmation link signed the person in: shows the line once. */
  readonly confirmed?: boolean;
  /** A country already chosen (from the home page or an earlier visit), checked against the data. */
  readonly iso2: string | null;
  /** Records the confirmed choice, then moves on to the permission screen. */
  readonly action: (formData: FormData) => void | Promise<void>;
}) {
  const t = getServerT(appHomeCatalog);
  return (
    <section
      className="section container first-run first-run-wide"
      aria-labelledby="first-run-title"
    >
      <Steps current={1} total={3} />
      {confirmed ? (
        <p className="first-run-notice">
          <output>{CONFIRMED_LINE}</output>
        </p>
      ) : null}
      <h1 className="section-title" id="first-run-title">
        Where do you want <em>to go?</em>
      </h1>
      <p className="card-body">{t.node('appHome.appFirstRun.pickACountryAndSeeWhat')}</p>
      <CountryChecklistPicker variant="first-run" data={data} initialIso2={iso2} action={action} />
      <p className="first-run-later">
        <Link href={permissionStepHref(iso2)}>{t.node('appHome.appFirstRun.skipForNow')}</Link>
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
  const t = getServerT(appHomeCatalog);
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
      <p className="card-body">{t.node('appHome.appFirstRun.thisIsNeededBeforeAnythingCan')}</p>
      <p className="first-run-notice">{t.node('appHome.appFirstRun.thisDoesNotTurnOnAi')}</p>
      <ConsentButton
        type="CORE_PROCESSING"
        granted={false}
        locale={locale}
        text={t('appHome.appFirstRun.letVisastackProcessMyDetails')}
      />
      <p className="first-run-later">
        <Link href={laterHref}>{t.node('appHome.appFirstRun.notNow')}</Link>
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
  const t = getServerT(appHomeCatalog);
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <Steps current={hasCountryStep ? 3 : 2} total={hasCountryStep ? 3 : 2} />
      <h1 className="section-title" id="first-run-title">
        Who is this <em>record for?</em>
      </h1>
      <ChosenCountry name={countryName} />
      <AddApplicantForm firstRun />
      <p className="first-run-later">
        <Link href={laterHref}>{t.node('appHome.appFirstRun.notNow')}</Link>
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
  /**
   * UMPE P13, task first: the first applicant's upload, so a first file needs no profile answers
   * before it. Left out, the task is not offered.
   */
  readonly documentsHref?: string | null;
  /** UMPE P13: Start a Trip (where and why first; the checklist follows). */
  readonly tripHref?: string | null;
}

export function FirstRunTask({
  requestHref,
  recordsHref,
  briefHref = null,
  countryName = null,
  countryHref = null,
  documentsHref = null,
  tripHref = null,
}: FirstRunTaskProps) {
  const t = getServerT(appHomeCatalog);
  return (
    <section className="section container first-run" aria-labelledby="first-run-title">
      <h1 className="section-title" id="first-run-title">
        What do you want <em>to do?</em>
      </h1>
      <ul className="first-run-tasks">
        {countryName && countryHref ? (
          <li>
            <Link href={countryHref}>
              <b>{t.node('appHome.appFirstRun.seeYourCountrynameChecklist', { countryName })}</b>
              <span>{t.node('appHome.appFirstRun.whatIsUsuallyAskedForAnd')}</span>
            </Link>
          </li>
        ) : null}
        {requestHref ? (
          <li>
            <Link href={requestHref}>
              <b>{t.node('appHome.appFirstRun.completeARequest')}</b>
              <span>{t.node('appHome.appFirstRun.anAgencyAskedYouForSomething')}</span>
            </Link>
          </li>
        ) : null}
        {documentsHref ? (
          <li>
            <Link href={documentsHref}>
              <b>{t.node('appHome.appFirstRun.addDocuments')}</b>
              <span>{t.node('appHome.appFirstRun.uploadAPassportPageOrAny')}</span>
            </Link>
          </li>
        ) : null}
        {tripHref ? (
          <li>
            <Link href={tripHref}>
              <b>{t.node('appHome.appFirstRun.startATrip')}</b>
              <span>{t.node('appHome.appFirstRun.sayWhereAndWhyAndSee')}</span>
            </Link>
          </li>
        ) : null}
        {briefHref ? (
          <li>
            <Link href={briefHref}>
              <b>{t.node('appHome.appFirstRun.prepareASummary')}</b>
              <span>{t.node('appHome.appFirstRun.chooseWhatGoesInThenCopy')}</span>
            </Link>
          </li>
        ) : null}
        <li>
          <Link href={recordsHref}>
            <b>{t.node('appHome.appFirstRun.updateOrFindMyRecords')}</b>
            <span>{t.node('appHome.appFirstRun.documentsDetailsAndDates')}</span>
          </Link>
        </li>
      </ul>
      <p className="first-run-later">
        <Link href="/app">{t.node('appHome.appFirstRun.skipForNow')}</Link>
      </p>
    </section>
  );
}
