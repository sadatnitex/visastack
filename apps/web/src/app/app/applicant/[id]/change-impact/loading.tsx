import { PageLoading } from '../../../../../components/page-loading';

/** Shown while the review is worked out; the workspace header and tabs stay on screen. */
export default function ChangeImpactLoading() {
  return <PageLoading frame="panel" />;
}
