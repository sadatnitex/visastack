import type { DeploymentMode } from '@visastack/core';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Accordion } from '../components/landing/accordion';
import {
  type Destination,
  LandingPlanner,
  type Msg,
  type PlanWords,
  PlannerForm,
  PlannerPlan,
} from '../components/landing/planner';
import { landingCatalog } from '../i18n/landing';
import type { LandingKey } from '../i18n/landing-messages';
import { getPageLanguage, getServerT } from '../lib/i18n-server';
import { landingStatus } from '../lib/landing-status';
import './home-landing.css';

/**
 * The home page as the owner-approved homepage tells it (Harbor Blue folio): a Bangladesh-focused
 * first screen with the destination planner, the plan it opens, a row of sources, privacy and
 * status, a sample family case, the reusable record with a passport renewal, the agency request
 * workflow, the common questions and one closing action.
 *
 * Every example is made up and says so. The page makes no promise the product does not keep: it
 * prepares and shares documents, and the issuing authority decides the visa. All words come from
 * `i18n/landing.ts` (English and Bengali); a message held for review shows in English marked
 * `lang="en"`, so a Bengali page never labels English as Bengali. Needs `primeLocale()` first.
 */

export interface HomeLandingProps {
  /** A sign-in problem notice from a failed sign-in, shown above the first screen. */
  readonly alert?: ReactNode;
  /** The suggested destinations: the catalogue's country name (sent) and its name in the visitor's language (shown). */
  readonly destinations: readonly Destination[];
  readonly deploymentMode: DeploymentMode;
  readonly registrationOpen: boolean;
  /** The account action the visitor's session and the registration switch decide. */
  readonly start: { readonly label: ReactNode; readonly href: string };
  /** The pilot or beta words, as the banner and the legal pages say them. */
  readonly notice: ReactNode;
  /** The status page's established name ("See What Works Today"), with its Bangla words. */
  readonly statusLabel: ReactNode;
}

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

type T = ReturnType<typeof getServerT<LandingKey>>;

/** A message as a `Msg` for the planner: its text and, when it is not in the page's language, which one. */
const msg = (t: T, key: LandingKey, params?: Record<string, string | number>): Msg => ({
  text: t(key, params),
  ...t.lang(key),
});

/**
 * A sentence with a link inside it. The sentence is one message holding `{link}`, so each language
 * orders its own words; the link carries its own message and address. A sentence not in the page's
 * language is wrapped once in its own `lang`, and then the link, whose words may be in the page's
 * language, names its own language too (a Bengali link inside an English sentence is marked Bengali).
 */
function Sentence({
  t,
  text,
  link,
}: {
  readonly t: T;
  readonly text: LandingKey;
  readonly link: { readonly key: LandingKey; readonly href: string };
}) {
  const [before = '', after = ''] = t(text).split('{link}');
  const { lang } = t.lang(text);
  const own = t.lang(link.key).lang ?? (lang ? getPageLanguage() : undefined);
  const inner = (
    <>
      {before}
      <Link href={link.href} {...(own ? { lang: own } : {})}>
        {t(link.key)}
      </Link>
      {after}
    </>
  );
  return lang ? <span lang={lang}>{inner}</span> : inner;
}

const CASE_ITEMS = [
  {
    name: 'landing.case.passportName',
    pill: 'landing.case.passportPill',
    body: 'landing.case.passportBody',
    tone: 'positive',
  },
  {
    name: 'landing.case.letterName',
    pill: 'landing.case.letterPill',
    body: 'landing.case.letterBody',
    tone: 'warn',
  },
  {
    name: 'landing.case.requestName',
    pill: 'landing.case.requestPill',
    body: 'landing.case.requestBody',
    tone: 'plain',
  },
] as const satisfies readonly {
  name: LandingKey;
  pill: LandingKey;
  body: LandingKey;
  tone: string;
}[];

const HISTORY_ROWS = [
  {
    term: 'landing.history.previousTerm',
    name: 'landing.history.previousName',
    body: 'landing.history.previousBody',
  },
  {
    term: 'landing.history.currentTerm',
    name: 'landing.history.currentName',
    body: 'landing.history.currentBody',
  },
  {
    term: 'landing.history.nextTerm',
    name: 'landing.history.nextName',
    body: 'landing.history.nextBody',
  },
] as const satisfies readonly { term: LandingKey; name: LandingKey; body: LandingKey }[];

const FAQ = [
  { q: 'landing.faq.q1', a: 'landing.faq.a1' },
  { q: 'landing.faq.q2', a: 'landing.faq.a2' },
  { q: 'landing.faq.q3', a: 'landing.faq.a3', link: '/trust' },
  { q: 'landing.faq.q4', a: 'landing.faq.a4' },
] as const;

export function HomeLanding({
  alert,
  destinations,
  deploymentMode,
  registrationOpen,
  start,
  notice,
  statusLabel,
}: HomeLandingProps) {
  const t = getServerT(landingCatalog);
  const status = landingStatus(deploymentMode, registrationOpen);
  const planWords: PlanWords = {
    kicker: msg(t, 'landing.plan.kicker'),
    title: msg(t, 'landing.plan.title'),
    fallbackTitle: msg(t, 'landing.plan.titleFallback'),
    intro: msg(t, 'landing.plan.intro'),
    partyLabel: msg(t, 'landing.plan.partyLabel'),
    self: msg(t, 'landing.plan.self'),
    family: msg(t, 'landing.plan.family'),
    steps: {
      self: [
        { lead: msg(t, 'landing.plan.sourceLead'), body: msg(t, 'landing.plan.sourceBody') },
        {
          lead: msg(t, 'landing.plan.selfCopiesLead'),
          body: msg(t, 'landing.plan.selfCopiesBody'),
        },
        { lead: msg(t, 'landing.plan.howLead'), body: msg(t, 'landing.plan.howBody') },
      ],
      family: [
        { lead: msg(t, 'landing.plan.sourceLead'), body: msg(t, 'landing.plan.sourceBody') },
        {
          lead: msg(t, 'landing.plan.familyCopiesLead'),
          body: msg(t, 'landing.plan.familyCopiesBody'),
        },
        { lead: msg(t, 'landing.plan.howLead'), body: msg(t, 'landing.plan.howBody') },
      ],
    },
    guide: msg(t, 'landing.plan.guide'),
    guideFallback: msg(t, 'landing.plan.guideFallback'),
  };
  return (
    <div className="lp">
      {alert}
      <LandingPlanner
        statusWords={{
          self: msg(t, 'landing.plan.announceSelf'),
          family: msg(t, 'landing.plan.announceFamily'),
        }}
      >
        <section className="lp-hero" aria-labelledby="lp-title" id="capabilities">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-content">
              <p className="lp-kicker">
                {/* The flag file is the site's own, the same one the country guides draw. Low priority, so the
                    folio below is the one picture the browser is told to fetch first. */}
                <img src="/flags/bd.svg" width={22} height={14} alt="" fetchPriority="low" />
                {t.node('landing.hero.kicker')}
              </p>
              <h1 id="lp-title">
                {t.node('landing.hero.titleLead')} <em>{t.node('landing.hero.titleEm')}</em>
              </h1>
              <p className="lp-lead">{t.node('landing.hero.lead')}</p>
              <PlannerForm
                words={{
                  label: msg(t, 'landing.planner.label'),
                  placeholder: msg(t, 'landing.planner.placeholder'),
                  submit: msg(t, 'landing.planner.submit'),
                }}
                destinations={destinations}
                footer={
                  <>
                    <span>{t.node('landing.planner.noAccount')}</span>
                    <Link href="/countries">{t.node('landing.planner.browse')}</Link>
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
                <strong>{t.node('landing.hero.caption')}</strong>
              </figcaption>
            </figure>
          </div>
        </section>

        <PlannerPlan words={planWords} destinations={destinations} />
      </LandingPlanner>

      <section
        className="lp-assurance"
        id="sources"
        aria-label={t('landing.assurance.region')}
        {...t.lang('landing.assurance.region')}
      >
        <div className="lp-wrap lp-assurance-grid">
          <article>
            <LineIcon kind="source" />
            <div>
              <strong>{t.node('landing.assurance.sourceText')}</strong>
              <Link href="/countries">{t.node('landing.assurance.sourceLink')}</Link>
            </div>
          </article>
          <article>
            <LineIcon kind="lock" />
            <div>
              <strong>{t.node('landing.assurance.shareText')}</strong>
              <Link href="/trust">{t.node('landing.assurance.shareLink')}</Link>
            </div>
          </article>
          <article>
            <LineIcon kind="status" />
            <div>
              <strong>{t.node(status.assurance)}</strong>
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
      >
        <div className="lp-process-copy" id="how-it-works">
          <p className="lp-kicker">{t.node('landing.prepare.kicker')}</p>
          <h2 id="lp-process-title">
            {t.node('landing.prepare.titleLead')}
            <br />
            <em>{t.node('landing.prepare.titleEm')}</em>
          </h2>
          <p {...t.lang('landing.prepare.body')}>{t('landing.prepare.body')}</p>
          <Link className="lp-text-link" href="/how-it-works">
            {t.node('landing.prepare.link')}
          </Link>
        </div>
        <div className="lp-case">
          <header className="lp-case-head">
            <div>
              <strong>{t.node('landing.case.name')}</strong>
              <span>{t.node('landing.case.example')}</span>
            </div>
            <span className="lp-pill">{t.node('landing.case.view')}</span>
          </header>
          {CASE_ITEMS.map((item, index) => (
            <Accordion
              group="lp-case"
              defaultOpen={index === 0}
              key={item.name}
              summary={
                <>
                  <span>{t.node(item.name)}</span>
                  <span
                    className={
                      item.tone === 'positive'
                        ? 'lp-pill lp-positive'
                        : item.tone === 'warn'
                          ? 'lp-pill lp-warn'
                          : 'lp-pill'
                    }
                  >
                    {t.node(item.pill)}
                  </span>
                </>
              }
            >
              <p {...t.lang(item.body)}>{t(item.body)}</p>
            </Accordion>
          ))}
          <p className="lp-case-foot" {...t.lang('landing.case.foot')}>
            {t('landing.case.foot')}
          </p>
        </div>
      </section>

      <section
        className="lp-record"
        id="your-record"
        aria-labelledby="lp-record-title"
        tabIndex={-1}
      >
        <div className="lp-wrap lp-record-grid">
          <div>
            <p className="lp-kicker">{t.node('landing.record.kicker')}</p>
            <h2 id="lp-record-title">{t.node('landing.record.title')}</h2>
            <p {...t.lang('landing.record.bodyOne')}>{t('landing.record.bodyOne')}</p>
            <p {...t.lang('landing.record.bodyTwo')}>{t('landing.record.bodyTwo')}</p>
          </div>
          <div className="lp-history">
            <header>
              <strong>{t.node('landing.history.name')}</strong>
              <span className="lp-pill">{t.node('landing.history.example')}</span>
            </header>
            <dl>
              {HISTORY_ROWS.map((row) => (
                <div key={row.term}>
                  <dt>{t.node(row.term)}</dt>
                  <dd>
                    <strong>{t.node(row.name)}</strong>
                    <span {...t.lang(row.body)}>{t(row.body)}</span>
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
      >
        <div className="lp-wrap lp-agency-grid">
          <div>
            <p className="lp-kicker">{t.node('landing.agency.kicker')}</p>
            <h2 id="lp-agency-title">{t.node('landing.agency.title')}</h2>
          </div>
          <div>
            <p {...t.lang('landing.agency.body')}>{t('landing.agency.body')}</p>
            <Link className="lp-button lp-primary" href="/for-agencies">
              {t.node('landing.agency.button')}
            </Link>
          </div>
        </div>
      </section>

      <section
        id="questions"
        className="lp-faq lp-wrap"
        aria-labelledby="lp-faq-title"
        tabIndex={-1}
      >
        <h2 id="lp-faq-title">{t.node('landing.faq.title')}</h2>
        <div className="lp-faq-items">
          {FAQ.map((item) => (
            <Accordion key={item.q} summary={t.node(item.q)}>
              {'link' in item ? (
                <p>
                  <Sentence
                    t={t}
                    text={item.a}
                    link={{ key: 'landing.faq.a3Link', href: item.link }}
                  />
                </p>
              ) : (
                <p {...t.lang(item.a)}>{t(item.a)}</p>
              )}
            </Accordion>
          ))}
          <Accordion summary={t.node('landing.faq.q5')}>
            <p>
              <Sentence
                t={t}
                text={status.answer}
                link={{ key: 'landing.faq.statusLink', href: '/status' }}
              />
            </p>
          </Accordion>
        </div>
      </section>

      <section className="lp-close" id="start" aria-labelledby="lp-close-title">
        <div className="lp-wrap lp-close-inner">
          <h2 id="lp-close-title">{t.node('landing.close.title')}</h2>
          <div className="lp-close-actions">
            <a className="lp-button lp-primary" href="#planner">
              {t.node('landing.close.choose')}
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
