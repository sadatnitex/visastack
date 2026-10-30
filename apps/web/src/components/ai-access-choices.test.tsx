import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONSENT_DEFAULTS, consentChoicesFromQuery } from '../lib/ai-consent-choices';
import { AiAccessChoices } from './ai-access-choices';

/** "Suggest Changes" on the consent screen and on Change Access (S21, security review S1). */
const render = (
  props: Partial<Parameters<typeof AiAccessChoices>[0]> & {
    readonly suggestChanges?: boolean;
  } = {},
) =>
  renderToStaticMarkup(
    <AiAccessChoices
      appName="Claude"
      cases={[]}
      initial={{ ...CONSENT_DEFAULTS, suggestChanges: props.suggestChanges ?? false }}
      durations={[{ value: '30d', label: '30 Days' }]}
      defaultDuration="30d"
      {...props}
    />,
  );
const box = (html: string) => html.match(/<input[^>]*name="suggest_changes"[^>]*>/g) ?? [];

describe('Suggest Changes on the consent screen', () => {
  it('a link can never pre-tick it, on the consent screen or on Change Access', () => {
    const query = { choice_layers: 'identity', choice_suggest: '1' } as Record<string, string>;
    expect(consentChoicesFromQuery((name) => query[name]).suggestChanges).toBe(false);
  });

  it('starts unticked even when asked to start ticked, with the feature on', () => {
    const [input] = box(render({ suggestionsAvailable: true, suggestChanges: true }));
    expect(input).not.toContain('checked');
    expect(input).not.toContain('disabled');
  });

  it('with the feature off: turned off, unticked, and nothing hidden can carry it', () => {
    const html = render({ suggestionsAvailable: false, suggestChanges: true });
    expect(box(html)).toHaveLength(1);
    expect(box(html)[0]).toContain('disabled=""');
    expect(box(html)[0]).not.toContain('checked');
    expect(html).not.toContain('type="hidden"');
    expect(html).not.toContain('Your choice is kept');
  });
});

describe('Suggest Changes on Change Access', () => {
  it('keeps a stored choice while off, ticked and still possible to untick', () => {
    const html = render({
      suggestMode: 'change',
      suggestionsAvailable: false,
      suggestChanges: true,
      suggestStored: true,
    });
    expect(box(html)).toHaveLength(1);
    expect(box(html)[0]).toContain('checked=""');
    expect(box(html)[0]).not.toContain('disabled');
    expect(html).toContain('Your choice is kept for when it is turned on again.');
  });

  it('cannot be ticked on while off when it was not stored, whatever it was asked to start with', () => {
    const html = render({
      suggestMode: 'change',
      suggestionsAvailable: false,
      suggestChanges: true,
    });
    expect(box(html)[0]).toContain('disabled=""');
    expect(box(html)[0]).not.toContain('checked');
  });
});
