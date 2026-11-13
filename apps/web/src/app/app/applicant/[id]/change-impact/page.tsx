import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/ui';
import { changeImpactCatalog } from '../../../../../i18n/change-impact';
import {
  readDetailChangeImpact,
  readDocumentChangeImpact,
} from '../../../../../lib/change-impact-read';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { type SearchParamsRecord, firstParam } from '../../../../../lib/paging';
import { ChangeImpactFailed } from './change-impact-failed';
import { ChangeImpactReview } from './change-impact-review';
import { changeImpactHref } from './impact-words';

export const metadata: Metadata = { title: 'What This Change Affects' };

export const dynamic = 'force-dynamic';

/**
 * What This Change Affects, opened again for one change: `?document=<id>` for a replaced
 * document, `?detail=<id>` for a changed detail. Exactly one of the two; anything else is the
 * ordinary not-found, and so is a record the signed-in person may not read (a refusal looks
 * exactly like a missing record). The page only reads: every step is a link to the screen that
 * owns it.
 */
export default async function ChangeImpactPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<
    SearchParamsRecord & {
      readonly document?: string | string[];
      readonly detail?: string | string[];
    }
  >;
}) {
  const locale = await primeLocale();
  const t = getServerT(changeImpactCatalog);
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const documentId = firstParam(query.document);
  const factId = firstParam(query.detail);
  if (Boolean(documentId) === Boolean(factId)) notFound();

  const result = documentId
    ? await readDocumentChangeImpact(id, documentId)
    : await readDetailChangeImpact(id, factId ?? '');
  if (result === 'refused') notFound();

  const back = documentId
    ? { href: `/app/applicant/${id}/documents`, label: t('changeImpact.page.backToDocuments') }
    : { href: `/app/applicant/${id}/profile`, label: t('changeImpact.page.backToProfile') };

  return (
    <>
      <PageHeader title={t('changeImpact.review.title')} back={back} />
      <article className="card">
        {result === 'failed' ? (
          <ChangeImpactFailed
            t={t}
            retryHref={changeImpactHref(
              id,
              documentId
                ? { kind: 'DOCUMENT', id: documentId }
                : { kind: 'DETAIL', id: factId ?? '' },
            )}
          />
        ) : (
          <ChangeImpactReview
            impact={result}
            applicantId={id}
            t={t}
            locale={locale}
            withTitle={false}
          />
        )}
      </article>
    </>
  );
}
