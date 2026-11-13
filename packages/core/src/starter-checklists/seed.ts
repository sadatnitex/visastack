import type { StarterSheetRow } from './build';
import { SHEET_SEED_ROWS } from './seed-rows';
import { NEW_COUNTRY_SEED_ROWS } from './seed-rows-new-countries';

/**
 * Every supplied starter line, in the order an admin loads them: the first sheet (33 countries,
 * with seven of them replaced by the owner's research of 13 November 2026), then the ten countries
 * added that day. All of it is a starter list, not official, and reaches Pack Studio only when an
 * admin loads it.
 */
export const STARTER_SEED_ROWS: readonly StarterSheetRow[] = [
  ...SHEET_SEED_ROWS,
  ...NEW_COUNTRY_SEED_ROWS,
];
