import { PageLoading } from '../../../components/page-loading';

/** Shown while the Group Trips page reads the account's trips. */
export default function TripsLoading() {
  return <PageLoading label="Loading Group Trips" shape="detail" />;
}
