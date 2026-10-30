// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { aiConfigView } from '../../../../lib/ai-config-view.test-support';
import '../../../../lib/next-mocks.test-support';
import { CreateDraftConfigForm, EditConfigForm } from './forms';

/**
 * React resets a form after every save, including one the server refused. These tests reset the
 * form the same way and check that the provider and model lists show what the form will send,
 * so a refused save can never leave one provider shown and another model sent.
 */

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host;
}

function select(host: HTMLElement, name: string): HTMLSelectElement {
  const found = host.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!found) throw new Error(`no select ${name}`);
  return found;
}

async function choose(element: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function reset(host: HTMLElement): Promise<void> {
  await act(async () => host.querySelector('form')?.reset());
}

describe('AI settings model picker after a form reset', () => {
  it('create form: provider and model return together to the first provider and its first model', async () => {
    const host = await mount(<CreateDraftConfigForm fallbackOptions={[]} />);
    await choose(select(host, 'provider'), 'anthropic');
    await choose(select(host, 'modelChoice'), 'claude-sonnet-5-5');
    expect(select(host, 'modelChoice').value).toBe('claude-sonnet-5-5');

    await reset(host);
    expect(select(host, 'provider').value).toBe('openai');
    expect(select(host, 'modelChoice').value).toBe('gpt-5.6-terra');
    const offered = [...select(host, 'modelChoice').options].map((o) => o.value);
    expect(offered.some((v) => v.startsWith('claude-'))).toBe(false);
  });

  it('edit form: a typed Other Model ID returns to the saved model, never to an unseen list entry', async () => {
    const config = aiConfigView({ model: 'claude-sonnet-5-5' });
    const host = await mount(<EditConfigForm config={config} fallbackOptions={[]} />);
    await choose(select(host, 'modelChoice'), '__other');
    expect(host.querySelector('input[name="modelOther"]')).not.toBeNull();

    await reset(host);
    expect(select(host, 'modelChoice').value).toBe('claude-sonnet-5-5');
    expect(host.querySelector('input[name="modelOther"]')).toBeNull();
  });
});
