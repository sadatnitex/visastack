import { destinationByIso2 } from '@visastack/core/destinations';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CountryView } from '../country-view';

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ iso2: string }>;
}): Promise<Metadata> {
  const { iso2 } = await params;
  const destination = destinationByIso2(iso2);
  return { title: destination ? destination.country : 'Country' };
}

export default async function CountryPage({
  params,
}: {
  readonly params: Promise<{ iso2: string }>;
}) {
  const { iso2 } = await params;
  const destination = destinationByIso2(iso2);
  if (!destination) notFound();
  return (
    <section className="section container">
      <CountryView destination={destination} backHref="/app/countries" />
    </section>
  );
}
