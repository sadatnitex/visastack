import 'server-only';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { NONCE_REQUEST_HEADER } from '../../lib/csp';
import { SCENES_BOOT_SRC } from './scene-engine';

/**
 * This request's script nonce (lib/csp.ts). With no request to read (a unit test, a static
 * render) the answer is none, as in lib/request-path.ts. Next's own signals keep travelling;
 * anything else falls back to none, so a layout never fails over a first-paint improvement.
 */
export async function requestNonce(): Promise<string | null> {
  try {
    return (await headers()).get(NONCE_REQUEST_HEADER);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/**
 * WP-PUB1 (ADR 0029): loads the early scenes mark (public/scenes-boot.js) in the head, nonce'd and
 * synchronous, so it runs before the first paint. Without a nonce it is left out (the policy would
 * block it); without JavaScript it never runs and every scene stays a finished section. The file
 * only sets data-scenes and data-scene-mode on html (pinned, reveal or gentle; MOT1), which React does
 * not render, so hydration is untouched.
 */
export function ScenesBoot({ nonce }: { readonly nonce: string | null }) {
  // Synchronous on purpose (no async or defer): it must run before the first paint.
  return nonce ? <script src={SCENES_BOOT_SRC} nonce={nonce} /> : null;
}
