import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state: { header: string | null; fail: boolean } = { header: null, fail: false };
vi.mock('next/headers', () => ({
  headers: async () => {
    if (state.fail) throw new Error('outside a request');
    return new Headers(state.header === null ? {} : { 'save-data': state.header });
  },
}));

const { requestSavesData, saveDataHeaderOn } = await import('./save-data-request');

afterEach(() => {
  state.header = null;
  state.fail = false;
});

describe('Save-Data request header', () => {
  it.each(['on', 'On', ' ON '])('reads %j as data saver on', (value) => {
    expect(saveDataHeaderOn(value)).toBe(true);
  });

  it.each(['off', '', 'onn', '1', 'yes', null, undefined])('reads %j as off', (value) => {
    expect(saveDataHeaderOn(value)).toBe(false);
  });

  it('reads the current request', async () => {
    state.header = 'on';
    expect(await requestSavesData()).toBe(true);
    state.header = 'off';
    expect(await requestSavesData()).toBe(false);
    state.header = null;
    expect(await requestSavesData()).toBe(false);
  });

  it('is off, and does not fail, outside a request', async () => {
    state.fail = true;
    expect(await requestSavesData()).toBe(false);
  });

  it('is read by the root layout, which marks the page and mounts the browser flag once', () => {
    const layout = readFileSync(join(__dirname, '..', '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain(
      "const saveDataMark = (await requestSavesData()) ? { 'data-save-data': '' } : {};",
    );
    expect(layout).toMatch(/<html lang=\{htmlLang\}[^>]*\{\.\.\.saveDataMark\}>/);
    expect(layout.match(/<SaveDataFlag \/>/g) ?? []).toHaveLength(1);
  });
});
