// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  requestDeletionAction: vi.fn(),
  cancelDeletionAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

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

    expect(find('Yes, Schedule Deletion')).toBeUndefined();
    await act(async () => {
      find('Request Account Deletion')?.click();
    });
    expect(host.textContent).toContain('You will have a 7-day grace window to cancel.');
    expect(find('Yes, Schedule Deletion')?.getAttribute('type')).toBe('submit');

    await act(async () => {
      find('Keep My Account')?.click();
    });
    expect(find('Yes, Schedule Deletion')).toBeUndefined();
    expect(find('Request Account Deletion')).toBeDefined();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('keeps the card on screen and says so after a cancel moves it back to Everything', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    actions.cancelDeletionAction.mockResolvedValue({
      ok: true,
      message: 'Deletion request cancelled.',
    });
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    const scope = document.createElement('div');
    scope.setAttribute('data-depth-scope', '');
    scope.setAttribute('data-depth', 'glance');
    const card = document.createElement('article');
    card.id = 'delete-account';
    card.setAttribute('data-level', 'everything');
    scope.append(card);
    document.body.append(scope);
    const root = createRoot(card);
    const impact = {
      applicants: [],
      missionCount: 0,
      documentCount: 0,
      activePlatformRoleCount: 0,
      authoredMissionNoteCount: 0,
    };
    await act(async () => {
      root.render(<DeletionPanel scheduledFor="2026-11-04T08:00:00Z" impact={impact} holds={[]} />);
    });
    await act(async () => {
      card.querySelector('form')?.requestSubmit();
    });
    // The page's refresh: no deletion pending any more.
    await act(async () => {
      root.render(<DeletionPanel scheduledFor={null} impact={impact} holds={[]} />);
    });
    expect(actions.cancelDeletionAction).toHaveBeenCalled();
    expect(scope.getAttribute('data-depth')).toBe('everything');
    expect(card.textContent).toContain('Deletion request cancelled.');
  });
});
