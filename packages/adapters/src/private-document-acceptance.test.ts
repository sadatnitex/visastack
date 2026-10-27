import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanPdf } from './private-document-acceptance';
import { structuralCheck } from './scanner';
import { DeterministicTextExtractor } from './text-extraction';

const pathName = 'PATH';

describe('private synthetic acceptance controls', () => {
  it('refuses a non-main execution before reading storage credentials', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
        fileURLToPath(new URL('./private-document-acceptance.ts', import.meta.url)),
      ],
      {
        env: { PATH: process.env[pathName] ?? '', GITHUB_REF: 'refs/heads/untrusted' },
        // A fresh process compiles the script first, which is slow on a busy or small machine.
        timeout: 60_000,
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Acceptance requires main');
    expect(result.stdout).toBe('');
  }, 70_000);
  it('produces a structurally valid PDF readable by the real native extractor', async () => {
    const bytes = cleanPdf();
    expect(
      structuralCheck(bytes, 'application/pdf', { allowPdf: true, maxBytes: 25 * 1024 * 1024 })
        .accepted,
    ).toBe(true);
    const extractor = new DeterministicTextExtractor({
      blobStore: {
        getObject: async () => ({ bytes, contentType: 'application/pdf' }),
        putObject: async () => {},
        deleteObject: async () => {},
        listObjectKeys: async () => ({ objectKeys: [], cursor: undefined }),
      },
    });
    const result = await extractor.extract({
      bucket: 'QUARANTINE',
      objectKey: 'synthetic',
      originalName: 'synthetic.pdf',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.result.text).toContain('VisaStack synthetic storage acceptance');
  });
});
