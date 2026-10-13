import Link from 'next/link';
import { Icon, type IconName } from '../components/icons';
import { StatusBadge, type Tone } from '../components/ui';
import { isPublicBetaOpen } from '../lib/public-beta';
import { isSignedIn } from '../lib/signed-in';

/**
 * The public home page. Written for a traveller or an agency who has never heard of
 * the product: plain words, what it does and what is honestly not switched on yet.
 * No engineering vocabulary and no names of the tools behind it (guarded by
 * `lib/plain-language.test.ts`).
 *
 * The page tells one story in order: what is broken today, what one profile changes,
 * how it works, what you get, who it is for, why you can trust it, and where it is
 * going. Everything drawn here is made-up example data and says so.
 */

const PREVIEW_ROWS: readonly {
  readonly name: string;
  readonly detail: string;
  readonly badge: string;
  readonly tone: Tone;
}[] = [
  { name: 'Passport', detail: 'Valid until 14 Mar 2031', badge: 'Ready', tone: 'success' },
  {
    name: 'Bank statement',
    detail: 'Expires in 12 days',
    badge: 'Expiring soon',
    tone: 'warning',
  },
  { name: 'Employer letter', detail: 'Asked for by the agency', badge: 'Missing', tone: 'danger' },
  { name: 'Hotel booking', detail: 'Sent 3 Oct 2026', badge: 'Under review', tone: 'neutral' },
];

const HERO_HEADLINE = 'One profile. Every visa.';

const ASSURANCES: readonly { readonly icon: IconName; readonly text: string }[] = [
  { icon: 'lock', text: 'Private by default' },
  { icon: 'check', text: 'You approve every AI suggestion' },
  { icon: 'share', text: 'Stop sharing at any time' },
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
    title: 'Add your details once',
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

interface Feature {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  readonly icon: IconName;
  readonly span?: 'half' | 'full';
}

const FEATURES: readonly Feature[] = [
  {
    kicker: 'Profile',
    title: 'One profile for every application',
    body: 'Enter your details once: identity, passport, travel history, work and money. Every change is saved as a new version, so nothing is quietly overwritten.',
    icon: 'user',
    span: 'half',
  },
  {
    kicker: 'Documents',
    title: 'A private place for your papers',
    body: 'Upload passports, bank statements and other documents. Only you and the people you choose can open them, and original files are never handed out without extra identity confirmation.',
    icon: 'folder',
    span: 'half',
  },
  {
    kicker: 'Suggestions',
    title: 'AI can help, but never decides',
    body: 'AI can suggest details from a document, and you approve or reject each one. Nothing changes without your say. Prefer to type it yourself? Everything also works by hand.',
    icon: 'activity',
  },
  {
    kicker: 'Cases',
    title: 'See what is still missing',
    body: 'Check your documents against the official requirements for a visa route. You see how complete your file is and what is missing, never a guess at your chances of approval.',
    icon: 'clipboard',
  },
  {
    kicker: 'Agencies',
    title: 'Share with an agency, on your terms',
    body: 'Choose what an agency can see and for how long. They have to accept, you can stop sharing at any time, and you can see who looked at what.',
    icon: 'share',
  },
  {
    kicker: 'Privacy',
    title: 'Your data stays yours',
    body: 'Your information is kept only as long as it is needed, and you can ask for it to be deleted. If the law says it must be kept, deletion waits. Sharing decisions are recorded in a protected history.',
    icon: 'shield',
    span: 'full',
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
    who: 'For agencies',
    title: 'Stop chasing documents by message',
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
    label: 'In the pilot today',
    title: 'The core of one profile',
    body: 'Your profile with saved versions, a private document vault, document checks against official requirements, and sharing with agencies.',
    state: 'now',
  },
  {
    label: 'Being switched on',
    title: 'Help that stays in your hands',
    body: 'AI suggestions from your documents and earlier warnings before papers expire, each switched on step by step. The status page shows exactly what works today.',
    state: 'next',
  },
  {
    label: 'Where we are heading',
    title: 'One trusted file for every journey',
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
    <div className="land">
      <section className="land-hero" aria-labelledby="land-hero-title">
        <div className="land-wrap land-hero-grid">
          <div className="land-hero-copy">
            {authError ? (
              <p className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
                Sign-in didn’t complete. Please try again. If it keeps happening, contact support
                and quote reference <strong>{authError}</strong>.
              </p>
            ) : null}
            <span className="land-pill">
              <span className="land-pill-dot" aria-hidden="true" />
              {betaOpen ? 'Public beta' : 'Invite-only pilot'}
            </span>
            <h1 className="land-title" id="land-hero-title">
              {HERO_HEADLINE.slice(0, 12)} <em>{HERO_HEADLINE.slice(13)}</em>
            </h1>
            <p className="land-lede">
              Keep your passport, documents and visa history in one private place, and reuse them
              for every application. Share only what an agency needs, for as long as you choose.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary land-btn" href={startHref}>
                {startLabel}
                <Icon name="arrow" size={18} />
              </a>
              <Link className="btn btn-secondary land-btn" href="/status">
                See what works today
              </Link>
            </div>
            <ul className="land-assure">
              {ASSURANCES.map((item) => (
                <li key={item.text}>
                  <Icon name={item.icon} size={16} />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="land-stage">
            <aside className="hero-preview land-case" aria-label="Example of a case">
              <p className="hero-preview-tag">Example with made-up details</p>
              <div className="land-case-head">
                <span className="land-passport" aria-hidden="true">
                  <Icon name="file" size={28} />
                </span>
                <div>
                  <h2>Visitor visa, example traveller</h2>
                  <p className="muted land-case-count">2 of 4 requirements ready</p>
                </div>
              </div>
              <div className="rows">
                {PREVIEW_ROWS.map((row) => (
                  <div className="row" key={row.name}>
                    <span className="row-key">
                      {row.name}
                      <span className="attention-detail" style={{ display: 'block' }}>
                        {row.detail}
                      </span>
                    </span>
                    <StatusBadge tone={row.tone}>{row.badge}</StatusBadge>
                  </div>
                ))}
              </div>
            </aside>

            <aside className="land-example land-example-ai" aria-label="Example suggestion">
              <p className="land-example-kicker">
                <Icon name="activity" size={14} />
                Suggestion from your passport
              </p>
              <p className="land-example-line">
                Passport number <strong className="mono">X1234567</strong>
              </p>
              <div className="land-example-actions" aria-hidden="true">
                <span className="land-chip land-chip-yes">Approve</span>
                <span className="land-chip">Reject</span>
              </div>
            </aside>

            <aside className="land-example land-example-share" aria-label="Example sharing">
              <p className="land-example-kicker">
                <Icon name="lock" size={14} />
                Shared with Sunrise Visa Services
              </p>
              <p className="land-example-line">3 items, until 30 Nov</p>
              <p className="land-example-note">You can stop this at any time</p>
            </aside>
          </div>
        </div>
      </section>

      <section className="land-summary" aria-labelledby="land-summary-title">
        <div className="land-wrap land-summary-panel">
          <div>
            <p className="land-kicker">A better start</p>
            <h2 id="land-summary-title">
              Your next application
              <br />
              shouldn’t start <em>from zero.</em>
            </h2>
          </div>
          <ul>
            {AFTER.map((line) => (
              <li key={line}>
                <Icon name="check" size={18} />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="land-section land-problem" aria-labelledby="land-problem-title">
        <div className="land-wrap">
          <div className="land-head">
            <p className="land-kicker">The problem</p>
            <h2 className="land-h2" id="land-problem-title">
              Every visa starts with the same scramble
            </h2>
            <p className="land-sub">
              Your life does not change between applications. The paperwork should not have to start
              from zero each time.
            </p>
          </div>
          <div className="land-versus">
            <div className="land-versus-col land-versus-before">
              <p className="land-versus-label">Without one profile</p>
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
      </section>

      <section className="land-section" aria-labelledby="land-how-title">
        <div className="land-wrap">
          <div className="land-head">
            <p className="land-kicker">Three simple steps</p>
            <h2 className="land-h2" id="land-how-title">
              How it works
            </h2>
            <p className="land-sub">Three steps, and the first one only happens once.</p>
          </div>
          <ol className="land-steps">
            {STEPS.map((step, index) => (
              <li className="land-step" key={step.title}>
                <span className="land-step-num" aria-hidden="true">
                  {index + 1}
                </span>
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
      </section>

      <section
        className="land-section land-tint"
        id="capabilities"
        aria-labelledby="land-cap-title"
      >
        <div className="land-wrap">
          <div className="land-head">
            <p className="land-kicker">Everything in one stack</p>
            <h2 className="land-h2" id="land-cap-title">
              What you can do
            </h2>
            <p className="land-sub">
              {betaOpen ? 'VisaStack is in public beta' : 'VisaStack is in a private pilot'}, so
              some features are still being switched on. The status page shows what works today.
            </p>
          </div>
          <div className="land-bento">
            {FEATURES.map((feature) => (
              <article
                className={feature.span ? `land-tile land-tile-${feature.span}` : 'land-tile'}
                key={feature.title}
              >
                <span className="land-tile-icon">
                  <Icon name={feature.icon} size={22} />
                </span>
                <p className="land-step-kicker">{feature.kicker}</p>
                <h3 className="land-h3">{feature.title}</h3>
                <p className="land-body">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="land-section" id="for-agencies" aria-labelledby="land-who-title">
        <div className="land-wrap">
          <div className="land-head">
            <p className="land-kicker">Who it is for</p>
            <h2 className="land-h2" id="land-who-title">
              Calmer for the traveller, clearer for the agency
            </h2>
          </div>
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
      </section>

      <section className="land-section land-trust" aria-labelledby="land-trust-title">
        <div className="land-wrap">
          <div className="land-head">
            <p className="land-kicker">Trust, built in</p>
            <h2 className="land-h2" id="land-trust-title">
              How VisaStack treats your information
            </h2>
            <p className="land-sub">
              These promises are built into how the product works, not options you have to switch
              on.
            </p>
          </div>
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
            <Link href="/trust">Read our public trust page</Link>
          </p>
        </div>
      </section>

      <section className="land-section" aria-labelledby="land-road-title">
        <div className="land-wrap">
          <div className="land-head">
            <p className="land-kicker">The road ahead</p>
            <h2 className="land-h2" id="land-road-title">
              Honest about where we are
            </h2>
            <p className="land-sub">
              {betaOpen
                ? 'Registration is open for public beta, and some features are not switched on yet.'
                : 'This is a private pilot for invited users, and some features are not switched on yet.'}{' '}
              Please use made-up details, or documents with all personal information permanently
              blacked out. Real applicant details are not accepted yet.
            </p>
          </div>
          <ol className="land-horizons">
            {HORIZONS.map((horizon) => (
              <li className={`land-horizon land-horizon-${horizon.state}`} key={horizon.title}>
                <p className="land-horizon-label">
                  {horizon.state === 'now' && betaOpen ? 'Available in beta' : horizon.label}
                </p>
                <h3 className="land-h3">{horizon.title}</h3>
                <p className="land-body">{horizon.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

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
                See what works today
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
