import { PageLoading } from '../../../components/page-loading';

/** Shown while this page reads its data: the outline of a dashboard page, labelled for what is coming. */
export default function AdminLoading() {
  return <PageLoading label="Loading the platform overview" shape="dashboard" />;
}
