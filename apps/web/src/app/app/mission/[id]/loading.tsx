import { PageLoading } from '../../../../components/page-loading';

/** Shown while this page reads its data: the outline of a detail page, labelled for what is coming. */
export default function CaseLoading() {
  return <PageLoading label="Loading your case" shape="detail" />;
}
