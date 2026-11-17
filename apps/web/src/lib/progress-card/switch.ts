import { readEnv } from '../env';

/**
 * The owner's `PROGRESS_CARD` switch (WP-PIC15, owner decision D5 of 17 Nov 2026). Off unless it
 * says on, in any of the usual spellings. Off: no Share Progress Card control anywhere, and the
 * card address answers exactly like an unknown page.
 */
export function progressCardOn(): boolean {
  const value = (readEnv('PROGRESS_CARD') ?? '').trim().toLowerCase();
  return value === 'on' || value === 'true' || value === '1' || value === 'yes';
}
