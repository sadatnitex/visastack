import type { Metadata } from 'next';
import { primeLocale } from '../../../../lib/i18n-server';
import { CountriesView } from '../countries-view';

export const metadata: Metadata = { title: 'Countries' };

export default async function CountriesPage() {
  await primeLocale();
  return (
    <section className="section container">
      <CountriesView href="/app/countries/[code]" />
    </section>
  );
}
