import Link from 'next/link';
import type { ChangeImpactKey } from '../../../../../i18n/change-impact';
import type { PartsTranslator } from '../../../../../lib/language-parts';

/**
 * Shown in place of the review when it could not be worked out this time. It says that nothing
 * was changed and offers the same address again, so a person can retry without losing their place.
 */
export function ChangeImpactFailed({
  retryHref,
  t,
  titleLevel = 2,
}: {
  /** The address of the review that failed; opening it again reads it again. */
  readonly retryHref: string;
  readonly t: PartsTranslator<ChangeImpactKey>;
  readonly titleLevel?: 2 | 3 | 4;
}) {
  const Title = `h${titleLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <section className="ci-review" aria-labelledby="change-impact-failed-title">
      <Title id="change-impact-failed-title" className="ci-title">
        {t.node('changeImpact.view.failedTitle')}
      </Title>
      <p className="ci-intro">{t.node('changeImpact.view.failedBody')}</p>
      <Link className="btn btn-secondary ci-retry" href={retryHref}>
        {t.node('changeImpact.view.tryAgain')}
      </Link>
    </section>
  );
}
