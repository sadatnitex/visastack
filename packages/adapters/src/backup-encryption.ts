import { type DecipherGCM, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('VSBK1\n');
const TAG_BYTES = 16;

export function parseBackupKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('BACKUP_ENCRYPTION_KEY_BASE64 must be a canonical 32-byte base64 key');
  }
  return key;
}

export function encryptBackup(source: NodeJS.ReadableStream, key: Buffer, keyId: string) {
  if (key.length !== 32 || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId))
    throw new Error('invalid backup key');
  const nonce = randomBytes(12);
  const metadata = Buffer.from(
    JSON.stringify({
      algorithm: 'aes-256-gcm',
      keyId,
      nonce: nonce.toString('base64'),
      format: 'pg_dump-sql',
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length);
  const header = Buffer.concat([MAGIC, length, metadata]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const output = new PassThrough({ highWaterMark: 64 * 1024 });
  output.write(header);
  const appendTag = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      this.push(cipher.getAuthTag());
      callback();
    },
  });
  const done = pipeline(source, cipher, appendTag, output);
  return { stream: output, done };
}

/** Restore helper: decrypt only to an private scratch file, authenticate
 * the entire archive before passing any SQL to psql. The caller owns deletion. */
export async function decryptBackup(
  source: AsyncIterable<Uint8Array>,
  destination: NodeJS.WritableStream,
  key: Buffer,
  expectedKeyId: string,
): Promise<void> {
  let prefix = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let decipher: DecipherGCM | undefined;
  for await (const chunk of source) {
    let bytes = Buffer.from(chunk);
    if (!decipher) {
      prefix = Buffer.concat([prefix, bytes]);
      if (prefix.length < 10) continue;
      if (!prefix.subarray(0, 6).equals(MAGIC)) throw new Error('invalid backup format');
      const size = prefix.readUInt32BE(6);
      if (size > 4096 || size === 0) throw new Error('invalid backup header');
      if (prefix.length < 10 + size) continue;
      const header = prefix.subarray(0, 10 + size);
      const metadata = JSON.parse(header.subarray(10).toString()) as {
        algorithm: string;
        keyId: string;
        nonce: string;
        format: string;
      };
      const nonce = Buffer.from(metadata.nonce, 'base64');
      if (
        metadata.algorithm !== 'aes-256-gcm' ||
        metadata.format !== 'pg_dump-sql' ||
        metadata.keyId !== expectedKeyId ||
        nonce.length !== 12
      )
        throw new Error('backup key or format mismatch');
      decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(header);
      bytes = prefix.subarray(header.length);
      prefix = Buffer.alloc(0);
    }
    const combined = Buffer.concat([tail, bytes]);
    const bodyLength = Math.max(0, combined.length - TAG_BYTES);
    if (bodyLength) {
      const plain = decipher.update(combined.subarray(0, bodyLength));
      if (!destination.write(plain))
        await new Promise<void>((resolve, reject) => {
          destination.once('drain', resolve);
          destination.once('error', reject);
        });
    }
    tail = combined.subarray(bodyLength);
  }
  if (!decipher || tail.length !== TAG_BYTES) throw new Error('truncated backup');
  decipher.setAuthTag(tail);
  destination.end(decipher.final());
}
