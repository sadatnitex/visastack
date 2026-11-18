import 'server-only';
import type { ReactNode } from 'react';
import { countryNameOf } from '../../lib/country-start';
import { AVAILABLE_FLAG_CODES } from '../flags/available-flags';
import './public-site.css';

const AVAILABLE = new Set(AVAILABLE_FLAG_CODES);

/** The most flags one ring holds; their places on the circle are set in public-site.css. */
export const FLAG_RING_MAX = 12;

/** The codes that have a flag file, lower case, in order, each once, at most FLAG_RING_MAX. */
export function flagRingCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of codes) {
    const code = raw.trim().toLowerCase();
    if (AVAILABLE.has(code)) seen.add(code);
  }
  return [...seen].slice(0, FLAG_RING_MAX);
}

export interface FlagRingProps {
  /** Two-letter country codes from the destination catalogue. Codes without a flag file are left out. */
  readonly codes: readonly string[];
  /** What the ring of flags stands for, read by a screen reader (for example "Countries We Hold"). */
  readonly label: string;
  /** Drawn in the middle of the ring (for example a readiness ring). */
  readonly children?: ReactNode;
  /** The page's language: country names are English, so they are marked so on a Bangla page. */
  readonly pageLang?: string;
}

/**
 * Flags placed on a circle, each a small self-hosted picture loaded lazily (img-src 'self').
 * Server only (enforced): names come from the public destination catalogue, so the browser never
 * loads it.
 */
export function FlagRing({ codes, label, children, pageLang = 'en' }: FlagRingProps) {
  const shown = flagRingCodes(codes);
  return (
    <div className="pub-flag-ring">
      <ul className="pub-flag-ring-list" aria-label={label} data-count={shown.length}>
        {shown.map((code) => (
          <li key={code} data-flag={code}>
            <img
              src={`/flags/${code}.svg`}
              alt={countryNameOf(code.toUpperCase()) ?? code.toUpperCase()}
              width={36}
              height={27}
              loading="lazy"
              decoding="async"
              lang={pageLang === 'en' ? undefined : 'en'}
            />
          </li>
        ))}
      </ul>
      {children ? <div className="pub-flag-ring-centre">{children}</div> : null}
    </div>
  );
}
