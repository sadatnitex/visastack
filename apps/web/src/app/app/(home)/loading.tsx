import { PageLoading } from '../../../components/page-loading';

/**
 * Shown while Home reads its data. It lives in this route group so it wraps Home alone: a loading
 * screen above the record pages would make a missing record answer 200 instead of 404.
 */
export default function HomeLoading() {
  return <PageLoading shape="dashboard" label="Loading your home page" />;
}
