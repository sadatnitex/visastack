'use client';

import { useEffect, useRef, useState } from 'react';
import { passportCoverFor } from './nationality';
import { NeutralPassportCover, passportCoverHeight } from './neutral-passport-cover';
import { SaveDataFlag } from './save-data-flag';
import './pictures-depth.css';

/**
 * The passport cover a traveller recognises as their own.
 *
 * A Bangladeshi traveller (owner decision D1, 17 Nov 2026) sees the real Bangladesh passport
 * cover, served from this site (`/pictures/passport-bd.png`, 640 x 910, checked by its SHA-256 in
 * `pictures.test.tsx`). Everyone else sees a neutral drawn cover. If the cover file cannot be
 * shown (missing, blocked, broken), the neutral cover takes its place, so a broken image never
 * shows. Width and height are always set, so the page does not jump while the file loads.
 *
 * The cover is a picture of the TYPE of passport, never of the person's own passport.
 *
 * `nationality` is the profile's saved nationality value, matched by `isBangladeshNationality`.
 */

/** Where the real Bangladesh cover is served from (same site, as `img-src 'self'` requires). */
export const BANGLADESH_COVER_SRC = '/pictures/passport-bd.png';

/** Plain English names, used when the screen passes none. */
export const COVER_LABELS = {
  bangladesh: 'Bangladesh Passport Cover',
  neutral: 'Passport Cover',
} as const;

export interface PassportCoverProps {
  /** The traveller's saved nationality (free text or a country code). */
  readonly nationality: string | null | undefined;
  /** Width in CSS pixels; the height keeps the cover's shape. Default 160. */
  readonly width?: number | undefined;
  /** Accessible name when the cover stands alone. Defaults to the plain name of the cover. */
  readonly label?: string | undefined;
  /** True when the word "Passport" sits right beside it: the cover is then hidden as decoration. */
  readonly decorative?: boolean | undefined;
  /** Adds the soft resting shadow. */
  readonly depth?: boolean | undefined;
  /** Extra classes, for placement or one motion class from `pictures-depth.css`. */
  readonly className?: string | undefined;
}

/** True once an image element has finished trying and has nothing to show. */
function failedToLoad(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth === 0 && image.currentSrc !== '';
}

export function PassportCover({
  nationality,
  width = 160,
  label,
  decorative = false,
  depth = false,
  className,
}: PassportCoverProps) {
  const kind = passportCoverFor(nationality);
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const w = Math.max(24, Math.round(width));
  const extra = [depth ? 'pic-depth' : '', className ?? ''].filter(Boolean).join(' ');

  // An error that happened before the page became interactive fires no onError: check once.
  useEffect(() => {
    if (image.current && failedToLoad(image.current)) setFailed(true);
  }, []);

  if (kind === 'neutral' || failed) {
    return (
      <>
        <NeutralPassportCover
          width={w}
          className={extra || undefined}
          label={decorative ? undefined : (label ?? COVER_LABELS.neutral)}
        />
        <SaveDataFlag />
      </>
    );
  }

  return (
    <>
      <img
        ref={image}
        className={extra ? `pic pic-cover ${extra}` : 'pic pic-cover'}
        data-picture="passport-bd"
        src={BANGLADESH_COVER_SRC}
        width={w}
        height={passportCoverHeight(w)}
        alt={decorative ? '' : (label ?? COVER_LABELS.bangladesh)}
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
      <SaveDataFlag />
    </>
  );
}
