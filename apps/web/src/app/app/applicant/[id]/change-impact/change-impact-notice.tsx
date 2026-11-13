import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ChangeImpactKey } from '../../../../../i18n/change-impact';
import type { PartsTranslator } from '../../../../../lib/language-parts';
import { type ChangeImpactSummary, hasImpactCounts } from './impact-words';

/**
 * The compact form of What This Change Affects, shown under the line that says a detail was
 * saved: the title, how many things need the person's action, are worth a look or cannot be
 * told, and a link to the full list. A quiet change (a null summary, or nothing to count) shows
 * nothing at all: no notice for a change that affects nothing. When the check itself failed
 * (`unavailable`), one plain line says so instead, claiming nothing about the change. Announced
 * politely, never as an alert. It uses no hooks, so the form that shows the saved line can render
 * it as it is.
 */
export function ChangeImpactNotice({
  summary,
  unavailable = false,
  t,
}: {
  readonly summary: ChangeImpactSummary | null | undefined;
  readonly unavailable?: boolean | undefined;
  readonly t: PartsTranslator<ChangeImpactKey>;
}) {
  if (unavailable && !summary) {
    return <output className="ci-notice">{t.node('changeImpact.notice.unavailable')}</output>;
  }
  if (!summary || !hasImpactCounts(summary)) return null;
  return (
    <output className="ci-notice">
      <ImpactLine title={t.node('changeImpact.notice.title')} summary={summary} t={t} />
    </output>
  );
}

/**
 * One piece of the notice: a name, the counts that need a look, and the link to the full list.
 * The saved-detail notice names itself; the batch notice names each detail. One place for the
 * counts wording, so the two never drift apart.
 */
export function ImpactLine({
  title,
  summary,
  t,
}: {
  readonly title: ReactNode;
  readonly summary: ChangeImpactSummary;
  readonly t: PartsTranslator<ChangeImpactKey>;
}) {
  const { actionRequired, reviewRecommended, unknown } = summary;
  return (
    <>
      <strong className="ci-notice-title">{title}</strong>{' '}
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
    </>
  );
}
