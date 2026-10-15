import type { Metadata } from 'next';
import { CountriesView } from '../../../countries/countries-view';

export const metadata: Metadata = { title: 'Countries' };

/** The same country rules the traveller space shows, inside the agency workspace. The agency layout checks membership. */
export default async function AgencyCountriesPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return <CountriesView basePath={`/app/agency/${orgId}/countries`} />;
}
