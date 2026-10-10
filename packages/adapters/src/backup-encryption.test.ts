import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup, parseBackupKey } from './backup-encryption';

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function encrypted(sql: Buffer, key: Buffer): Promise<Buffer> {
  const result = encryptBackup(Readable.from([sql]), key, 'backup-v1');
  const bytes = await collect(result.stream);
  await result.done;
  return bytes;
}

async function decrypted(bytes: Buffer, key: Buffer, keyId = 'backup-v1'): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  await decryptBackup(
    Readable.from(Array.from(bytes, (byte) => Buffer.from([byte]))),
    destination,
    key,
    keyId,
  );
  return Buffer.concat(chunks);
}

describe('encrypted database recovery format', () => {
  it('round-trips SQL across arbitrary chunk boundaries with fresh nonces', async () => {
    const key = randomBytes(32);
    const sql = Buffer.from(
      'CREATE TABLE applicant (id integer); INSERT INTO applicant VALUES (1);',
    );
    const one = await encrypted(sql, key);
    expect(one.includes(sql)).toBe(false);
    expect(await decrypted(one, key)).toEqual(sql);
    expect((await encrypted(sql, key)).equals(one)).toBe(false);
  });
  it('rejects changed ciphertext, header, wrong keys, key IDs and truncated archives', async () => {
    const key = randomBytes(32);
    const one = await encrypted(Buffer.from('sensitive SQL'), key);
    const changed = Buffer.from(one);
    changed[changed.length - 17] = (changed[changed.length - 17] ?? 0) ^ 1;
    await expect(decrypted(changed, key)).rejects.toThrow();
    const header = Buffer.from(one);
    header[header.indexOf('backup-v1')] = 120;
    await expect(decrypted(header, key)).rejects.toThrow();
    await expect(decrypted(one, randomBytes(32))).rejects.toThrow();
    await expect(decrypted(one, key, 'backup-v2')).rejects.toThrow();
    await expect(decrypted(one.subarray(0, one.length - 1), key)).rejects.toThrow();
    await expect(decrypted(Buffer.from('VSBK1\n'), key)).rejects.toThrow();
  });
  it('rejects a malformed master key and propagates dump stream failure', async () => {
    expect(() => parseBackupKey('invalid')).toThrow();
    expect(parseBackupKey(Buffer.alloc(32, 1).toString('base64'))).toHaveLength(32);
    const source = new Readable({
      read() {
        this.destroy(new Error('dump failed'));
      },
    });
    const result = encryptBackup(source, randomBytes(32), 'backup-v1');
    result.stream.on('error', () => undefined);
    await expect(result.done).rejects.toThrow('dump failed');
  });
});
