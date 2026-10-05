import { type CatalogId, isBanglaReviewPending } from '@visastack/i18n';
import type { Translator } from '@visastack/i18n';

/**
 * A one-line notice on a Bangla screen whose wording still needs a professional
 * legal review (consent, privacy, sharing...). It says what is true: the
 * review is not finished, and the English version is there to check against. It
 * appears only in Bangla and only while the catalog's review is not recorded
 * (`packages/i18n/src/review.ts`), so recording a review removes it with no other
 * change. Directive Part 9 section 4: mark it explicitly before public launch.
 */
export function TranslationNotice({
  catalog,
  locale,
  t,
}: {
  readonly catalog: CatalogId;
  readonly locale: string;
  readonly t: Translator;
}) {
  if (locale !== 'bn' || !isBanglaReviewPending(catalog)) return null;
  return (
    <p className="notice" lang="bn" style={{ marginBottom: '1.5rem' }}>
      {t('shell.translationNotice')}
    </p>
  );
}
