import { resolveCaseCountry } from '../lib/case-choices';
import { CountryFlag, type CountryFlagSize } from './country-flag';

/**
 * A destination as a person wrote or picked it, with the flag of the country it names in front.
 * Text that names no country we hold ("Not sure yet") is shown as it is, with no flag, so a flag
 * is never guessed. Server side only: the lookup uses the country list.
 */
export function destinationFlagCode(destination: string | null | undefined): string | null {
  const text = (destination ?? '').trim();
  return text === '' ? null : (resolveCaseCountry(text)?.iso2 ?? null);
}

export function DestinationLabel({
  destination,
  size = 'sm',
}: {
  readonly destination: string | null | undefined;
  readonly size?: CountryFlagSize;
}) {
  const text = (destination ?? '').trim();
  if (text === '') return null;
  const iso2 = destinationFlagCode(text);
  if (!iso2) return <>{text}</>;
  return (
    <span className="country-flag-inline">
      <CountryFlag iso2={iso2} name={text} size={size} decorative />
      {text}
    </span>
  );
}
