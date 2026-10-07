import Link from 'next/link';
import { Icon } from '../components/icons';
import { StatusBadge, type Tone } from '../components/ui';

/**
 * The public home page. Written for a traveller or an agency who has never heard of
 * the product: plain words, what it does and what is honestly not switched on yet.
 * No engineering vocabulary and no names of the tools behind it (guarded by
 * `lib/plain-language.test.ts`).
 */

const PREVIEW_ROWS: readonly {
  readonly name: string;
  readonly detail: string;
  readonly status: string;
  readonly tone: Tone;
}[] = [
  { name: 'Passport', detail: 'Valid until 14 Mar 2031', status: 'Ready', tone: 'success' },
  {
    name: 'Bank statement',
    detail: 'Expires in 12 days',
    status: 'Expiring soon',
    tone: 'warning',
  },
  { name: 'Employer letter', detail: 'Asked for by the agency', status: 'Missing', tone: 'danger' },
  { name: 'Hotel booking', detail: 'Sent 3 Oct 2026', status: 'Under review', tone: 'neutral' },
];

interface Feature {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
}

const FEATURES: readonly Feature[] = [
  {
    kicker: 'Profile',
    title: 'One profile for every application',
    body: 'Enter your details once: identity, passport, travel history, work and money. Every change is saved as a new version, so nothing is quietly overwritten.',
  },
  {
    kicker: 'Documents',
    title: 'A private place for your papers',
    body: 'Upload passports, bank statements and other documents. Only you and the people you choose can open them, and original files are never handed out without extra identity confirmation.',
  },
  {
    kicker: 'Suggestions',
    title: 'AI can help, but never decides',
    body: 'AI can suggest details from a document, and you approve or reject each one. Nothing changes without your say. Prefer to type it yourself? Everything also works by hand.',
  },
  {
    kicker: 'Cases',
    title: 'See what is still missing',
    body: 'Check your documents against the official requirements for a visa route. You see how complete your file is and what is missing, never a guess at your chances of approval.',
  },
  {
    kicker: 'Agencies',
    title: 'Share with an agency, on your terms',
    body: 'Choose what an agency can see and for how long. They have to accept, you can stop sharing at any time, and you can see who looked at what.',
  },
  {
    kicker: 'Privacy',
    title: 'Your data stays yours',
    body: 'Your information is kept only as long as it is needed, and you can ask for it to be deleted. If the law says it must be kept, deletion waits. Every action is written to a record that cannot be quietly changed.',
  },
];

const PROMISES: readonly string[] = [
  'Nobody sees your information unless you allow it',
  'Every action is recorded',
  'Changes are kept as new versions',
  'Official information shows where it came from',
  'AI never changes your profile on its own',
  'A fully manual way to use everything',
];

const STEPS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Add your details once',
    body: 'Fill in your profile and upload your documents. Each change is saved with its date, so you can always see what was added and when.',
  },
  {
    title: 'See what is missing',
    body: 'Pick a visa route and check your file against its requirements. You see what is complete, what is missing and what is close to expiring.',
  },
  {
    title: 'Share only what is needed',
    body: 'Invite an agency to see specific items for a set time. You approve it, you can stop it, and you can see what they opened.',
  },
];

interface Audience {
  readonly who: string;
  readonly title: string;
  readonly points: readonly string[];
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
  },
  {
    who: 'For agencies',
    title: 'Stop chasing documents by message',
    points: [
      'Ask a client for a specific document and see when it arrives',
      'Open a case and see at once what is missing or overdue',
      'Keep a clear record of who did what, and when',
    ],
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

  return (
    <>
      <section className="hero container">
        <div>
          {authError ? (
            <p className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
              Sign-in didn’t complete. Please try again. If it keeps happening, contact support and
              quote reference <strong>{authError}</strong>.
            </p>
          ) : null}
          <span className="eyebrow">Invite-only pilot</span>
          <h1 className="hero-title">One profile. Every visa.</h1>
          <p className="hero-sub">
            Keep your passport, documents and visa history in one private place, and reuse them for
            every application. Share only what an agency needs, for as long as you choose.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="/app">
              Sign in to get started
            </a>
            <Link className="btn btn-secondary" href="/status">
              See what works today
            </Link>
          </div>
        </div>

        <aside className="hero-preview" aria-label="Example of a case">
          <p className="hero-preview-tag">Example with made-up details</p>
          <h2>Visitor visa, example traveller</h2>
          <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
            2 of 4 requirements ready
          </p>
          <div className="meter" aria-hidden="true" style={{ marginBottom: '0.75rem' }}>
            <div className="meter-fill" style={{ width: '50%' }} />
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
                <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2 className="section-title">How it works</h2>
          </div>
          <ol className="grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {STEPS.map((step, index) => (
              <li className="card" key={step.title}>
                <p className="card-kicker">Step {index + 1}</p>
                <h3 className="card-title">{step.title}</h3>
                <p className="card-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid">
            {AUDIENCES.map((audience) => (
              <article className="card" key={audience.who}>
                <p className="card-kicker">{audience.who}</p>
                <h3 className="card-title">{audience.title}</h3>
                <ul className="fact-line" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                  {audience.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="capabilities">
        <div className="container">
          <div className="section-head">
            <h2 className="section-title">What you can do</h2>
            <p className="section-sub">
              VisaStack is in a private pilot, so some features are still being switched on. The
              status page shows what works today.
            </p>
          </div>
          <div className="grid">
            {FEATURES.map((feature) => (
              <article className="card" key={feature.title}>
                <p className="card-kicker">{feature.kicker}</p>
                <h3 className="card-title">{feature.title}</h3>
                <p className="card-body">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2 className="section-title">How VisaStack treats your information</h2>
            <p className="section-sub">
              These promises are built into how the product works, not options you have to switch
              on.
            </p>
          </div>
          <ul className="promise-grid">
            {PROMISES.map((promise) => (
              <li key={promise}>
                <Icon name="check" size={18} />
                <span>{promise}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container center">
          <h2 className="section-title">Honest about where we are</h2>
          <p className="section-sub" style={{ marginBottom: '2rem' }}>
            This is a private pilot for invited users, and some features are not switched on yet.
            Please use made-up details, or documents with all personal information blacked out,
            until the pilot opens up.
          </p>
          <Link className="btn btn-primary" href="/status">
            See what works today
          </Link>
        </div>
      </section>
    </>
  );
}
