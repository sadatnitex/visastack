// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ travellerLifecycleAction: async () => undefined }));
const { TravellerManageMenu } = await import('./traveller-manage-menu');
const { I18nProvider } = await import('../../../../../components/i18n-provider');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function show(locale: 'en' | 'bn') {
  act(() =>
    root.render(
      <I18nProvider locale={locale} pageLang="en">
        <TravellerManageMenu
          name="Rahima Akter"
          applicantId="10000000-0000-4000-8000-000000000002"
          actions={['ARCHIVE', 'REMOVE_EMPTY']}
          days={30}
        />
      </I18nProvider>,
    ),
  );
}

describe('traveller menu under Bengali', () => {
  it('keeps the button text and its screen-reader name in the same language (English)', () => {
    show('bn');
    const button = container.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
    expect(button.textContent).toBe('Manage');
    expect(button.getAttribute('aria-label')).toBe('Manage Rahima Akter');
    expect(container.innerHTML).not.toMatch(/applicantTravellerManage\.|\{name\}/);
  });

  it('shows the open menu with no raw key', () => {
    show('bn');
    act(() => {
      (container.querySelector('button[aria-haspopup="menu"]') as HTMLElement).click();
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/applicantTravellerManage\./);
  });
});

describe('traveller menu under English', () => {
  it('renders the original English', () => {
    show('en');
    expect(container.textContent).toBe('Manage');
  });
});
