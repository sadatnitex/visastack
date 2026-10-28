/**
 * Calm Core With Depths: the three levels every signed-in screen offers, and the one small
 * cookie that remembers a person's choice per screen family (ADR 0023). This file is plain
 * data and parsing, shared by the server (which renders the saved level so nothing flashes)
 * and the switch in the browser (which saves a new one). The cookie holds level words only.
 */

export const DEPTH_LEVELS = ['glance', 'browse', 'everything'] as const;
export type DepthLevel = (typeof DEPTH_LEVELS)[number];

/** A saved level, or "auto": phones start at Glance, wider screens at Browse. */
export type DepthChoice = DepthLevel | 'auto';

export const DEPTH_FAMILIES = [
  'home',
  'traveller-home',
  'record',
  'documents',
  'profile',
  'expiry',
  'cases',
  'case',
  'evidence-requests',
  'sharing',
  'notifications',
  'privacy',
  'account',
  'agency-home',
  'agency-cases',
] as const;
export type DepthFamily = (typeof DEPTH_FAMILIES)[number];

export const DEPTH_COOKIE = 'vs_depth';
export const DEPTH_COOKIE_PATH = '/app';
export const DEPTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The widest screen that counts as a phone, matching the stylesheet's own breakpoint. */
export const DEPTH_PHONE_QUERY = '(max-width: 760px)';

export type DepthMap = Partial<Record<DepthFamily, DepthLevel>>;

export function isDepthLevel(value: unknown): value is DepthLevel {
  return typeof value === 'string' && (DEPTH_LEVELS as readonly string[]).includes(value);
}

export function isDepthFamily(value: unknown): value is DepthFamily {
  return typeof value === 'string' && (DEPTH_FAMILIES as readonly string[]).includes(value);
}

/** How far down a level reaches: a block at "browse" shows at Browse and Everything. */
export function depthRank(level: DepthLevel): number {
  return DEPTH_LEVELS.indexOf(level);
}

/**
 * Read the cookie value into a map. Anything that is not a known screen family holding a
 * known level word is dropped, so a hand-edited or stale cookie can never reach the page.
 */
export function parseDepthCookie(raw: string | undefined | null): DepthMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const map: DepthMap = {};
  for (const [family, level] of Object.entries(parsed)) {
    if (isDepthFamily(family) && isDepthLevel(level)) map[family] = level;
  }
  return map;
}

export function serializeDepthCookie(map: DepthMap): string {
  return encodeURIComponent(JSON.stringify(map));
}

/** The level a screen starts at for this visitor. */
export function choiceFor(map: DepthMap, family: DepthFamily): DepthChoice {
  return map[family] ?? 'auto';
}

/** What "auto" means on this screen width. */
export function resolveAuto(isPhone: boolean): DepthLevel {
  return isPhone ? 'glance' : 'browse';
}
