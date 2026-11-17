import { PageLoading } from '../../../components/page-loading';

/** Shown while the shared files page reads who the files can be for (WP-PIC11). */
export default function IncomingLoading() {
  return <PageLoading shape="list" label="Loading shared files" />;
}
