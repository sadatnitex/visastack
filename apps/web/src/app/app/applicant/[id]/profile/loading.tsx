import { PageLoading } from '../../../../../components/page-loading';

/** Shown while this page reads its data: the outline of a form page, labelled for what is coming. */
export default function ProfileLoading() {
  return <PageLoading label="Loading your profile" shape="form" frame="panel" />;
}
