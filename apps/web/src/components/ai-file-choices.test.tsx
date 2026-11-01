import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AiFileCandidateView } from '../lib/ai-consent-choices';
import { AiFileChoices } from './ai-file-choices';

/** "Original Files" on the consent screen and Change Access (S20). Made-up documents only. */
const VISA = '44444444-4444-4444-8444-444444444444';
const LETTER = '55555555-5555-4555-8555-555555555555';
const CANDIDATES: AiFileCandidateView[] = [
  {
    documentId: VISA,
    referenceCode: 'D-7K2Q9M',
    kind: 'Visa',
    group: 'Travel and Immigration',
    safeCopyReady: true,
  },
  {
    documentId: LETTER,
    referenceCode: 'D-3H8W2P',
    kind: 'Invitation Letter',
    group: 'Accommodation and Host',
    safeCopyReady: false,
  },
];

const render = (props: Partial<Parameters<typeof AiFileChoices>[0]> = {}) =>
  renderToStaticMarkup(
    <AiFileChoices candidates={CANDIDATES} initial={[]} available={true} {...props} />,
  );
const input = (html: string, id: string, value: string) =>
  html.match(
    new RegExp(
      `<input[^>]*value="${value}"[^>]*name="file_variant_${id}"[^>]*>|<input[^>]*name="file_variant_${id}"[^>]*value="${value}"[^>]*>`,
    ),
  )?.[0] ?? '';
const box = (html: string, id: string) =>
  html.match(new RegExp(`<input[^>]*name="file"[^>]*value="${id}"[^>]*>`))?.[0] ?? '';

describe('Original Files', () => {
  it('lists each document under its group, with Share This File and Safe Copy chosen by default', () => {
    const html = render();
    expect(html).toContain('<legend class="field-label">Original Files</legend>');
    // Each group sits behind its own expander, named and counted, and closed while nothing in it
    // is ticked (WP-SB4); the group keeps its name for screen readers inside.
    expect(html).toContain(
      '<details class="collapsible-group"><summary class="collapsible-group-summary"><span class="collapsible-group-title">Travel and Immigration</span>',
    );
    expect(html).toContain('<legend class="sr-only">Travel and Immigration</legend>');
    expect(html).toContain('Visa (D-7K2Q9M)');
    expect(html.match(/<span>Share This File<\/span>/g)).toHaveLength(2);
    expect(box(html, VISA)).not.toContain('checked');
    expect(input(html, VISA, 'SAFE_COPY')).toContain('checked');
    expect(input(html, VISA, 'ORIGINAL')).not.toContain('checked');
    // The protected types are named in one plain sentence, and the warning is in words too.
    expect(html).toContain(
      'Passports, identity, money and health documents are protected and never shared with AI apps.',
    );
    expect(html).toContain('Sensitive: the app receives the whole file');
    expect(html).toContain('name="files_present" value="1"');
  });

  it('keeps Safe Copy the default when it is not ready yet, and says how to prepare it', () => {
    const html = render({ initial: [{ documentId: LETTER, variant: 'SAFE_COPY' }] });
    const safe = input(html, LETTER, 'SAFE_COPY');
    expect(safe).toContain('checked');
    expect(safe).not.toContain('disabled');
    const described = safe.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
    expect(described).not.toBe('');
    expect(html).toContain(`id="${described}"`);
    expect(html).toContain('Prepare a Safe Copy on the document’s page.');
  });

  it('starts from what was ticked, the Original included', () => {
    const html = render({ initial: [{ documentId: VISA, variant: 'ORIGINAL' }] });
    expect(box(html, VISA)).toContain('checked');
    expect(input(html, VISA, 'ORIGINAL')).toContain('checked');
    expect(input(html, VISA, 'SAFE_COPY')).not.toContain('checked');
  });

  it('while off: what is stored can be unticked or made a Safe Copy, nothing new can be added', () => {
    const stored = [{ documentId: VISA, variant: 'SAFE_COPY' as const }];
    const html = render({ available: false, stored, initial: stored });
    expect(html).toContain('This AI feature is turned off right now.');
    expect(html).toContain('Files you ticked stay ticked, and you can untick them.');
    expect(box(html, VISA)).toContain('checked');
    expect(box(html, VISA)).not.toContain('disabled');
    expect(input(html, VISA, 'ORIGINAL')).toContain('disabled');
    expect(box(html, LETTER)).toContain('disabled');
    expect(box(html, LETTER)).not.toContain('checked');
  });

  it('says so when no document can be shared as a file', () => {
    expect(render({ candidates: [] })).toContain('No documents can be shared as files yet.');
  });
});

describe('Original Files: what assistive technology hears (S20 round 2)', () => {
  const describedBy = (tag: string) =>
    tag.match(/aria-describedby="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const textOf = (html: string, id: string) =>
    html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1] ?? '';

  it('without scripts keeps both ways open, so an Original can be chosen on a ticked box', () => {
    const html = render();
    expect(input(html, VISA, 'SAFE_COPY')).not.toContain('disabled');
    expect(input(html, VISA, 'ORIGINAL')).not.toContain('disabled');
    expect(html).not.toContain('Tick Share This File first');
  });

  it('links every control the switch turned off to the sentence that says so', () => {
    const stored = [{ documentId: VISA, variant: 'SAFE_COPY' as const }];
    const html = render({ available: false, stored, initial: stored });
    const off = html.match(/id="([^"]+-files-off)"/)?.[1] ?? '';
    expect(off).not.toBe('');
    expect(describedBy(box(html, LETTER))).toContain(off);
    expect(describedBy(input(html, LETTER, 'SAFE_COPY'))).toContain(off);
    const original = describedBy(input(html, VISA, 'ORIGINAL'));
    expect(original).toContain(off);
    expect(original.some((id) => id.endsWith('-files-original'))).toBe(true);
    // A control that still works is not described as off.
    expect(describedBy(box(html, VISA))).not.toContain(off);
  });

  it('marks each box invalid on a file error, and links the not-ready note from the box', () => {
    const html = render({ invalid: { field: 'file', messageId: 'msg' } });
    for (const id of [VISA, LETTER]) {
      expect(box(html, id)).toContain('aria-invalid="true"');
      expect(describedBy(box(html, id))).toContain('msg');
    }
    const note = describedBy(box(html, LETTER)).find((id) => id.endsWith('-not-ready'));
    expect(note).toBeDefined();
    expect(textOf(html, note ?? '')).toContain('Prepare a Safe Copy');
    expect(box(render(), VISA)).not.toContain('aria-invalid');
  });

  it('opens only the group holding a ticked file, and every group on a file error (WP-SB4)', () => {
    const opened = (html: string) =>
      [
        ...html.matchAll(
          /<details class="collapsible-group"( open="")?><summary[^>]*><span class="collapsible-group-title">([^<]+)</g,
        ),
      ]
        .filter((m) => m[1])
        .map((m) => m[2]);
    expect(opened(render())).toEqual([]);
    expect(opened(render({ initial: [{ documentId: VISA, variant: 'SAFE_COPY' }] }))).toEqual([
      'Travel and Immigration',
    ]);
    expect(opened(render({ invalid: { field: 'file', messageId: 'msg' } }))).toEqual([
      'Travel and Immigration',
      'Accommodation and Host',
    ]);
    // A closed group still holds every control, so nothing ticked is ever lost on submit.
    expect(box(render(), LETTER)).toContain('name="file"');
  });
});
