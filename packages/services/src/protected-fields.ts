import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import type { KeyManagementPort } from './ports';

/** Mirrors the `field_sensitivity` Postgres enum (`packages/db/src/schema.ts`). */
export type FieldSensitivity = (typeof schema.fieldSensitivity.enumValues)[number];

/**
 * Application-level authenticated encryption for SENSITIVE/RESTRICTED
 * profile facts (Commercial V1 SEC-03; PRD §14). AES-256-GCM (Node's
 * built-in `crypto`/OpenSSL — never a hand-rolled cipher), a fresh random
 * nonce on every write, and additional authenticated data (AAD) binding
 * subject, record, field, and version — a ciphertext decrypted with
 * mismatched AAD (e.g. copied onto a different fact or applicant) fails
 * authentication rather than silently returning the wrong plaintext.
 *
 * Envelope encryption: a field value is encrypted with a 256-bit DATA key,
 * never directly with a KMS/master key. Exactly one data key exists per
 * `KeyManagementPort` key version; it is generated once, wrapped by the
 * port (so only its wrapped, KMS-ciphertext form is ever persisted — see
 * `data_keys.wrapped_data_key`), and cached in this process after being
 * unwrapped once, so encrypting or decrypting a field does not cost a KMS
 * round trip every time.
 */

const AUTH_TAG_LENGTH = 16;
const NONCE_LENGTH = 12;

/** Which sensitivities require protected-field encryption. STANDARD fields stay plaintext. */
export function requiresProtection(sensitivity: FieldSensitivity): boolean {
  return sensitivity === 'SENSITIVE' || sensitivity === 'RESTRICTED';
}

/**
 * The stable, canonical additional authenticated data for one fact version.
 * No literal "tenant" concept exists at this layer (facts are owned by an
 * individual applicant, not a multi-tenant organization record), so subject
 * (applicantId) is the closest binding this schema actually has; record
 * (factId), field (fieldKey), and version (factVersionId) complete it,
 * matching SEC-03's "AAD binds tenant/subject/record/field/version" as
 * closely as the real data model supports. Exported so every write and read
 * site constructs AAD identically — never ad hoc.
 */
export function buildFactVersionAad(input: {
  readonly applicantId: string;
  readonly factId: string;
  readonly fieldKey: string;
  readonly factVersionId: string;
}): string {
  return `visastack:fact_version:v1:${input.applicantId}:${input.factId}:${input.fieldKey}:${input.factVersionId}`;
}

/** The stable AAD for one account export job's artifact - binds the ciphertext to exactly this job, so it can never be replayed onto a different one. */
export function buildAccountExportAad(input: { readonly jobId: string }): string {
  return `visastack:account_export:v1:${input.jobId}`;
}

/** In-process cache of unwrapped data keys, by key version. Never written to disk/DB in plaintext. */
const unwrappedKeyCache = new Map<string, Buffer>();

/** Clears the in-process unwrapped-key cache. Test-only — production never needs to evict it mid-run. */
export function resetProtectedFieldKeyCacheForTests(): void {
  unwrappedKeyCache.clear();
}

async function getExistingWrappedKey(db: Db, keyVersion: string): Promise<Buffer | undefined> {
  const row = first(
    await db
      .select()
      .from(schema.dataKeys)
      .where(eq(schema.dataKeys.keyVersion, keyVersion))
      .limit(1),
  );
  return row?.wrappedDataKey ? Buffer.from(row.wrappedDataKey) : undefined;
}

/** Get (unwrapping once, then caching) the data key for `keyVersion`, generating and storing it if this is the first use of that version. */
async function getOrCreateDataKey(
  db: Db,
  port: KeyManagementPort,
  keyVersion: string,
): Promise<Buffer> {
  const cached = unwrappedKeyCache.get(keyVersion);
  if (cached) return cached;

  let wrapped = await getExistingWrappedKey(db, keyVersion);
  if (!wrapped) {
    const generated = await port.generateDataKey();
    if (generated.keyVersion !== keyVersion) {
      throw new Error(
        `key management port generated version "${generated.keyVersion}" but "${keyVersion}" was requested`,
      );
    }
    // Insert-or-keep-existing: a concurrent caller may have generated and
    // inserted the same version first. Either wrapped form unwraps to a
    // usable key (both came from the same live port); the primary key
    // guarantees exactly one row survives regardless of which insert wins.
    await db
      .insert(schema.dataKeys)
      .values({ keyVersion, wrappedDataKey: Buffer.from(generated.wrappedDataKey) })
      .onConflictDoNothing();
    wrapped = required(await getExistingWrappedKey(db, keyVersion), 'data key');
  }

  const unwrapped = Buffer.from(await port.unwrapDataKey(keyVersion, wrapped));
  unwrappedKeyCache.set(keyVersion, unwrapped);
  return unwrapped;
}

export interface ProtectedValue {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly keyVersion: string;
}

/** Encrypt one field value under the port's current key version. `aad` should come from `buildFactVersionAad`. */
export async function protectValue(
  db: Db,
  port: KeyManagementPort,
  value: string,
  aad: string,
): Promise<ProtectedValue> {
  const keyVersion = port.currentKeyVersion();
  const dataKey = await getOrCreateDataKey(db, port, keyVersion);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce, keyVersion };
}

export interface RevealValueInput {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly keyVersion: string;
  readonly aad: string;
}

/**
 * Decrypt one field value. Throws if the ciphertext, nonce, key version, or
 * AAD don't all match what was encrypted — GCM authentication failure is a
 * hard error, never a silent wrong-plaintext return.
 */
export async function revealValue(
  db: Db,
  port: KeyManagementPort,
  input: RevealValueInput,
): Promise<string> {
  const dataKey = await getOrCreateDataKey(db, port, input.keyVersion);
  const buf = Buffer.from(input.ciphertext);
  if (buf.length < AUTH_TAG_LENGTH) {
    throw new Error('protected value is too short to contain an auth tag');
  }
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const body = buf.subarray(0, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(input.nonce));
  decipher.setAAD(Buffer.from(input.aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/**
 * Byte-shaped siblings of `protectValue`/`revealValue`, for a payload that
 * is already binary (an export artifact's bytes) rather than a string field
 * value - same envelope-encryption primitive, same data-key cache, same
 * AES-256-GCM/AAD discipline, just no UTF-8 encode/decode at either end.
 * GCM has no meaningful size ceiling at the scale this codebase's export
 * artifacts operate at (spec allows tens of GB per key+nonce).
 */
export async function protectBytes(
  db: Db,
  port: KeyManagementPort,
  value: Uint8Array,
  aad: string,
): Promise<ProtectedValue> {
  const keyVersion = port.currentKeyVersion();
  const dataKey = await getOrCreateDataKey(db, port, keyVersion);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', dataKey, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce, keyVersion };
}

/** Decrypt bytes protected by `protectBytes`. Same hard-failure-on-mismatch behavior as `revealValue`. */
export async function revealBytes(
  db: Db,
  port: KeyManagementPort,
  input: RevealValueInput,
): Promise<Uint8Array> {
  const dataKey = await getOrCreateDataKey(db, port, input.keyVersion);
  const buf = Buffer.from(input.ciphertext);
  if (buf.length < AUTH_TAG_LENGTH) {
    throw new Error('protected value is too short to contain an auth tag');
  }
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const body = buf.subarray(0, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(input.nonce));
  decipher.setAAD(Buffer.from(input.aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
