import { PageLoading } from '../../../components/page-loading';

/** Shown while this page reads its data: the outline of a form page, labelled for what is coming. */
export default function PrivacyLoading() {
  return <PageLoading label="Loading your privacy choices" shape="form" />;
}
