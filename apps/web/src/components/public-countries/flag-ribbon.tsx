import { AVAILABLE_FLAG_CODES } from '../flags/available-flags';
import '../public-site/public-site.css';

/** The flags a phone keeps in each copy of the band; the rest hide so the page stays short. */
const PHONE_FLAGS = 4;

export interface RibbonFlag {
  readonly code: string;
  readonly name: string;
}

export interface FlagRibbonProps {
  /** Flags to draw, in order; only those with a flag file are kept. */
  readonly flags: readonly RibbonFlag[];
  /** The visible link that makes the ribbon's meaning available without it. */
  readonly href: string;
  readonly linkLabel: string;
  readonly pageLang?: string;
}

/**
 * A band of flags that drifts sideways (pure decoration, hidden from assistive tools). It pauses
 * under a pointer or keyboard focus and stands still, in one row that wraps, without motion. The
 * visible link beside it is the real way to the list, so nothing depends on the moving band.
 */
export function FlagRibbon({ flags, href, linkLabel, pageLang = 'en' }: FlagRibbonProps) {
  const have = new Set(AVAILABLE_FLAG_CODES);
  const shown = flags.filter((flag) => have.has(flag.code.toLowerCase()));
  const pills = (copy: 'a' | 'b') =>
    shown.map((flag, position) => (
      <span
        className={position >= PHONE_FLAGS ? 'r4-pill r4-pill-late' : 'r4-pill'}
        key={`${copy}-${flag.code}`}
        data-copy={copy}
      >
        <img
          src={`/flags/${flag.code.toLowerCase()}.svg`}
          alt=""
          width={32}
          height={24}
          loading="lazy"
          decoding="async"
        />
        <span lang={pageLang === 'en' ? undefined : 'en'}>{flag.name}</span>
      </span>
    ));
  return (
    <div className="r4-ribbon" data-count={shown.length}>
      <div className="r4-ribbon-view" aria-hidden="true">
        <div className="r4-ribbon-track">
          {pills('a')}
          {pills('b')}
        </div>
      </div>
      <a className="pub-button pub-button-secondary r4-ribbon-link" href={href}>
        {linkLabel}
      </a>
    </div>
  );
}
