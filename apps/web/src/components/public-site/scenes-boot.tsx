import 'server-only';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { NONCE_REQUEST_HEADER } from '../../lib/csp';
import { SCENES_BOOT_SCRIPT } from './scene-engine';

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
 * WP-PUB1 (ADR 0029): marks scroll scenes live before the first paint, so a scene has its scroll
 * length from the start and nothing jumps. A fixed string, nonce'd. Without a nonce it is left out
 * (the policy would block it); without JavaScript it never runs and every scene stays a finished
 * section. The root layout reads the nonce with requestNonce() and renders this in its head; the
 * script only sets data-scenes on html, which React does not render, so hydration is untouched.
 */
export function ScenesBoot({ nonce }: { readonly nonce: string | null }) {
  return nonce ? (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string from the engine, no input
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCENES_BOOT_SCRIPT }} />
  ) : null;
}
