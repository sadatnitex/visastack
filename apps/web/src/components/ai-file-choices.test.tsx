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
    expect(html).toContain('<legend class="field-label">Travel and Immigration</legend>');
    expect(html).toContain('Visa (D-7K2Q9M)');
    expect(html.match(/Share This File/g)).toHaveLength(2);
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
