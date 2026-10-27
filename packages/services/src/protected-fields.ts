import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
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

interface StoredDataKey {
  readonly wrapped: Buffer;
  readonly wrappingKeyId: string | null;
}

async function getExistingWrappedKey(
  db: Db,
  keyVersion: string,
): Promise<StoredDataKey | undefined> {
  // One read for the key and the id of the key that wrapped it, so a re-wrap between two reads
  // can never pair a new blob with an old id. The id comes out of the row as JSON: a database
  // where migration 0093 has not run yet has no such column, and naming it directly would fail
  // (and abort the surrounding transaction); this reads as null, which is truthfully "local".
  const row = first(
    await db
      .select({
        wrappedDataKey: schema.dataKeys.wrappedDataKey,
        wrappingKeyId: sql<string | null>`to_jsonb(${schema.dataKeys})->>'wrapping_key_id'`,
      })
      .from(schema.dataKeys)
      .where(eq(schema.dataKeys.keyVersion, keyVersion))
      .limit(1),
  );
  if (!row?.wrappedDataKey) return undefined;
  return { wrapped: Buffer.from(row.wrappedDataKey), wrappingKeyId: row.wrappingKeyId ?? null };
}

/** Get (unwrapping once, then caching) the data key for `keyVersion`, generating and storing it if this is the first use of that version. */
async function getOrCreateDataKey(
  db: Db,
  port: KeyManagementPort,
  keyVersion: string,
): Promise<Buffer> {
  const cached = unwrappedKeyCache.get(keyVersion);
  if (cached) return cached;

  let stored = await getExistingWrappedKey(db, keyVersion);
  if (!stored) {
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
    if (generated.wrappingKeyId) {
      // The key service records who wrapped it; this needs migration 0093 to have run.
      await db
        .insert(schema.dataKeys)
        .values({
          keyVersion,
          wrappedDataKey: Buffer.from(generated.wrappedDataKey),
          wrappingKeyId: generated.wrappingKeyId,
        })
        .onConflictDoNothing();
    } else {
      // The local key records nothing extra, and this statement names only the original
      // columns, so it also works on a database that has not had migration 0093 yet.
      await db.execute(
        sql`insert into data_keys (key_version, wrapped_data_key) values (${keyVersion}, ${Buffer.from(generated.wrappedDataKey)}) on conflict (key_version) do nothing`,
      );
    }
    stored = required(await getExistingWrappedKey(db, keyVersion), 'data key');
  }

  const unwrapped = Buffer.from(
    await port.unwrapDataKey(keyVersion, stored.wrapped, stored.wrappingKeyId),
  );
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
  const nativeMode = readEnv('PROTECTED_FIELDS_PGCRYPTO');
  if (nativeMode && nativeMode !== 'required')
    throw new Error('unsupported protected-field encryption mode');
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
  if (nativeMode === 'required') {
    const wrapped = await pgcryptoTransform(db, ciphertext, dataKey, 'encrypt');
    return { ciphertext: wrapped, nonce: Buffer.concat([Buffer.from([2]), nonce]), keyVersion };
  }
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
  const native = input.nonce.byteLength === NONCE_LENGTH + 1 && input.nonce[0] === 2;
  if (input.nonce.byteLength !== NONCE_LENGTH && !native) {
    throw new Error('unsupported protected value format');
  }
  const buf = native
    ? await pgcryptoTransform(db, input.ciphertext, dataKey, 'decrypt')
    : Buffer.from(input.ciphertext);
  if (buf.length < AUTH_TAG_LENGTH) {
    throw new Error('protected value is too short to contain an auth tag');
  }
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const body = buf.subarray(0, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    dataKey,
    Buffer.from(native ? input.nonce.slice(1) : input.nonce),
  );
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

/**
 * Native database encryption wraps an already authenticated envelope. PostgreSQL
 * receives no applicant plaintext, and the inner GCM still binds subject and row.
 * Derive a separate passphrase from the unwrapped data key, never a DB-stored key.
 * A 13-byte nonce with format marker 2 distinguishes these rows without rewriting
 * legacy 12-byte envelopes or changing the schema. Reads work after the flag is off.
 */
async function pgcryptoTransform(
  db: Db,
  bytes: Uint8Array,
  dataKey: Buffer,
  operation: 'encrypt' | 'decrypt',
): Promise<Buffer> {
  const passphrase = createHmac('sha256', dataKey)
    .update('visastack:pgcrypto-envelope:v2')
    .digest('base64');
  try {
    const hex = Buffer.from(bytes).toString('hex');
    const query =
      operation === 'encrypt'
        ? sql`select encode(pgp_sym_encrypt_bytea(decode(${hex}, 'hex'), ${passphrase}, 'cipher-algo=aes256,compress-algo=0'), 'hex') as payload`
        : sql`select encode(pgp_sym_decrypt_bytea(decode(${hex}, 'hex'), ${passphrase}), 'hex') as payload`;
    const result = await db.execute(query);
    const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
    const row = rows?.[0] as { payload?: unknown } | undefined;
    if (typeof row?.payload !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(row.payload)) {
      throw new Error('invalid encrypted database response');
    }
    return Buffer.from(row.payload, 'hex');
  } catch {
    // Drizzle errors include bound values. Never attach the raw error or query.
    throw new Error('native protected-field encryption failed');
  }
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}
