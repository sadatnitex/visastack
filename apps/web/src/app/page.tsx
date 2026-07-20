import { CORE_VERSION } from '@visastack/core';
import Link from 'next/link';

interface Capability {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    kicker: 'Identity',
    title: 'Applicant Core',
    body: 'Accounts with separated consent, applicant & family records, and a Master Profile whose every value is an immutable, atomically-approved version — no silent mutation.',
  },
  {
    kicker: 'Documents',
    title: 'Document Vault',
    body: 'Private storage keyed by opaque IDs, permission-aware preview and download, and step-up authentication before original files are ever released.',
  },
  {
    kicker: 'Intelligence',
    title: 'Safe pipeline + AI proposals',
    body: 'Quarantine → scan → normalize → extract, with deterministic passport-MRZ parsing. AI only proposes fields; a human approves — nothing is written without consent.',
  },
  {
    kicker: 'Assembly',
    title: 'Missions & Packs',
    body: 'Cited, versioned, checksummed requirement packs. Parallel mission workspaces show readiness as completeness — never an approval probability — with immutable snapshots.',
  },
  {
    kicker: 'Collaboration',
    title: 'Agencies & Sharing',
    body: 'Verified organizations, scoped and time-limited grants that require acceptance and are revocable next-request, full access transparency, and permissioned bulk export.',
  },
  {
    kicker: 'Governance',
    title: 'Retention & legal hold',
    body: 'Retention policies with eligibility-based purge, and legal holds that override deletion. Every action lands on a tamper-evident, append-only audit chain.',
  },
];

const PRINCIPLES: readonly string[] = [
  'Default-deny permissions',
  'Fail-closed audit',
  'No silent mutation',
  'Immutable, cited evidence',
  'Provider-agnostic ports',
  'Remote-first delivery',
  'English & Bangla',
  'Fully manual, no-AI path',
];

export default function HomePage() {
  return (
    <>
      <section className="hero container">
        <span className="eyebrow">Universal · pack-composable · governed</span>
        <h1 className="hero-title">One profile. Every visa.</h1>
        <p className="hero-sub">
          VisaStack turns documents into structured, permission-aware profiles — through a governed,
          AI-assisted workflow, or a fully manual one. Applicants own their data; verified agencies
          get exactly the access they’re granted.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary" href="/status">
            View system status
          </Link>
          <a
            className="btn btn-secondary"
            href="https://github.com/sadatnitex/visastack"
            rel="noreferrer noopener"
          >
            Explore the source
          </a>
        </div>
      </section>

      <section className="section" id="capabilities">
        <div className="container">
          <div className="section-head">
            <h2 className="section-title">Everything, in one governed core</h2>
            <p className="section-sub">
              Six capability areas are live in production today — each authorized, consent-gated,
              and audited on the same tamper-evident foundation.
            </p>
          </div>
          <div className="grid">
            {CAPABILITIES.map((c) => (
              <article className="card" key={c.title}>
                <p className="card-kicker">{c.kicker}</p>
                <h3 className="card-title">{c.title}</h3>
                <p className="card-body">{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2 className="section-title">Trust is the product</h2>
            <p className="section-sub">
              The guarantees below aren’t features you enable — they’re invariants the system is
              built around and tested against.
            </p>
          </div>
          <ul className="pill-list center" style={{ justifyContent: 'center' }}>
            {PRINCIPLES.map((p) => (
              <li className="pill" key={p}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="container center">
          <h2 className="section-title">Built to be swapped, never rewritten</h2>
          <p className="section-sub" style={{ marginBottom: '2rem' }}>
            Storage, scanning, and AI sit behind stable ports. Today it runs end-to-end on Vercel
            and Neon with zero external accounts; drop in S3, ClamAV, or a model provider later with
            no change to the domain.
          </p>
          <Link className="btn btn-primary" href="/status">
            Check what’s live
          </Link>
          <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.85rem' }}>
            Universal Core v{CORE_VERSION}
          </p>
        </div>
      </section>
    </>
  );
}
