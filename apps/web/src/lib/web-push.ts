import 'server-only';
import { createHash } from 'node:crypto';
import { type VapidIdentity, WebPushSender, createVapidIdentity } from '@visastack/adapters';
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

let cached: { readonly key: string; readonly identity: VapidIdentity | null } | undefined;

/** The server's push identity, built once per set of key values (re-read if they change). */
function identity(): VapidIdentity | null {
  if (!webPushSwitchOn()) return null;
  const input = {
    publicKey: readEnv('WEB_PUSH_VAPID_PUBLIC_KEY'),
    privateKey: readEnv('WEB_PUSH_VAPID_PRIVATE_KEY'),
    subject: readEnv('WEB_PUSH_SUBJECT'),
  };
  // The cache key is a hash, so the private key is never kept as text beside the built key.
  const key = createHash('sha256')
    .update(`${input.publicKey ?? ''}\n${input.privateKey ?? ''}\n${input.subject ?? ''}`)
    .digest('hex');
  if (cached?.key !== key) cached = { key, identity: createVapidIdentity(input) };
  return cached.identity;
}

/** The sender for the notification worker, or undefined while Web Push is off. */
export function createPushPort(): PushPort | undefined {
  const vapid = identity();
  if (!vapid || !webPushKeyPort()) return undefined;
  return new WebPushSender({ identity: vapid });
}

/**
 * The switch, the keys and the field-protection key, without touching the database: for places
 * that only decide whether to load the small renewal helper.
 */
export function webPushConfigured(): boolean {
  return identity() !== null && webPushKeyPort() !== null;
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
