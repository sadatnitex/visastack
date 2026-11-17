import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFlagSvg } from './card-image';

describe('the progress card flag', () => {
  it('reads an allowed flag from the app folder as an embedded picture', async () => {
    const flag = await loadFlagSvg('JP');
    expect(flag?.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('reads nothing for a code that is not a flag, a path trick or a hidden flag', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'flags-'));
    await mkdir(path.join(dir, 'flags'));
    await writeFile(path.join(dir, 'flags', 'zz.svg'), '<svg/>');
    for (const code of ['zz', '../etc', 'j', 'jpn', '']) {
      expect(await loadFlagSvg(code, dir)).toBeNull();
    }
  });

  it('draws the name only when the folder is not beside the server', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'no-flags-'));
    expect(await loadFlagSvg('jp', dir)).toBeNull();
  });
});
