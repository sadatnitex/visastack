import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_PUBLIC_MESSAGES, publicBnByEnglish, publicBnByKey } from './public-lookup';

describe('the drafted Bengali for the public pages', () => {
  it('has Bengali for every message, and no stray English token or em dash', () => {
    for (const [key, m] of Object.entries(ALL_PUBLIC_MESSAGES)) {
      expect(m.bn.trim(), key).not.toBe('');
      expect(m.bn, key).toMatch(/[ঀ-৿]/);
      expect(m.bn + m.en, key).not.toContain('—');
      // Every {token} in the English is in the Bengali, so no value is dropped.
      const tokens = (text: string) => [...text.matchAll(/\{(\w+)[,}]/g)].map((x) => x[1]).sort();
      expect(tokens(m.bn), key).toEqual(tokens(m.en));
    }
  });

  it('never gives two different Bengali lines or release states to the same English text', () => {
    const seen = new Map<string, { bn: string; live: boolean; cls: string }>();
    const conflicts: string[] = [];
    for (const m of ALL_PUBLIC_MESSAGES) {
      const before = seen.get(m.en);
      if (before === undefined) seen.set(m.en, { bn: m.bn, live: m.live, cls: m.cls });
      else if (before.live !== m.live || before.bn !== m.bn)
        conflicts.push(
          `${m.en.slice(0, 60)} (${before.cls}/${m.cls}, live ${before.live}/${m.live})`,
        );
    }
    expect(conflicts).toEqual([]);
  });

  it('shows a held message in English and a live one in Bengali', () => {
    const wrong: string[] = [];
    for (const m of ALL_PUBLIC_MESSAGES) {
      if (m.key !== undefined) continue;
      const found = publicBnByEnglish(m.en);
      if (m.live ? found !== m.bn : found !== undefined) wrong.push(m.en.slice(0, 60));
    }
    expect(wrong).toEqual([]);
  });

  it('looks a catalogue key up only when its message is live', () => {
    for (const m of Object.values(ALL_PUBLIC_MESSAGES)) {
      if (m.key === undefined) continue;
      if (m.live) expect(publicBnByKey(m.key)).toBe(m.bn);
      else expect(publicBnByKey(m.key)).toBeUndefined();
    }
  });

  it('keeps the legal, privacy, status and authority wording held', () => {
    const live = Object.entries(ALL_PUBLIC_MESSAGES).filter(
      ([, m]) => m.live && m.cls !== 'ordinary',
    );
    expect(live.map(([key]) => key)).toEqual([]);
  });
});

describe('the browser bundle', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
    });

  it('never pulls the message files into a client component (they are worded on the server)', () => {
    const offenders = files(SRC).filter((file) => {
      const source = readFileSync(file, 'utf8');
      if (!/^['"]use client['"]/m.test(source.slice(0, 200))) return false;
      return /from '(?:\.\.?\/)+(?:i18n\/public-lookup|(?:components\/public-site\/|\.\/|\.\.\/)?public-text)'/.test(
        source,
      );
    });
    expect(offenders.map((file) => file.slice(SRC.length))).toEqual([]);
  });
});
