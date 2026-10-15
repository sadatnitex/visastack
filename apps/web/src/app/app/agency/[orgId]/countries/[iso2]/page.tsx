import { destinationByIso2 } from '@visastack/core/destinations';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CountryView } from '../../../../countries/country-view';

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ iso2: string }>;
}): Promise<Metadata> {
  const { iso2 } = await params;
  const destination = destinationByIso2(iso2);
  return { title: destination ? destination.country : 'Country' };
}

export default async function AgencyCountryPage({
  params,
}: {
  readonly params: Promise<{ orgId: string; iso2: string }>;
}) {
  const { orgId, iso2 } = await params;
  const destination = destinationByIso2(iso2);
  if (!destination) notFound();
  return <CountryView destination={destination} basePath={`/app/agency/${orgId}/countries`} />;
}
