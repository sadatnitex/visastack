import type { Metadata } from 'next';
import { CountriesView } from './countries-view';

export const metadata: Metadata = { title: 'Countries' };

export default function CountriesPage() {
  return (
    <section className="section container">
      <CountriesView href="/app/countries/[code]" />
    </section>
  );
}
