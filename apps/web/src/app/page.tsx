import Link from 'next/link';

/**
 * The public home page. Written for a traveller or an agency who has never heard of
 * the product: plain words, what it does and what is honestly not switched on yet.
 * No engineering vocabulary and no names of the tools behind it (guarded by
 * `lib/plain-language.test.ts`).
 */

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
        {authError ? (
          <p className="notice notice-warn" role="alert">
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
          <ul className="pill-list center" style={{ justifyContent: 'center' }}>
            {PROMISES.map((promise) => (
              <li className="pill" key={promise}>
                {promise}
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
