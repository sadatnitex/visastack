import type { Locale } from '@visastack/i18n';
import type { ChangeImpact, ImpactItem, ImpactOutcome } from '@visastack/services';
import Link from 'next/link';
import type { ChangeImpactKey } from '../../../../../i18n/change-impact';
import type { PartsTranslator } from '../../../../../lib/language-parts';
import {
  SECTION_HEADINGS,
  SECTION_ORDER,
  aboutWords,
  impactSentence,
  introMessage,
  messageParams,
  stepLink,
} from './impact-words';

export interface ChangeImpactReviewProps {
  readonly impact: ChangeImpact;
  readonly applicantId: string;
  /** The translator for the change-impact catalogue (`getServerT` on a page, `useT` in a panel). */
  readonly t: PartsTranslator<ChangeImpactKey>;
  readonly locale: Locale;
  /** The heading level of the title; each section's heading is one below. Defaults to 2. */
  readonly titleLevel?: 2 | 3 | 4;
  /** False where the page header already carries the title: sections then take `titleLevel`. */
  readonly withTitle?: boolean;
  /** Starts every id in the review, so two reviews on one screen never share one. */
  readonly idPrefix?: string;
}

type HeadingTag = 'h2' | 'h3' | 'h4' | 'h5';

/**
 * What This Change Affects: what replacing a document, or changing a confirmed detail, means for
 * live cases, for what was already sent to agencies, for sharing, and for finished work. It is a
 * list to read. It performs nothing: each next step is a link to the screen that owns it (the
 * case, the request, sharing), and the closing line says so.
 *
 * Sections follow the contract's order and only those with something in them appear. Records that
 * need nothing are folded away. A change that affects nothing gets one calm line and no alert.
 * It uses no hooks, so the same component renders on a page and inside a panel in the browser.
 */
export function ChangeImpactReview({
  impact,
  applicantId,
  t,
  locale,
  titleLevel = 2,
  withTitle = true,
  idPrefix = 'change-impact',
}: ChangeImpactReviewProps) {
  const Title = `h${titleLevel}` as HeadingTag;
  const SectionTitle = `h${withTitle ? titleLevel + 1 : titleLevel}` as HeadingTag;
  const titleId = `${idPrefix}-title`;
  const intro = introMessage(impact);
  const sections = SECTION_ORDER.map((outcome) => ({
    outcome,
    items: impact.items.filter((item) => item.outcome === outcome),
  })).filter((section) => section.items.length > 0);

  const list = (outcome: ImpactOutcome, items: readonly ImpactItem[]) => (
    <ul className="ci-list">
      {items.map((item, index) => {
        const about = aboutWords(item.about);
        const sentence = impactSentence(item, impact.subject.kind, impact.phase);
        const step = stepLink(item, applicantId);
        const aboutId = `${idPrefix}-${outcome.toLowerCase()}-${index + 1}`;
        return (
          <li key={item.id} className="ci-item" data-reason={item.reason}>
            <p id={aboutId} className="ci-about">
              <span className="ci-about-kind">{t.node(about.kind)}</span>{' '}
              <strong className="ci-about-name">
                {about.nameKey ? t.node(about.nameKey) : about.name}
              </strong>
            </p>
            {about.forCase ? (
              <p className="ci-about-case">
                {t.node('changeImpact.about.forCase', { case: about.forCase })}
              </p>
            ) : null}
            <p className="ci-why">{t.node(sentence.key, messageParams(sentence, locale))}</p>
            {step ? (
              <Link className="ci-step" href={step.href} aria-describedby={aboutId}>
                {t.node(step.label)}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section
      className="ci-review"
      data-phase={impact.phase}
      {...(withTitle
        ? { 'aria-labelledby': titleId }
        : { 'aria-label': t('changeImpact.review.title') })}
    >
      {withTitle ? (
        <Title id={titleId} className="ci-title">
          {t.node('changeImpact.review.title')}
        </Title>
      ) : null}
      <p className="ci-intro">{t.node(intro.key, messageParams(intro, locale))}</p>
      {impact.complete ? null : (
        <p className="ci-incomplete">{t.node('changeImpact.review.incomplete')}</p>
      )}
      {impact.quiet ? (
        <p className="ci-quiet">
          {t.node(
            impact.items.length === 0
              ? 'changeImpact.review.quiet'
              : 'changeImpact.review.quietWithItems',
          )}
        </p>
      ) : null}
      {sections.map(({ outcome, items }) =>
        outcome === 'NO_ACTION' ? (
          <details key={outcome} className="ci-fold" data-outcome={outcome}>
            <summary className="ci-fold-summary">
              {t.node(SECTION_HEADINGS[outcome])} <span className="ci-count">({items.length})</span>
            </summary>
            {list(outcome, items)}
          </details>
        ) : (
          <section
            key={outcome}
            className="ci-section"
            data-outcome={outcome}
            aria-labelledby={`${idPrefix}-${outcome.toLowerCase()}`}
          >
            <SectionTitle id={`${idPrefix}-${outcome.toLowerCase()}`} className="ci-section-title">
              {t.node(SECTION_HEADINGS[outcome])}
            </SectionTitle>
            {list(outcome, items)}
          </section>
        ),
      )}
      <p className="ci-closing">{t.node('changeImpact.review.closing')}</p>
    </section>
  );
}
