import Link from 'next/link';
import type { ChangeImpactKey } from '../../../../../i18n/change-impact';
import type { PartsTranslator } from '../../../../../lib/language-parts';
import type { ChangeImpactSummary } from './impact-words';

/**
 * The compact form of What This Change Affects, shown under the line that says a detail was
 * saved: the title, how many things need the person's action, are worth a look or cannot be
 * told, and a link to the full list. A quiet change (a null summary, or nothing to count) shows
 * nothing at all: no notice for a change that affects nothing. Announced politely, never as an
 * alert. It uses no hooks, so the form that shows the saved line can render it as it is.
 */
export function ChangeImpactNotice({
  summary,
  t,
}: {
  readonly summary: ChangeImpactSummary | null | undefined;
  readonly t: PartsTranslator<ChangeImpactKey>;
}) {
  if (!summary) return null;
  const { actionRequired, reviewRecommended, unknown } = summary;
  if (actionRequired + reviewRecommended + unknown === 0) return null;
  return (
    <output className="ci-notice">
      <strong className="ci-notice-title">{t.node('changeImpact.notice.title')}</strong>{' '}
      <span className="ci-notice-counts">
        {actionRequired > 0 ? (
          <span>{t.node('changeImpact.notice.action', { count: actionRequired })} </span>
        ) : null}
        {reviewRecommended > 0 ? (
          <span>{t.node('changeImpact.notice.review', { count: reviewRecommended })} </span>
        ) : null}
        {unknown > 0 ? (
          <span>{t.node('changeImpact.notice.unknown', { count: unknown })} </span>
        ) : null}
      </span>
      <Link className="ci-step" href={summary.href}>
        {t.node('changeImpact.notice.link')}
      </Link>
    </output>
  );
}
