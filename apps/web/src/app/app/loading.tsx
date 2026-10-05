import { PageLoading } from '../../components/page-loading';

/** Shown while any signed-in page below `/app` that has no closer loading screen reads its data. */
export default function AppLoading() {
  return <PageLoading />;
}
