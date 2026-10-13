import { PageLoading } from '../../../components/page-loading';

/** Shown while this page reads its data: the outline of a form page, labelled for what is coming. */
export default function AccountLoading() {
  return <PageLoading label="Loading your account" shape="form" />;
}
