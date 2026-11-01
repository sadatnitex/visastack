import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ answerAiConsentAction: vi.fn() }));

const { ConsentForm } = await import('./consent-form');

/**
 * The AI app consent screen after WP-SB4: only the layout changed (the answer in a bar that stays
 * in reach, long case and file lists behind expanders). It still asks for exactly the same things.
 */
const cases = Array.from({ length: 8 }, (_, i) => ({
  id: `11111111-1111-4111-8111-00000000000${i}`,
  title: `Synthetic Trip ${i}`,
}));
const files = {
  available: true,
  candidates: Array.from({ length: 12 }, (_, i) => ({
    documentId: `22222222-2222-4222-8222-0000000000${String(i).padStart(2, '0')}`,
    referenceCode: `D-${i}`,
    kind: 'Invitation Letter',
    group: i % 2 ? 'Accommodation and Host' : 'Travel and Immigration',
    safeCopyReady: true,
  })),
};
const html = renderToStaticMarkup(
  <ConsentForm
    request={{
      clientId: 'client-1',
      redirectUri: 'https://app.example.test/callback',
      codeChallenge: 'challenge',
      resource: 'https://vs.example.test/mcp',
      state: 'state-1',
    }}
    appName="Synthetic App"
    record={{ id: '33333333-3333-4333-8333-333333333333', name: 'Synthetic Traveller' }}
    cases={cases}
    suggestionsAvailable
    files={files}
  />,
);

/** Every field the form sends, by name, once each. */
function fieldNames(markup: string): string[] {
  const names = [...markup.matchAll(/<(?:input|select|button)[^>]*name="([^"]+)"/g)].map(
    (m) => m[1] ?? '',
  );
  return [
    ...new Set(names.map((name) => name.replace(/^file_variant_.*/, 'file_variant_*'))),
  ].sort();
}

describe('the AI app consent screen (WP-SB4 layout)', () => {
  it('still asks for exactly the same permissions, with the same names', () => {
    expect(fieldNames(html)).toEqual(
      [
        'cases',
        'client_id',
        'code_challenge',
        'decision',
        'document_list',
        'document_text',
        'duration',
        'file',
        'file_variant_*',
        'files_present',
        'layer',
        'record',
        'redirect_uri',
        'resource',
        'reveal_identifiers',
        'state',
        'suggest_changes',
      ].sort(),
    );
    // Every case and every file is still offered, folded or not.
    expect(html.match(/name="cases"/g)).toHaveLength(cases.length + 2);
    expect(html.match(/name="file" /g)).toHaveLength(files.candidates.length);
    // Nothing new is ticked by the new layout: the safe defaults hold.
    expect(html).not.toMatch(/name="file"[^>]*checked/);
    expect(html).not.toMatch(/name="suggest_changes"[^>]*checked/);
  });

  it('puts Allow and Do Not Allow together in a bar that stays in reach, at the end', () => {
    const bar = html.indexOf('<fieldset class="sticky-action-bar">');
    expect(bar).toBeGreaterThan(html.indexOf('name="duration"'));
    const end = html.slice(bar, html.indexOf('</fieldset>', bar));
    expect(end).toContain('<legend class="sr-only">Answer Synthetic App</legend>');
    expect(end).toMatch(/value="allow"[^>]*name="decision"/);
    expect(end).toMatch(/value="deny"[^>]*name="decision"/);
    expect(end).toContain('Allow Access');
    expect(end).toContain('Do Not Allow');
  });

  it('folds each group of files, closed while nothing in it is ticked; cases scroll in a box', () => {
    expect(html).toContain('class="checks ai-case-scroll"');
    const summaries = [
      ...html.matchAll(
        /<details class="collapsible-group"( open="")?><summary[^>]*><span class="collapsible-group-title">([^<]+)</g,
      ),
    ].map((m) => ({ title: m[2], open: Boolean(m[1]) }));
    expect(summaries).toEqual([
      { title: 'Travel and Immigration', open: false },
      { title: 'Accommodation and Host', open: false },
    ]);
  });
});
