import type { ChangeImpactKey } from '../../../../../i18n/change-impact';
import type { PartsTranslator } from '../../../../../lib/language-parts';
import { ImpactLine } from './change-impact-notice';
import type { ChangeImpactBatch } from './impact-words';

/**
 * What a batch of accepted details affects, shown under the line that says they were saved: the
 * title, then one line for each detail that affects something (its name, the counts and a link to
 * the full list), then, when there are more, one plain line without a link. With no named detail
 * that line stands on its own as a whole sentence. Nothing at all when the batch is absent. Announced politely, never as an alert. It uses no hooks, so the form that
 * shows the saved line can render it as it is.
 */
export function ChangeImpactBatchNotice({
  batch,
  t,
}: {
  readonly batch: ChangeImpactBatch | null | undefined;
  readonly t: PartsTranslator<ChangeImpactKey>;
}) {
  if (!batch || (batch.items.length === 0 && batch.more <= 0)) return null;
  return (
    <output className="ci-notice">
      <strong className="ci-notice-title">{t.node('changeImpact.notice.title')}</strong>
      <ul className="ci-notice-list">
        {batch.items.map((item) => (
          <li key={item.summary.href} className="ci-notice-line">
            <ImpactLine title={item.label} summary={item.summary} t={t} />
          </li>
        ))}
        {batch.more > 0 ? (
          <li className="ci-notice-line ci-notice-more">
            {t.node(
              batch.items.length === 0
                ? 'changeImpact.notice.moreAlone'
                : 'changeImpact.notice.more',
              {
                count: batch.more,
              },
            )}
          </li>
        ) : null}
      </ul>
    </output>
  );
}
