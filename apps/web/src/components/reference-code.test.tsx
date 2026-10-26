// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReferenceCode } from './reference-code';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('ReferenceCode', () => {
  it('shows the code with a labelled Copy button and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { host, unmount } = await mount(<ReferenceCode code="C-7K2Q9M" />);
    expect(host.querySelector('.reference-code-value')?.textContent).toBe('C-7K2Q9M');
    expect(host.querySelector('.reference-code-value')?.getAttribute('translate')).toBe('no');
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Copy');
    expect(button?.getAttribute('aria-label')).toBe('Copy Reference C-7K2Q9M');
    await act(async () => button?.click());
    expect(writeText).toHaveBeenCalledWith('C-7K2Q9M');
    expect(host.querySelector('output')?.textContent).toBe('Copied');
    await unmount();
  });

  it('says how to copy by hand when the clipboard is refused', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
    });
    const { host, unmount } = await mount(
      <ReferenceCode code="D-7K2Q9M" label="Document Reference" />,
    );
    expect(host.textContent).toContain('Document Reference');
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('output')?.textContent).toContain('copy it with your keyboard');
    await unmount();
  });

  it('shows nothing at all without a code, never a placeholder', async () => {
    for (const code of [null, undefined, '']) {
      const { host, unmount } = await mount(<ReferenceCode code={code} />);
      expect(host.innerHTML).toBe('');
      await unmount();
    }
  });
});
