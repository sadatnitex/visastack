import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

/**
 * Data saver as the browser announces it on every request: the `Save-Data: on` header (Chrome,
 * Edge, Opera and Android browsers with data saver or Lite mode). The root layout reads it so the
 * very first paint already has `data-save-data` on the `html` element and no picture moves, even
 * before any script runs. `SaveDataFlag` keeps following the setting in the browser afterwards.
 */

/** True for a `Save-Data` header value that asks for less data ("on", any case). */
export function saveDataHeaderOn(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'on';
}

/** True when the current request asks for less data. False outside a request (a unit test). */
export async function requestSavesData(): Promise<boolean> {
  try {
    return saveDataHeaderOn((await headers()).get('save-data'));
  } catch (error) {
    // Next's own signals (dynamic rendering) must keep travelling; anything else means no request.
    unstable_rethrow(error);
    return false;
  }
}
