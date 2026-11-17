import 'server-only';
import { WebPushSender, createVapidIdentity } from '@visastack/adapters';
import { switchOn } from '@visastack/core';
import type { Db, KeyManagementPort } from '@visastack/services';
import { type PushPort, webPushTableReady } from '@visastack/services/web-push';
import { createKeyManagementPort } from './providers';

/**
 * Web Push as the web app applies it (WP-PIC18). Off unless all of these hold:
 * - `WEB_PUSH` is `true`;
 * - `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` are set,
 *   well formed and belong together;
 * - the field-protection key is configured (the push address is sealed with it);
 * - for anything that stores or reads a subscription, the table exists (migration 0136).
 *
 * Off means: no card on the Account page, the Account actions give one uniform refusal, the
 * notification worker sends no alert and sign-out does no extra work. The private key is read
 * here and nowhere else, and is never logged or put in a message.
 */

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

export function webPushSwitchOn(): boolean {
  return switchOn(readEnv('WEB_PUSH'));
}

/** The field-protection key, or null when it is not configured (or configured wrongly). */
export function webPushKeyPort(): KeyManagementPort | null {
  try {
    return createKeyManagementPort() ?? null;
  } catch {
    return null;
  }
}

function identity() {
  if (!webPushSwitchOn()) return null;
  return createVapidIdentity({
    publicKey: readEnv('WEB_PUSH_VAPID_PUBLIC_KEY'),
    privateKey: readEnv('WEB_PUSH_VAPID_PRIVATE_KEY'),
    subject: readEnv('WEB_PUSH_SUBJECT'),
  });
}

/** The sender for the notification worker, or undefined while Web Push is off. */
export function createPushPort(): PushPort | undefined {
  const vapid = identity();
  if (!vapid || !webPushKeyPort()) return undefined;
  return new WebPushSender({ identity: vapid });
}

export interface WebPushReady {
  /** The public key the browser subscribes with (safe to send to the browser). */
  readonly publicKey: string;
}

/**
 * Whether the Account page may offer alerts: the switch, the keys, the field-protection key and
 * the table. Null when any is missing. A database problem other than a missing table also reads
 * as "not now": the page must render whatever happens here.
 */
export async function webPushReady(db: Db): Promise<WebPushReady | null> {
  const vapid = identity();
  if (!vapid || !webPushKeyPort()) return null;
  try {
    if (!(await webPushTableReady(db))) return null;
  } catch {
    return null;
  }
  return { publicKey: vapid.publicKey };
}
