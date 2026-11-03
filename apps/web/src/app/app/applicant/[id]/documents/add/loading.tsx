import { PageLoading } from '../../../../../../components/page-loading';

/** Shown while the Add Documents page reads what it needs. */
export default function AddDocumentsLoading() {
  return <PageLoading label="Getting ready to add documents" shape="list" frame="panel" />;
}
