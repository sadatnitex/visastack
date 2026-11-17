import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReactElement } from 'react';
import { flagSrc } from '../flag-policy';
import type { ProgressCardModel } from './card-model';

/** The card's size in pixels: a 4:5 portrait picture, the shape phones share best. */
export const PROGRESS_CARD_WIDTH = 1080;
export const PROGRESS_CARD_HEIGHT = 1350;

/** A flag file is a few kilobytes; anything far larger is not one of ours and is not drawn. */
const MAX_FLAG_BYTES = 64 * 1024;

/**
 * The flag picture for a country code, read from this app's own `public/flags` folder, or null.
 * Only a code the flag policy allows (on the list of flag files, not on the owner's hide-list) is
 * read, and the file name is built from that checked code alone, so no other file can be named.
 * There is no network call: when the folder is not beside the server the card shows the name only.
 * The picture is embedded inside the generated card; no page ever receives a `data:` address.
 */
export async function loadFlagSvg(
  iso2: string,
  publicDir: string = path.join(process.cwd(), 'public'),
): Promise<string | null> {
  const allowed = flagSrc(iso2);
  if (allowed === null) return null;
  const code = allowed.slice('/flags/'.length, -'.svg'.length);
  if (!/^[a-z]{2}$/.test(code)) return null;
  try {
    const bytes = await readFile(path.join(publicDir, 'flags', `${code}.svg`));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FLAG_BYTES) return null;
    const text = bytes.toString('utf8');
    if (!text.includes('<svg')) return null;
    return `data:image/svg+xml;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

const INK = '#0f1f3d';
const MUTED = '#4a5873';
const BRAND = '#1d4c98';
const TRACK = '#dbe5f5';
const PAPER = '#f6f8fc';

const RING_SIZE = 520;
const RING_STROKE = 44;

/**
 * The card as an element for the server's picture maker (next/og). Inline styles only, flex
 * layout only: that is all the picture maker reads. Flat, like the product: no shadow, no gradient.
 * One weight of the picture maker's own font (no font file is shipped), so size alone sets the order.
 */
export function progressCardElement(model: ProgressCardModel, flag: string | null): ReactElement {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (model.percent / 100) * circumference;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '96px 88px 80px',
        background: PAPER,
        color: INK,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 40, color: MUTED, letterSpacing: 2, display: 'flex' }}>
          {model.kicker}
        </div>
        {model.place ? (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 28 }}>
            {flag ? (
              // biome-ignore lint/a11y/useAltText: drawn into a picture that carries its own text alternative
              <img
                src={flag}
                width={88}
                height={88}
                style={{ borderRadius: 44, marginRight: 28, border: `2px solid ${TRACK}` }}
              />
            ) : null}
            <div style={{ fontSize: 72, display: 'flex' }}>{model.place.name}</div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: 'relative',
          width: RING_SIZE,
          height: RING_SIZE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          aria-hidden="true"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={radius}
            fill="none"
            stroke={TRACK}
            strokeWidth={RING_STROKE}
          />
          {model.percent > 0 ? (
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={radius}
              fill="none"
              stroke={BRAND}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          ) : null}
        </svg>
        <div style={{ fontSize: 132, display: 'flex' }}>{`${model.percent}%`}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 64, display: 'flex' }}>{model.countLine}</div>
        <div style={{ fontSize: 34, color: MUTED, marginTop: 24, display: 'flex' }}>
          {model.note}
        </div>
        <div
          style={{
            fontSize: 44,
            color: BRAND,
            marginTop: 56,
            display: 'flex',
          }}
        >
          {model.brand}
        </div>
      </div>
    </div>
  );
}
