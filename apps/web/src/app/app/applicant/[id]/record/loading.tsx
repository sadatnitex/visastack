import { PageLoading } from '../../../../../components/page-loading';

/** Shown while the Record reads its data: the outline of a list page, labelled for what is coming. */
export default function RecordLoading() {
  return <PageLoading label="Loading your record" shape="list" frame="panel" />;
}
