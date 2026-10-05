import { PageLoading } from '../../../../components/page-loading';

/**
 * Shown inside an applicant's workspace while a tab reads its data. The
 * workspace header and tabs stay on screen, so only the content area changes.
 */
export default function ApplicantLoading() {
  return <PageLoading frame="panel" />;
}
