// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

/** Turn Off keeps announcing, and keeps focus, after the page reloads the row as ended (S22). */
const mocks = vi.hoisted(() => ({ turnOff: vi.fn() }));
vi.mock('./ai-actions', () => ({ turnOffAgencyAiConnectionAction: mocks.turnOff }));
const { AgencyAiTurnOff } = await import('./agency-ai-turn-off');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AgencyAiTurnOff', () => {
  it('announces Turned Off in an output that stays mounted, moves focus to it, and keeps it when the row reloads as ended', async () => {
    mocks.turnOff.mockResolvedValue({
      ok: true,
      message: 'Turned off. The app stops on its next request.',
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const props = { organizationId: 'o1', connectionId: 'c1', appLabel: 'Claude (claude.ai)' };
    await act(async () => root.render(<AgencyAiTurnOff {...props} live />));
    const output = host.querySelector('output[tabindex="-1"]');
    expect(output).not.toBeNull();
    const button = host.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Turn Off Claude (claude.ai)');
    await act(async () => host.querySelector('form')?.requestSubmit());
    // The same element announces the result, and holds focus.
    expect(host.querySelector('output[tabindex="-1"]')).toBe(output);
    expect(output?.textContent).toBe('Turned off. The app stops on its next request.');
    expect(document.activeElement).toBe(output);
    expect(host.querySelector('button')).toBeNull();
    // The page reloads the connection as ended: the component, its status and focus stay.
    await act(async () => root.render(<AgencyAiTurnOff {...props} live={false} />));
    expect(host.querySelector('output[tabindex="-1"]')).toBe(output);
    expect(output?.textContent).toBe('Turned off. The app stops on its next request.');
    expect(document.activeElement).toBe(output);
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows Ended without a button for a connection that ended before', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <AgencyAiTurnOff organizationId="o1" connectionId="c2" appLabel="Claude" live={false} />,
      ),
    );
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('output[tabindex="-1"]')?.textContent).toBe('Ended');
    await act(async () => root.unmount());
    host.remove();
  });
});
