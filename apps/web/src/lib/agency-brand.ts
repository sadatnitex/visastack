/**
 * What an agency's brand looks like on screen, worked out in one place: the letters for a mark when there is
 * no logo, the text colour that stays readable on the agency's accent, and a soft tint of it for backgrounds.
 *
 * Everything that shows an agency (the workspace header, the settings preview, an invitation, and later the
 * documents an agency produces for its customers) should take its colours from here, so one change of accent
 * or logo reaches all of them and none can pick a text colour that is hard to read.
 */

/** The dark text colour of the product, used on a light accent. */
const INK = '#152b37';
const WHITE = '#ffffff';

export interface AgencyBrandInput {
  readonly name: string;
  readonly accentColor: string | null;
  readonly logoUrl: string | null;
}

export interface AgencyBrand {
  readonly name: string;
  /** One or two capital letters, for a mark when there is no logo. */
  readonly initials: string;
  /** The agency's accent as `#rrggbb`, or null when it has not chosen one. */
  readonly accent: string | null;
  /** The text colour that reads best on the accent (white or the product's ink). */
  readonly onAccent: string;
  /** The accent at a low strength over white, for a quiet background. Null with no accent. */
  readonly tint: string | null;
  readonly logoUrl: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The text colour with the better contrast on `background`. */
export function readableOn(background: string): string {
  return contrast(background, WHITE) >= contrast(background, INK) ? WHITE : INK;
}

/** `amount` (0 to 1) of `hex` mixed into white, as `#rrggbb`. */
export function tintOf(hex: string, amount: number): string {
  const mixed = channels(hex).map((value) => Math.round(255 - (255 - value) * amount));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Up to two capital letters from an agency's name: "Travel Router" gives "TR", "Skyline" gives "SK". */
export function initialsOf(name: string): string {
  const words = name.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
  const first = words[0];
  if (!first) return '?';
  const second = words[1];
  const letters = second ? `${first[0]}${second[0]}` : first.slice(0, 2);
  return letters.toLocaleUpperCase();
}

export function agencyBrand(input: AgencyBrandInput): AgencyBrand {
  const accent =
    input.accentColor && HEX.test(input.accentColor) ? input.accentColor.toLowerCase() : null;
  return {
    name: input.name,
    initials: initialsOf(input.name),
    accent,
    onAccent: accent ? readableOn(accent) : INK,
    tint: accent ? tintOf(accent, 0.12) : null,
    logoUrl: input.logoUrl,
  };
}
