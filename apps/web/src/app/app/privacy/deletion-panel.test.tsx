// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ requestDeletionAction: vi.fn(), cancelDeletionAction: vi.fn() }));

const { DeletionPanel } = await import('./deletion-panel');

describe('DeletionPanel', () => {
  it('asks inside the page before scheduling deletion and never opens a browser pop-up', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const confirmSpy = vi.spyOn(window, 'confirm');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DeletionPanel
          scheduledFor={null}
          impact={{
            applicants: [],
            missionCount: 0,
            documentCount: 0,
            activePlatformRoleCount: 0,
            authoredMissionNoteCount: 0,
          }}
          holds={[]}
        />,
      );
    });
    const find = (text: string) =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text);

    expect(find('Yes, schedule deletion')).toBeUndefined();
    await act(async () => {
      find('Request account deletion')?.click();
    });
    expect(host.textContent).toContain('You will have a 7-day grace window to cancel.');
    expect(find('Yes, schedule deletion')?.getAttribute('type')).toBe('submit');

    await act(async () => {
      find('Keep my account')?.click();
    });
    expect(find('Yes, schedule deletion')).toBeUndefined();
    expect(find('Request account deletion')).toBeDefined();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
