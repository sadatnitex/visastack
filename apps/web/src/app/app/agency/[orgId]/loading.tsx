import { PageLoading } from '../../../../components/page-loading';

/** Shown inside an agency's console while a section reads its data; the header and the section bar stay put. */
export default function AgencyConsoleLoading() {
  return <PageLoading frame="panel" />;
}
