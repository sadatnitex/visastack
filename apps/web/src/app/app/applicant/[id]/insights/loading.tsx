import { PageLoading } from '../../../../../components/page-loading';

/** Shown while the insights are worked out: the outline of a dashboard, labelled for what is coming. */
export default function DocumentInsightsLoading() {
  return <PageLoading label="Loading your document insights" shape="dashboard" frame="panel" />;
}
