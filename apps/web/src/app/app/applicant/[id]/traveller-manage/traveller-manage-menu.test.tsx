// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ travellerLifecycleAction: async () => undefined }));
vi.mock('@visastack/services', () => ({ TRAVELLER_REFUSALS: {} }));
const { TravellerManageMenu } = await import('./traveller-manage-menu');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const ID = '10000000-0000-4000-8000-000000000002';
const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
const manageButton = () => container.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
const items = () => [...container.querySelectorAll('[role="menuitem"]')] as HTMLElement[];

describe('the traveller Manage menu', () => {
  it('renders nothing when the server allowed no menu action (Myself, or only Restore)', () => {
    act(() => root.render(<TravellerManageMenu applicantId={ID} name="Ayesha" actions={[]} />));
    expect(container.innerHTML).toBe('');
    act(() =>
      root.render(
        <TravellerManageMenu applicantId={ID} name="Ayesha" actions={['RESTORE_DELETED']} />,
      ),
    );
    expect(container.innerHTML).toBe('');
  });

  it('lists only the allowed actions, moves with the keyboard and returns focus on Escape', () => {
    act(() =>
      root.render(
        <TravellerManageMenu
          applicantId={ID}
          name="Ayesha"
          actions={['ARCHIVE', 'REMOVE_EMPTY']}
        />,
      ),
    );
    expect(manageButton().getAttribute('aria-label')).toBe('Manage Ayesha');
    key(manageButton(), 'ArrowDown');
    expect(items().map((item) => item.textContent)).toEqual([
      'Archive Traveller',
      'Remove Empty Record',
    ]);
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as HTMLElement, 'Escape');
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(manageButton());
  });

  it('asks before acting, with a plain form for the chosen action, and Cancel returns focus', () => {
    act(() =>
      root.render(<TravellerManageMenu applicantId={ID} name="Ayesha" actions={['ARCHIVE']} />),
    );
    act(() => manageButton().click());
    expect(items().map((item) => item.textContent)).toEqual(['Archive Traveller']);
    act(() => (items()[0] as HTMLElement).click());
    const panel = container.querySelector('section.lc-traveller-confirm') as HTMLElement;
    expect(document.activeElement).toBe(panel);
    expect(panel.textContent).toContain('Ayesha leaves your everyday lists');
    expect(panel.textContent).toContain('Nothing is deleted');
    const form = panel.querySelector('form') as HTMLFormElement;
    expect((form.querySelector('input[name="applicantId"]') as HTMLInputElement).value).toBe(ID);
    expect((form.querySelector('input[name="command"]') as HTMLInputElement).value).toBe('archive');
    expect((form.querySelector('button[type="submit"]') as HTMLElement).textContent).toBe(
      'Archive Traveller',
    );
    const cancel = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    act(() => cancel?.click());
    expect(container.querySelector('section.lc-traveller-confirm')).toBeNull();
    expect(document.activeElement).toBe(manageButton());
  });

  it('explains Remove Empty Record before moving the record to Recently Deleted', () => {
    act(() =>
      root.render(
        <TravellerManageMenu applicantId={ID} name="Ayesha" actions={['REMOVE_EMPTY']} />,
      ),
    );
    act(() => manageButton().click());
    act(() => (items()[0] as HTMLElement).click());
    const panel = container.querySelector('section.lc-traveller-confirm') as HTMLElement;
    expect(panel.textContent).toContain('moves to Recently Deleted');
    expect(panel.textContent).toContain('after 30 days');
    expect((panel.querySelector('input[name="command"]') as HTMLInputElement).value).toBe('remove');
  });
});
