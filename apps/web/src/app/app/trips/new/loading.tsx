import { PageLoading } from '../../../../components/page-loading';

/** Shown while Start a Group Trip reads the travellers on this account. */
export default function GroupTripStartLoading() {
  return <PageLoading label="Loading Start a Group Trip" shape="detail" />;
}
