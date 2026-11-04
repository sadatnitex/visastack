import { PageLoading } from '../../../../../components/page-loading';

/** Shown while the page reads the details found in the documents. */
export default function ReviewLoading() {
  return <PageLoading label="Getting the details we found" shape="list" frame="panel" />;
}
