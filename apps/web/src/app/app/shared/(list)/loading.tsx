import { PageLoading } from '../../../../components/page-loading';

/** Shown while this page reads its data: the outline of a list page, labelled for what is coming. */
export default function SharedLoading() {
  return <PageLoading label="Loading what was shared with you" shape="list" />;
}
