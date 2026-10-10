import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished, pipeline } from 'node:stream/promises';
import { decryptBackup, parseBackupKey } from './backup-encryption';

/** Offline verification and SQL extraction only. Never connects to a database. */
async function main(): Promise<void> {
  const input = process.argv[2];
  const key = parseBackupKey(readEnv('BACKUP_ENCRYPTION_KEY_BASE64') ?? '');
  const keyId = readEnv('BACKUP_ENCRYPTION_KEY_ID') ?? '';
  if (!input || !keyId) throw new Error('restore configuration missing');
  const directory = await mkdtemp(join(tmpdir(), 'visastack-restore-'));
  const scratch = join(directory, 'verified.sql');
  const output = createWriteStream(scratch, { mode: 0o600, flags: 'wx' });
  const closed = finished(output);
  closed.catch(() => undefined);
  try {
    await decryptBackup(createReadStream(input), output, key, keyId);
    await closed;
    // Nothing reaches stdout until authentication succeeds for the entire dump.
    await pipeline(createReadStream(scratch), process.stdout);
  } finally {
    output.destroy();
    key.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(() => {
  process.stderr.write('Backup verification or SQL extraction failed.\n');
  process.exitCode = 1;
});
function readEnv(name: string): string | undefined {
  return process.env[name];
}
