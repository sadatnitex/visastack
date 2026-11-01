import Link from 'next/link';
import { CountryChecklistPicker } from '../components/country-checklist-picker';
import { Icon, type IconName } from '../components/icons';
import { countryStartData } from '../lib/country-start';
import { isPublicBetaOpen } from '../lib/public-beta';
import { isSignedIn } from '../lib/signed-in';
import './landing-c1.css';

/**
 * The public home page, built on the frozen Harbor C1 reference (Programme X WP-L1).
 * Written for a traveller or an agency who has never heard of the product: plain words,
 * what it does and what is honestly not switched on yet. No engineering vocabulary and no
 * names of the tools behind it (guarded by `lib/plain-language.test.ts`).
 *
 * The Harbor hero and product chapter come first. The sections Harbor does not depict
 * (problem, how it works, availability, agencies, trust, road ahead, closing call) are
 * kept with Harbor colours only. Every drawn example is sample information and says so.
 * Each statement on this page maps to a claim row in docs/upgrades/programme/COVERAGE-LEDGER.csv.
 */

// The promise (owner decision, 27 Oct 2026, Growth G1): "A clean file you can stand behind."
// It is about the person's own file being complete, current and tidy. It never says or implies
// that any authority has approved, accepted or guaranteed anything.
const HERO_HEADLINE_FIRST = 'A clean file';
const HERO_HEADLINE_SECOND = 'you can stand behind.';

interface PhoneFile {
  readonly name: string;
  readonly detail: string;
  readonly tag: string;
  readonly warning?: boolean;
}

const PHONE_FILES: readonly PhoneFile[] = [
  { name: 'Passport', detail: 'Current record · Version 2', tag: 'Current' },
  { name: 'Employment Letter', detail: 'Added to Japan case', tag: 'Added' },
  { name: 'Bank Statement', detail: 'Newer copy requested', tag: 'Update', warning: true },
];

interface Float {
  readonly id: 'c1-fc1' | 'c1-fc2' | 'c1-fc3' | 'c1-fc4';
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
  readonly warning?: boolean;
}

// CL04-CL07. The third card is the expiry reminder (D5); "Prepared again, faster" returns
// only once Prepare again ships (WP-V6).
const FLOATS: readonly Float[] = [
  {
    id: 'c1-fc1',
    icon: '⌛',
    title: 'Document Needs Updating',
    detail: 'Bank statement · Japan case',
    warning: true,
  },
  {
    id: 'c1-fc2',
    icon: '▤',
    title: 'Previous Version Kept',
    detail: 'History stays available to you',
  },
  {
    id: 'c1-fc3',
    icon: '◷',
    title: 'Reminder Before It Expires',
    detail: 'Passport · sample record',
  },
  {
    id: 'c1-fc4',
    icon: '◉',
    title: 'Access Ends 30 November',
    detail: 'Three selected records shared',
  },
];

const BEFORE: readonly string[] = [
  'The same passport scan sent again for every application',
  'Documents buried in chats, emails and phone galleries',
  'No idea which version an agency is holding',
  'Surprise requests for papers that have quietly expired',
];

const AFTER: readonly string[] = [
  'Enter your details once and reuse them everywhere',
  'Every document in one private place, with its date',
  'Every change kept as a new version you can look back on',
  'A warning before a document runs out, not after',
];

interface Step {
  readonly title: string;
  readonly body: string;
  readonly icon: IconName;
}

const STEPS: readonly Step[] = [
  {
    title: 'Add Your Details Once',
    body: 'Fill in your profile and upload your documents. Each change is saved with its date, so you can always see what was added and when.',
    icon: 'upload',
  },
  {
    title: 'See what is missing',
    body: 'Pick a visa route and check your file against its requirements. You see what is complete, what is missing and what is close to expiring.',
    icon: 'clipboard',
  },
  {
    title: 'Share only what is needed',
    body: 'Invite an agency to see specific items for a set time. You approve it, you can stop it, and you can see what they opened.',
    icon: 'share',
  },
];

interface Audience {
  readonly who: string;
  readonly title: string;
  readonly points: readonly string[];
  readonly icon: IconName;
}

const AUDIENCES: readonly Audience[] = [
  {
    who: 'For travellers',
    title: 'Know where your papers are and what to do next',
    points: [
      'Store passport and supporting documents once, then reuse them',
      'See which documents are missing for each visa route',
      'Answer an agency’s document request in one place',
    ],
    icon: 'user',
  },
  {
    who: 'For Agencies',
    title: 'Stop Chasing Documents by Message',
    points: [
      'Ask a client for a specific document and see when it arrives',
      'Open a case and see at once what is missing or overdue',
      'Keep a clear record of who did what, and when',
    ],
    icon: 'briefcase',
  },
];

const PROMISES: readonly { readonly icon: IconName; readonly text: string }[] = [
  { icon: 'eye', text: 'Record sharing starts with your permission' },
  { icon: 'activity', text: 'Sharing decisions are recorded' },
  { icon: 'file', text: 'Changes are kept as new versions' },
  { icon: 'building', text: 'Official information shows where it came from' },
  { icon: 'shield', text: 'AI never changes your profile on its own' },
  { icon: 'check', text: 'A manual way to manage your profile' },
];

const HORIZONS: readonly {
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly state: 'now' | 'next' | 'later';
}[] = [
  {
    label: 'In the Pilot Today',
    title: 'The Core of One Profile',
    body: 'Your profile with saved versions, a private document vault, document checks against official requirements, and sharing with agencies.',
    state: 'now',
  },
  {
    label: 'Being Switched On',
    title: 'Help That Stays in Your Hands',
    body: 'AI suggestions from your documents and earlier warnings before papers expire, each switched on step by step. The status page shows exactly what works today.',
    state: 'next',
  },
  {
    label: 'Where we are heading',
    title: 'One Trusted File for Every Journey',
    body: 'We are working toward a single, verified file that follows a person across visa routes and countries, and gives agencies a calm, clear way to work with it.',
    state: 'later',
  },
];

interface HomePageProps {
  readonly searchParams: Promise<{ readonly auth_error?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  // A failed sign-in sends the visitor back here with a short reference that holds no
  // personal information (see apps/web/src/app/callback/route.ts), so they get a way
  // forward instead of a blank error page.
  const { auth_error: authError } = await searchParams;
  // Someone already signed in is taken straight to their workspace, never asked to sign in again.
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const startLabel = signedIn
    ? 'Open your workspace'
    : betaOpen
      ? 'Create your free account'
      : 'Sign in to get started';
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';

  return (
    <div className="c1">
      <section className="c1-hero c1-shell" aria-labelledby="land-hero-title">
        {authError ? (
          <p className="notice notice-warn c1-alert" role="alert">
            Sign-in didn’t complete. Please try again. If it keeps happening, contact support and
            quote reference <strong>{authError}</strong>.
          </p>
        ) : null}
        <p className="c1-nudge">{betaOpen ? 'Free Public Beta' : 'Invite-Only Pilot'}</p>
        <h1 className="c1-headline" id="land-hero-title">
          {HERO_HEADLINE_FIRST} <br />
          {HERO_HEADLINE_SECOND}
        </h1>
        <p className="c1-subline">
          One private file for your passport and papers. See what is missing, keep every version,
          and share only the part someone needs.
        </p>
        <div className="c1-cta">
          <a className="c1-pill" href={startHref}>
            {startLabel}{' '}
            <span className="c1-chevron" aria-hidden="true">
              ↗
            </span>
          </a>
          <Link className="c1-pill c1-pill-light" href="/status">
            See What Works Today
          </Link>
        </div>
        <p className="c1-meta">One personal record. Separate cases. Explicit sharing.</p>

        <figure className="c1-devices" aria-label="Illustrative interface with sample information">
          <div className="c1-phone">
            <div className="c1-island" />
            <div className="c1-statusbar" aria-hidden="true">
              <span>9:41</span>
              <span>●●● ▰</span>
            </div>
            <div className="c1-phonebody">
              <p className="c1-tinycap">VisaStack / Personal record</p>
              <p className="c1-phonename">
                Ready for
                <br />
                what’s next.
              </p>
              <p className="c1-sample">Ayesha’s record · Example</p>
              <div className="c1-segment" aria-hidden="true">
                <span>Documents</span>
                <span>Cases</span>
                <span>Sharing</span>
              </div>
              <div className="c1-phonepanel">
                <p className="c1-tinycap c1-panelcap">Your documents</p>
                {PHONE_FILES.map((file) => (
                  <div className="c1-fileline" key={file.name}>
                    <span className="c1-fileico" aria-hidden="true">
                      ▤
                    </span>
                    <span className="c1-fileinfo">
                      <b>{file.name}</b>
                      <small>{file.detail}</small>
                    </span>
                    <span className={file.warning ? 'c1-tag c1-tag-warning' : 'c1-tag'}>
                      {file.tag}
                    </span>
                  </div>
                ))}
              </div>
              <div className="c1-phonepanel">
                <p className="c1-next-label">NEXT ACTION</p>
                <b className="c1-next-title">Replace Bank Statement</b>
                <p className="c1-next-detail">Requested for your Japan visitor visa case.</p>
                <span className="c1-capsule">Review request →</span>
              </div>
            </div>
            <div className="c1-bottomnav" aria-hidden="true">
              <span>▣ Home</span>
              <span>▤ Record</span>
              <span>◷ Cases</span>
              <span>◯ Sharing</span>
            </div>
          </div>
          {FLOATS.map((float) => (
            <div className={`c1-floatcard ${float.id}`} key={float.id}>
              <span
                className={float.warning ? 'c1-float-icon c1-float-icon-warning' : 'c1-float-icon'}
                aria-hidden="true"
              >
                {float.icon}
              </span>
              <span>
                <b>{float.title}</b>
                <small>{float.detail}</small>
              </span>
            </div>
          ))}
          <figcaption className="c1-fineprint">
            Illustrative interface · Sample information
          </figcaption>
        </figure>
      </section>

      {signedIn ? null : (
        <section
          className="land-section country-start"
          id="start"
          aria-labelledby="land-country-title"
        >
          <div className="land-wrap">
            <div className="land-head">
              <p className="land-kicker">See Your Checklist</p>
              <h2 className="land-h2" id="land-country-title">
                Pick a country. See what is usually asked.
              </h2>
              <p className="land-sub">
                No account is needed to look. Create one only when you want to keep going.
              </p>
            </div>
            <CountryChecklistPicker
              variant="home"
              data={countryStartData()}
              signUpOpen={betaOpen}
            />
          </div>
        </section>
      )}

      <section className="c1-darkstage" id="product" aria-labelledby="land-product-title">
        <div className="c1-shell">
          <div className="c1-darkintro">
            <div>
              <p className="c1-nudge">The product, not just the promise</p>
              <h2 className="c1-sectionhead" id="land-product-title">
                Less paperwork. More control.
              </h2>
            </div>
            <p>
              Your documents live in your personal record. Cases use selected versions. Agencies
              receive only the access you choose, within the permissions the platform provides.
            </p>
          </div>
          {/* WP-SB8: on a phone the four cards sit in one row that scrolls sideways (no stacked grid). */}
          <div
            className="c1-bento"
            // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; these are cards
            role="group"
            aria-labelledby="land-product-title"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: on a phone this row scrolls sideways, so the keyboard must reach it.
            tabIndex={0}
          >
            <article className="c1-feature c1-feature-glow c1-feature-big">
              <span className="c1-small-label">01 / A reusable record</span>
              <h3>
                Keep the details.
                <br />
                Lose the repetition.
              </h3>
              <p>Find your current documents and see their earlier versions.</p>
              <div className="c1-miniui" aria-hidden="true">
                <b>Personal Record</b>
                <div className="c1-fileline">
                  <span className="c1-fileico">▤</span>
                  <span className="c1-fileinfo">
                    <b>Passport</b>
                    <small>Current version · Updated 8 Oct</small>
                  </span>
                  <span className="c1-tag">Current</span>
                </div>
              </div>
            </article>
            <article className="c1-feature c1-feature-mid">
              <span className="c1-small-label">02 / Specific requests</span>
              <h3>
                See exactly
                <br />
                what’s missing.
              </h3>
              <p>One clear request, with the document needed and the action to take.</p>
              <p className="c1-request" aria-hidden="true">
                <span>✳ Employment letter</span>
                <span className="c1-request-state">Requested</span>
              </p>
            </article>
            <article className="c1-feature c1-feature-light">
              <span className="c1-small-label">03 / Your choice</span>
              <h3>
                Share the part.
                <br />
                Not the whole.
              </h3>
              <p>
                Select records, review the scope and, if you want, set an access end date before
                agreeing to share.
              </p>
            </article>
            <article className="c1-feature c1-feature-deep">
              <span className="c1-small-label">04 / Historical accuracy</span>
              <h3>
                Yesterday stays
                <br />
                yesterday.
              </h3>
              <p>
                Keep an accurate history of previous declarations, even when your circumstances
                change.
              </p>
            </article>
          </div>
          <p className="c1-chapter-note">
            Privacy and sharing are governed by actual product permissions.
          </p>
        </div>
      </section>

      {/* WP-SB8 (scroll budget): the six story sections are one block of groups that open in
          place, so a phone reads the page in about five screens. Each group shows its kicker and
          heading and opens with one tap or key press; all start closed so the block reads as a
          short index (opening the first one by default costs about 700px on a phone and leaves
          too little room under the 6-screen budget). All words stay in the page (and in its
          search), and the menu's links still land on their group by its id. */}
      <div className="land-section land-story">
        <div className="land-wrap">
          <details className="land-group" id="problem">
            <summary className="land-group-summary">
              <span className="land-group-title">
                <span className="land-kicker">The Problem</span>
                <h2 className="land-h2" id="land-problem-title">
                  Every visa starts with the same scramble
                </h2>
              </span>
              <span className="land-group-chevron" aria-hidden="true">
                <Icon name="chevronDown" size={22} />
              </span>
            </summary>
            <div className="land-group-body">
              <p className="land-sub">
                Your life does not change between applications. The paperwork should not have to
                start from zero each time.
              </p>
              <div className="land-versus">
                <div className="land-versus-col land-versus-before">
                  <p className="land-versus-label">Without One Profile</p>
                  <ul>
                    {BEFORE.map((line) => (
                      <li key={line}>
                        <Icon name="close" size={16} />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="land-versus-col land-versus-after">
                  <p className="land-versus-label">With VisaStack</p>
                  <ul>
                    {AFTER.map((line) => (
                      <li key={line}>
                        <Icon name="check" size={16} />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </details>

          <details className="land-group" id="how-it-works">
            <summary className="land-group-summary">
              <span className="land-group-title">
                <span className="land-kicker">Three Simple Steps</span>
                <h2 className="land-h2" id="land-how-title">
                  How It Works
                </h2>
              </span>
              <span className="land-group-chevron" aria-hidden="true">
                <Icon name="chevronDown" size={22} />
              </span>
            </summary>
            <div className="land-group-body">
              <p className="land-sub">Three steps, and the first one only happens once.</p>
              <ol className="land-steps">
                {STEPS.map((step, index) => (
                  <li className="land-step" key={step.title}>
                    <span className="land-step-icon">
                      <Icon name={step.icon} size={22} />
                    </span>
                    <p className="land-step-kicker">Step {index + 1}</p>
                    <h3 className="land-h3">{step.title}</h3>
                    <p className="land-body">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </details>

          <details className="land-group" id="capabilities">
            <summary className="land-group-summary">
              <span className="land-group-title">
                <span className="land-kicker">What Works Today</span>
                <h2 className="land-h2" id="land-cap-title">
                  Switched On Step by Step
                </h2>
              </span>
              <span className="land-group-chevron" aria-hidden="true">
                <Icon name="chevronDown" size={22} />
              </span>
            </summary>
            <div className="land-group-body">
              <p className="land-sub">
                {betaOpen ? 'VisaStack is in public beta' : 'VisaStack is in a private pilot'}, so
                some features are still being switched on. The status page shows what works today.
                Checking a file shows how complete it is, never a guess at your chances of approval.
              </p>
              <p className="land-trust-link">
                <Link href="/status">See What Works Today</Link>
              </p>
            </div>
          </details>

          <details className="land-group" id="for-agencies">
            <summary className="land-group-summary">
              <span className="land-group-title">
                <span className="land-kicker">Who it is for</span>
                <h2 className="land-h2" id="land-who-title">
                  Calmer for the Traveller, Clearer for the Agency
                </h2>
              </span>
              <span className="land-group-chevron" aria-hidden="true">
                <Icon name="chevronDown" size={22} />
              </span>
            </summary>
            <div className="land-group-body">
              <div className="land-who">
                {AUDIENCES.map((audience) => (
                  <article className="land-who-card" key={audience.who}>
                    <span className="land-tile-icon">
                      <Icon name={audience.icon} size={22} />
                    </span>
                    <p className="land-step-kicker">{audience.who}</p>
                    <h3 className="land-h3">{audience.title}</h3>
                    <ul className="land-ticks">
                      {audience.points.map((point) => (
                        <li key={point}>
                          <Icon name="check" size={16} />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          </details>

          <details className="land-group land-trust" id="trust">
            <summary className="land-group-summary">
              <span className="land-group-title">
                <span className="land-kicker">Trust, Built In</span>
                <h2 className="land-h2" id="land-trust-title">
                  How VisaStack Treats Your Information
                </h2>
              </span>
              <span className="land-group-chevron" aria-hidden="true">
                <Icon name="chevronDown" size={22} />
              </span>
            </summary>
            <div className="land-group-body">
              <p className="land-sub">
                These promises are built into how the product works, not options you have to switch
                on.
              </p>
              <ul className="land-promises">
                {PROMISES.map((promise) => (
                  <li key={promise.text}>
                    <span className="land-promise-icon">
                      <Icon name={promise.icon} size={20} />
                    </span>
                    <span>{promise.text}</span>
                  </li>
                ))}
              </ul>
              <p className="land-trust-link">
                <Link href="/trust">Read Our Public Trust Page</Link>
              </p>
            </div>
          </details>

          <details className="land-group" id="road-ahead">
            <summary className="land-group-summary">
              <span className="land-group-title">
                <span className="land-kicker">The Road Ahead</span>
                <h2 className="land-h2" id="land-road-title">
                  Honest about where we are
                </h2>
              </span>
              <span className="land-group-chevron" aria-hidden="true">
                <Icon name="chevronDown" size={22} />
              </span>
            </summary>
            <div className="land-group-body">
              <p className="land-sub">
                {betaOpen
                  ? 'Registration is open for public beta, and some features are not switched on yet.'
                  : 'This is a private pilot for invited users, and some features are not switched on yet.'}{' '}
                {betaOpen
                  ? 'It is free to use at your own risk while we finish switching on protections such as virus scanning of uploads. The status page shows exactly what works today.'
                  : 'Please use made-up details, or documents with all personal information permanently blacked out. Real applicant details are not accepted yet.'}
              </p>
              <ol className="land-horizons">
                {HORIZONS.map((horizon) => (
                  <li className={`land-horizon land-horizon-${horizon.state}`} key={horizon.title}>
                    <p className="land-horizon-label">
                      {horizon.state === 'now' && betaOpen ? 'Available in Beta' : horizon.label}
                    </p>
                    <h3 className="land-h3">{horizon.title}</h3>
                    <p className="land-body">{horizon.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        </div>
      </div>

      <section className="land-final" aria-labelledby="land-final-title">
        <div className="land-wrap">
          <div className="land-final-card">
            <h2 className="land-final-title" id="land-final-title">
              Stop starting from zero.
            </h2>
            <p className="land-final-sub">
              Build your profile once and let every application start from it.
            </p>
            <div className="cta-row land-final-cta">
              <a className="btn land-btn land-btn-light" href={startHref}>
                {startLabel}
                <Icon name="arrow" size={18} />
              </a>
              <Link className="btn land-btn land-btn-ghost" href="/status">
                See What Works Today
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
