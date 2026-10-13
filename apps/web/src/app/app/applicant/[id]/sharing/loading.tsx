import { PageLoading } from '../../../../../components/page-loading';

/** Shown while this page reads its data: the outline of a list page, labelled for what is coming. */
export default function SharingLoading() {
  return <PageLoading label="Loading who has access" shape="list" frame="panel" />;
}
