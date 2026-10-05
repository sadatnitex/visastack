import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Commercial V1 Part 9 UX-01: internal implementation vocabulary must not reach
 * ordinary people. A service error message is shown to whoever triggered it, so
 * it is written in the product's words: a person opens a case (not a mission),
 * and a consent has the name the Privacy page gives it (not its stored code).
 *
 * This reads the source rather than running the services: every
 * `serviceError('code', 'message')` literal is checked, including the ones no
 * test happens to trigger.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url));

interface Message {
  readonly file: string;
  readonly text: string;
}

function serviceErrorMessages(): Message[] {
  const call = /serviceError\(\s*'[^']*'\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/gs;
  const found: Message[] = [];
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(`${SRC}${file}`, 'utf8');
    for (const match of source.matchAll(call)) {
      found.push({ file, text: match[2] ?? '' });
    }
  }
  return found;
}

const messages = serviceErrorMessages();
const describeHits = (hits: readonly Message[]) =>
  hits.map((m) => `${m.file}: ${JSON.stringify(m.text)}`).join('\n');

describe('service error messages use product words', () => {
  it('actually finds the messages it is meant to check', () => {
    // A regex that silently matches nothing would make every test below pass.
    expect(messages.length).toBeGreaterThan(300);
    expect(messages.some((m) => m.text === 'case not found')).toBe(true);
  });

  it('never calls a case a mission', () => {
    const hits = messages.filter((m) => /\bmissions?\b/i.test(m.text));
    expect(hits, describeHits(hits)).toEqual([]);
  });

  it('never shows a stored consent code instead of its name', () => {
    const hits = messages.filter((m) =>
      /\b(CORE_PROCESSING|AI_EXTRACTION|AI_OCR|SHARING|MARKETING|ISSUER_CONTACT)\b/.test(m.text),
    );
    expect(hits, describeHits(hits)).toEqual([]);
  });

  it('never shows an internal job state to someone downloading an export', () => {
    const hits = messages.filter((m) => /\bexport job\b|\bREADY but\b/i.test(m.text));
    expect(hits, describeHits(hits)).toEqual([]);
  });
});
