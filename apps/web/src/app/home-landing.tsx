import type { DeploymentMode } from '@visastack/core';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Accordion } from '../components/landing/accordion';
import { LandingPlanner, PlannerForm, PlannerPlan } from '../components/landing/planner';
import type { PlanWords } from '../components/landing/planner';
import { landingStatus } from '../lib/landing-status';
import './home-landing.css';

/**
 * The home page as the owner-approved homepage design tells it (Harbor Blue folio, English first):
 * a Bangladesh-focused first screen with the destination planner, the plan it opens, a row of
 * sources, privacy and status, a sample family case, the reusable record with a passport renewal,
 * the agency request workflow, the common questions and one closing action.
 *
 * Every example is made up and says so. The page makes no promise the product does not keep: it
 * prepares and shares documents, and the issuing authority decides the visa. The words are English
 * (the approved copy has no translation yet), so on a Bangla page each section is marked English
 * (WCAG 3.1.2); the notice and the sign-in alert keep their own catalogue words and marking.
 */

export interface HomeLandingProps {
  /** A sign-in problem notice from a failed sign-in, shown above the first screen. */
  readonly alert?: ReactNode;
  /** The suggested destinations, already resolved against the country catalogue (their names). */
  readonly destinations: readonly string[];
  /** The page's own language ('en' or 'bn'): English sections are marked English on a Bangla page. */
  readonly pageLang: string;
  readonly deploymentMode: DeploymentMode;
  readonly registrationOpen: boolean;
  /** The account action the visitor's session and the registration switch decide. */
  readonly start: { readonly label: ReactNode; readonly href: string };
  /** The pilot or beta words, as the banner and the legal pages say them. */
  readonly notice: ReactNode;
  /** The status page's established name ("See What Works Today"), with its Bangla words. */
  readonly statusLabel: ReactNode;
}

const PLAN_WORDS: PlanWords = {
  kicker: 'Your Starting Plan',
  titleBefore: 'Getting ready for',
  fallbackTitle: 'Your first steps',
  intro:
    'Use this plan to organise your work. Confirm the current requirements for your trip with the issuing authority.',
  partyLabel: 'Who are you preparing for?',
  self: 'Myself',
  family: 'My Family',
  steps: {
    self: [
      {
        lead: 'Find the official source',
        body: 'Check the country guide and follow its official links where available.',
      },
      {
        lead: 'Check your saved copies',
        body: 'Keep what still applies and flag what has changed since your last case.',
      },
      {
        lead: 'Decide how you’ll prepare',
        body: 'Prepare on your own or choose which copies to share with an agency.',
      },
    ],
    family: [
      {
        lead: 'Find the official source',
        body: 'Check the country guide and follow its official links where available.',
      },
      {
        lead: 'Check each traveller’s copies',
        body: 'Keep each person’s documents in their own record and check which details have changed.',
      },
      {
        lead: 'Decide how you’ll prepare',
        body: 'Prepare on your own or choose which copies to share with an agency.',
      },
    ],
  },
  guideBefore: 'Find',
  guideAfter: 'in Country Guides',
  guideFallback: 'Open Country Guide',
};

/** The questions' heading, in the approved design's own words (display copy, so sentence case). */
const FAQ_HEADING = 'Before you begin';

const STATUS_WORDS = {
  self: 'Individual preparation steps shown.',
  family: 'Family preparation steps shown.',
} as const;

const CASE_ITEMS = [
  {
    name: 'Passport Copy',
    pill: 'Saved',
    tone: 'positive',
    body: 'Review the saved copy and its expiry date. Each family member has a separate record.',
  },
  {
    name: 'Employment Letter',
    pill: 'Review Update',
    tone: 'warn',
    body: 'Compare the old letter with the current one, then choose which version belongs in this case.',
  },
  {
    name: 'Agency Request',
    pill: 'Awaiting Reply',
    tone: 'plain',
    body: 'See who asked and which copies they need. Review the exact items you selected before sending them.',
  },
] as const;

const HISTORY_ROWS = [
  {
    term: 'Previous Case',
    name: 'Earlier Passport',
    body: 'The past case keeps the version used at the time.',
  },
  {
    term: 'Current Record',
    name: 'Renewed Passport',
    body: 'Keep the new version in your own record.',
  },
  {
    term: 'Next Case',
    name: 'Review and Select',
    body: 'Choose the current copy for the next application.',
  },
] as const;

/** The three small line drawings of the reassurance row (decorative: the words beside them say it). */
function LineIcon({ kind }: { readonly kind: 'source' | 'lock' | 'status' }) {
  return (
    <svg
      className="lp-line-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'source' ? (
        <>
          <rect x="4" y="2" width="16" height="20" rx="3" />
          <path d="M8 8h8M8 16h8" />
        </>
      ) : kind === 'lock' ? (
        <>
          <rect x="3" y="10" width="18" height="12" rx="3" />
          <path d="M7 10V8a5 5 0 0 1 10 0v2" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

function englishOn(lang: string): { lang?: string } {
  return lang === 'en' ? {} : { lang: 'en' };
}

export function HomeLanding({
  alert,
  destinations,
  pageLang,
  deploymentMode,
  registrationOpen,
  start,
  notice,
  statusLabel,
}: HomeLandingProps) {
  const en = englishOn(pageLang);
  const status = landingStatus(deploymentMode, registrationOpen);

  return (
    <div className="lp">
      {alert}
      <LandingPlanner statusWords={STATUS_WORDS}>
        <section className="lp-hero" aria-labelledby="lp-title" id="capabilities" {...en}>
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-content">
              <p className="lp-kicker">
                {/* The flag file is the site's own, the same one the country guides draw. Low priority, so the
                    folio below is the one picture the browser is told to fetch first. */}
                <img src="/flags/bd.svg" width={22} height={14} alt="" fetchPriority="low" />
                For travellers applying from Bangladesh
              </p>
              <h1 id="lp-title">
                Your visa paperwork, <em>in order.</em>
              </h1>
              <p className="lp-lead">
                Check official sources, organise a case for yourself or your family, and share only
                the documents you choose.
              </p>
              <PlannerForm
                words={{
                  label: 'Where are you going?',
                  placeholder: 'Choose a destination',
                  submit: 'See My First Steps',
                }}
                destinations={destinations}
                footer={
                  <>
                    <span>Start without an account.</span>
                    <Link href="/countries">Browse All Country Guides</Link>
                  </>
                }
              />
            </div>
            <figure className="lp-photo">
              {/* The one picture of the first screen: the published folio, 1100 by 1375, served by the
                  site's own image route (same origin, so the page policy is unchanged), the only
                  image the browser is told to fetch first. It is decorative: the caption is text. */}
              <Image
                src="/landing/visa-record-folio.webp"
                width={1100}
                height={1375}
                alt=""
                priority
                fetchPriority="high"
                sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1340px) 42vw, 550px"
                quality={80}
              />
              <figcaption className="lp-photo-caption">
                <strong>One record for this trip and the next.</strong>
              </figcaption>
            </figure>
          </div>
        </section>

        <PlannerPlan words={PLAN_WORDS} />
      </LandingPlanner>

      <section
        className="lp-assurance"
        id="sources"
        aria-label="Sources, privacy and product status"
        {...en}
      >
        <div className="lp-wrap lp-assurance-grid">
          <article>
            <LineIcon kind="source" />
            <div>
              <strong>Start from the official source</strong>
              <Link href="/countries">See Country Guides and Sources</Link>
            </div>
          </article>
          <article>
            <LineIcon kind="lock" />
            <div>
              <strong>You choose what to share</strong>
              <Link href="/trust">See How Access Works</Link>
            </div>
          </article>
          <article>
            <LineIcon kind="status" />
            <div>
              <strong>{status.assurance}</strong>
              <Link href="/status">{statusLabel}</Link>
            </div>
          </article>
        </div>
      </section>

      <section
        id="prepare"
        className="lp-process lp-wrap"
        aria-labelledby="lp-process-title"
        tabIndex={-1}
        {...en}
      >
        <div className="lp-process-copy" id="how-it-works">
          <p className="lp-kicker">Prepare a Case</p>
          <h2 id="lp-process-title">
            See what’s ready.
            <br />
            <em>Know what to do next.</em>
          </h2>
          <p>
            Bring the documents and details for one trip into a case. See what you already have,
            what needs a newer copy, and what your agency is waiting for.
          </p>
          <Link className="lp-text-link" href="/how-it-works">
            See How VisaStack Works
          </Link>
        </div>
        <div className="lp-case">
          <header className="lp-case-head">
            <div>
              <strong>Preparing a family visit</strong>
              <span>Example case</span>
            </div>
            <span className="lp-pill">Traveller View</span>
          </header>
          {CASE_ITEMS.map((item, index) => (
            <Accordion
              group="lp-case"
              defaultOpen={index === 0}
              key={item.name}
              summary={
                <>
                  <span>{item.name}</span>
                  <span
                    className={
                      item.tone === 'positive'
                        ? 'lp-pill lp-positive'
                        : item.tone === 'warn'
                          ? 'lp-pill lp-warn'
                          : 'lp-pill'
                    }
                  >
                    {item.pill}
                  </span>
                </>
              }
            >
              <p>{item.body}</p>
            </Accordion>
          ))}
          <p className="lp-case-foot">
            Illustrative files. Requirements depend on the country and route.
          </p>
        </div>
      </section>

      <section
        className="lp-record"
        id="your-record"
        aria-labelledby="lp-record-title"
        tabIndex={-1}
        {...en}
      >
        <div className="lp-wrap lp-record-grid">
          <div>
            <p className="lp-kicker">Your Reusable Record</p>
            <h2 id="lp-record-title">Give your next trip a head start.</h2>
            <p>
              Keep confirmed details and document versions between trips. If your passport, address
              or employer changes, compare the old details with the new ones before you reuse them.
            </p>
            <p>Build a copy-ready sheet of selected details to use when filling another form.</p>
          </div>
          <div className="lp-history">
            <header>
              <strong>A passport renewal</strong>
              <span className="lp-pill">Example</span>
            </header>
            <dl>
              {HISTORY_ROWS.map((row) => (
                <div key={row.term}>
                  <dt>{row.term}</dt>
                  <dd>
                    <strong>{row.name}</strong>
                    <span>{row.body}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section
        className="lp-agency"
        id="for-agencies"
        aria-labelledby="lp-agency-title"
        tabIndex={-1}
        {...en}
      >
        <div className="lp-wrap lp-agency-grid">
          <div>
            <p className="lp-kicker">For Visa Agencies</p>
            <h2 id="lp-agency-title">One request link. A clearer case file.</h2>
          </div>
          <div>
            <p>
              Send one link for the documents you need. Follow up on the specific items still
              missing and review the exact copies they sent, all in the same case.
            </p>
            <Link className="lp-button lp-primary" href="/for-agencies">
              Explore Agency Workflows
            </Link>
          </div>
        </div>
      </section>

      <section
        id="questions"
        className="lp-faq lp-wrap"
        aria-labelledby="lp-faq-title"
        tabIndex={-1}
        {...en}
      >
        <h2 id="lp-faq-title">{FAQ_HEADING}</h2>
        <div className="lp-faq-items">
          <Accordion summary="Can I start before choosing an agency?">
            <p>
              Yes. Choose a destination to see where to start, or browse the country guides on your
              own.
            </p>
          </Accordion>
          <Accordion summary="Can I prepare for my family?">
            <p>
              Yes. Keep each traveller’s documents separate and work within the permissions you have
              for that person.
            </p>
          </Accordion>
          <Accordion summary="Can an agency see my whole record?">
            <p>
              You choose what to share. Review who is asking and the versions you’re including
              before you send. <Link href="/trust">Read about privacy and access</Link>.
            </p>
          </Accordion>
          <Accordion summary="Does VisaStack issue visas?">
            <p>
              VisaStack helps you prepare. The issuing authority sets the official requirements and
              decides your application.
            </p>
          </Accordion>
          <Accordion summary="Can I upload real documents today?">
            <p>
              {status.realDocuments} <Link href="/status">product status page</Link> for what’s
              available.
            </p>
          </Accordion>
        </div>
      </section>

      <section className="lp-close" id="start" aria-labelledby="lp-close-title">
        <div className="lp-wrap lp-close-inner">
          <h2 id="lp-close-title" {...en}>
            Where’s your next trip?
          </h2>
          <div className="lp-close-actions">
            <a className="lp-button lp-primary" href="#planner" {...en}>
              Choose a Destination
            </a>
            {/* The established account action, whose words and address follow the visitor's session
                and whether registration is open. A plain link: /app sends a visitor on to sign-in. */}
            {start.href === '/app' ? (
              <a className="lp-button lp-quiet" href={start.href}>
                {start.label}
              </a>
            ) : (
              <Link className="lp-button lp-quiet" href={start.href}>
                {start.label}
              </Link>
            )}
          </div>
          <p className="lp-notice">{notice}</p>
        </div>
      </section>
    </div>
  );
}
