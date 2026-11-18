// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { FIELD_STATUS_WORDS } from '../../lib/field-state-words';
import { isTitleCase } from '../../lib/title-case';
import {
  STATUS_KINDS,
  STATUS_MEANINGS,
  StatusGlyph,
  StatusPicture,
  isStatusKind,
} from './status-picture';

const kinds = [...STATUS_KINDS];

describe('the six status pictures (one status language)', () => {
  it('take their names from the one field status map, never typed again', () => {
    for (const kind of kinds) expect(STATUS_MEANINGS[kind].name).toBe(FIELD_STATUS_WORDS[kind]);
    expect(kinds.map((kind) => STATUS_MEANINGS[kind].name)).toEqual([
      'Entered',
      'Suggested',
      'Confirmed',
      'Backed by a Document',
      'Does Not Match',
      'No Longer Current',
    ]);
    const source = readFileSync(join(__dirname, 'status-picture-words.ts'), 'utf8');
    for (const kind of kinds) {
      expect(source, 'the name is read, not written').not.toContain(
        `'${STATUS_MEANINGS[kind].name}'`,
      );
    }
    for (const kind of kinds) expect(isTitleCase(STATUS_MEANINGS[kind].name), kind).toBe(true);
  });

  it('each says one plain sentence', () => {
    for (const kind of kinds) {
      const { sentence } = STATUS_MEANINGS[kind];
      expect(sentence, kind).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(sentence.split(' ').length, kind).toBeLessThanOrEqual(18);
    }
  });

  it('never claim more than VisaStack knows', () => {
    const overclaim = /\b(verified|approved|accepted|guaranteed|valid|official|correct)\b/i;
    for (const kind of kinds) {
      const { sentence } = STATUS_MEANINGS[kind];
      expect(sentence, kind).not.toMatch(overclaim);
      // "checked" only ever appears as something that has NOT happened.
      if (/checked/i.test(sentence))
        expect(sentence, kind).toMatch(/not (mean anyone has )?checked/);
      // Nothing promises to keep a value for ever, or that only one person can see it.
      expect(sentence, kind).not.toMatch(/\b(forever|always|only you)\b/i);
    }
    expect(STATUS_MEANINGS.DOCUMENT_SUPPORTED.sentence).toMatch(
      /does not mean anyone has checked it/,
    );
    expect(STATUS_MEANINGS.EXTRACTED_PENDING.sentence).toMatch(
      /reading one of your files or by a connected app/,
    );
    expect(STATUS_MEANINGS.EXTRACTED_PENDING.sentence).toMatch(/not confirmed/);
    expect(STATUS_MEANINGS.APPLICANT_CONFIRMED.sentence).toMatch(/not checked against a file/);
  });

  it('read without colour: every ring style and every mark is different', () => {
    const rings = kinds.map((kind) => STATUS_MEANINGS[kind].ring);
    expect(new Set(rings).size).toBe(kinds.length);
    const drawings = kinds.map((kind) => renderToString(<StatusGlyph kind={kind} />));
    const marks = drawings.map(
      (html) => html.match(/<g class="status-picture-mark">(.*)<\/g>/)?.[1],
    );
    expect(new Set(marks).size).toBe(kinds.length);
    const outlines = drawings.map((html) =>
      [...html.matchAll(/<circle class="status-picture-ring[^"]*"[^>]*>/g)]
        .map((m) => m[0])
        .join(''),
    );
    expect(new Set(outlines).size).toBe(kinds.length);
  });

  it('use brand colour families only, drawn from stylesheet tokens', () => {
    for (const kind of kinds) {
      expect(['brand', 'ok', 'bad', 'ink']).toContain(STATUS_MEANINGS[kind].tone);
      const html = renderToString(<StatusGlyph kind={kind} />);
      expect(html, kind).not.toMatch(/fill="#|stroke="#|style=/);
    }
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
    const start = css.indexOf('/* WP-WAL1 ');
    expect(start, 'the WP-WAL1 block').toBeGreaterThan(-1);
    const end = css.indexOf('/* WP-', start + 10);
    const block = css.slice(start, end === -1 ? undefined : end);
    expect(block).toMatch(/\.status-picture\[data-tone="ok"\]/);
    // No literal colours, no shadows, no gradients: tokens only, flat.
    expect(block.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|shadow|gradient/i,
    );
  });

  it('each picture is an Explain button named by its status and described by its sentence', async () => {
    for (const kind of kinds) {
      const html = renderToString(<StatusPicture kind={kind} />);
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const button = holder.querySelector('button.explain-tip-trigger');
      expect(button, kind).not.toBeNull();
      expect(button?.textContent).toBe(STATUS_MEANINGS[kind].name);
      const described = button?.getAttribute('aria-describedby') ?? '';
      expect(holder.querySelector(`[id="${described}"]`)?.textContent).toBe(
        STATUS_MEANINGS[kind].sentence,
      );
      expect(holder.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(await axeViolations(html), kind).toEqual([]);
    }
  });

  it('know which stored codes have a picture', () => {
    expect(isStatusKind('DOCUMENT_SUPPORTED')).toBe(true);
    expect(isStatusKind('SUPERSEDED')).toBe(false);
    expect(isStatusKind(null)).toBe(false);
  });

  it('take the page language words when given, else the record', () => {
    const html = renderToString(
      <StatusPicture kind="DECLARED" label="Own Words" text="Own sentence." />,
    );
    expect(html).toContain('Own Words');
    expect(html).toContain('Own sentence.');
    expect(html).not.toContain(STATUS_MEANINGS.DECLARED.sentence);
  });
});
