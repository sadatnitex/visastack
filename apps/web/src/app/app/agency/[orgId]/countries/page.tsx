import type { Metadata } from 'next';
import { primeLocale } from '../../../../../lib/i18n-server';
import { CountriesView } from '../../../countries/countries-view';

export const metadata: Metadata = { title: 'Agency Country Rules' };

/** The same country rules the traveller space shows, inside the agency workspace. The agency layout checks membership. */
export default async function AgencyCountriesPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await primeLocale();
  return <CountriesView href={`/app/agency/${orgId}/countries/[code]`} />;
}
