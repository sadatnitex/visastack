import type { ReactNode } from 'react';
import { resolveCaseCountry } from '../lib/case-choices';
import { CountryFlag, type CountryFlagSize } from './country-flag';

/**
 * A destination as a person wrote or picked it, with the flag of the country it names in front.
 * Text that names no country we hold ("Not sure yet") is shown as it is, with no flag, so a flag
 * is never guessed. Server side only (a test keeps client files from importing it): the lookup uses the country list.
 */
export function destinationFlagCode(destination: string | null | undefined): string | null {
  const text = (destination ?? '').trim();
  return text === '' ? null : (resolveCaseCountry(text)?.iso2 ?? null);
}

export function DestinationLabel({
  destination,
  size = 'sm',
  purposeIcon,
}: {
  readonly destination: string | null | undefined;
  readonly size?: CountryFlagSize;
  /** A slot next to the flag for the purpose icon; the visual-language lane fills it. */
  readonly purposeIcon?: ReactNode;
}) {
  const text = (destination ?? '').trim();
  if (text === '') return null;
  const iso2 = destinationFlagCode(text);
  if (!iso2) return <>{text}</>;
  return (
    <span className="country-flag-inline">
      <CountryFlag iso2={iso2} name={text} size={size} decorative />
      {purposeIcon ? <span className="country-flag-purpose">{purposeIcon}</span> : null}
      {text}
    </span>
  );
}
