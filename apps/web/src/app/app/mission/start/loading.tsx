import { PageLoading } from '../../../../components/page-loading';

/** Shown while the Start a Trip page reads the travellers on this account. */
export default function TripStartLoading() {
  return <PageLoading label="Loading Start a Trip" shape="detail" />;
}
