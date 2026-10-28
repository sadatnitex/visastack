import { PageLoading } from '../../../components/page-loading';

/** Shown while this page reads its data: the outline of a list page, labelled for what is coming. */
export default function NotificationsLoading() {
  return <PageLoading label="Loading your notifications" shape="list" />;
}
