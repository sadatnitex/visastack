import { PageLoading } from '../../../components/page-loading';

/** Shown while this page reads its data. Nothing under this folder checks a record id. */
export default function Loading() {
  return <PageLoading label="Loading help" />;
}
