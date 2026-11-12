import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * English golden check (i18n plumbing, PR0). Every person-facing English string the census found
 * in packages/services and packages/core must still appear word for word, either as a literal in
 * its source file or as a value in an `en` catalogue in that package's `i18n` folder. Moving a
 * sentence into a catalogue passes; rewording one fails. Later conversion work must pass this
 * file unedited. Rebuild the data only with docs/localization/tools/build-service-golden.mjs.
 *
 * Strings with a {placeholder} are checked by their fixed pieces, because the source writes the
 * placeholder as a variable, a template slot or a catalogue token. AI prompt and tool text is not
 * in the golden: it stays English for the model.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const golden: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'docs/localization/service-english-golden.json'), 'utf8'),
);

const squash = (text: string): string => text.replace(/\s+/g, ' ');

/** The text as a reader sees it: string escapes resolved, so `’` equals the curly quote. */
function readable(source: string): string {
  return source
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\(['"`\\])/g, '$1')
    .replace(/\\n/g, '\n');
}

const sources = new Map<string, string>();
function sourceOf(path: string): string {
  let text = sources.get(path);
  if (text === undefined) {
    text = existsSync(path) ? squash(readable(readFileSync(path, 'utf8'))) : '';
    sources.set(path, text);
  }
  return text;
}

/** Every catalogue file of the package a source file belongs to (none until strings move). */
function catalogueText(file: string): string {
  const pkg = file.split('/').slice(0, 2).join('/');
  const dir = join(ROOT, pkg, 'src/i18n');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => sourceOf(join(dir, name)))
    .join('\n');
}

/** The fixed pieces of an English string: the text outside its (possibly nested) {placeholders}. */
function pieces(english: string): string[] {
  // The census writes characters it cannot show as [U+XXXX].
  const text = english.replace(/\[U\+([0-9A-F]{4,6})\]/g, (_m, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  );
  const found: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '{') {
      if (depth === 0) found.push(current);
      depth += 1;
      if (depth === 1) current = '';
    } else if (char === '}' && depth > 0) {
      depth -= 1;
    } else if (depth === 0) current += char;
  }
  found.push(current);
  return found.map((piece) => squash(piece).trim()).filter((piece) => piece.length > 0);
}

describe('person-facing English in services and core is unchanged', () => {
  it('has golden data to check', () => {
    const files = Object.keys(golden);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.startsWith('packages/services/'))).toBe(true);
    expect(files.some((f) => f.startsWith('packages/core/'))).toBe(true);
  });

  for (const pkg of ['packages/services/', 'packages/core/']) {
    it(`keeps every ${pkg} sentence word for word`, () => {
      const missing: string[] = [];
      for (const [file, strings] of Object.entries(golden)) {
        if (!file.startsWith(pkg)) continue;
        const own = sourceOf(join(ROOT, file));
        const catalogue = catalogueText(file);
        for (const english of strings) {
          const found = pieces(english).every(
            (piece) => own.includes(piece) || catalogue.includes(piece),
          );
          if (!found) missing.push(`${file}: ${JSON.stringify(english)}`);
        }
      }
      expect(missing.slice(0, 40), `${missing.length} missing`).toEqual([]);
    });
  }
});
