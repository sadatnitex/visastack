// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkspaceAccess, workspaceNavigation } from '../../lib/workspace-navigation';
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/applicant/10000000-0000-4000-8000-000000000001',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { WorkspaceRecordToolbar } = await import('./workspace-record-toolbar');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const person = '10000000-0000-4000-8000-000000000001';
const access: WorkspaceAccess = {
  travellers: [{ id: person, name: 'Synthetic Self', relationship: 'SELF' }],
  agencies: [],
  platform: null,
};
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <WorkspaceRecordToolbar
        accountName="Synthetic Self"
        access={access}
        navigation={workspaceNavigation(`/app/applicant/${person}`, access)}
        state={{
          unread: 3,
          personalPlan: { key: 'traveller_free', name: 'Traveller Free' },
          agencyPlans: [],
        }}
        signOut={
          <form>
            <button type="submit">Sign out</button>
          </form>
        }
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function query(value: string) {
  await act(async () => {
    const input = container.querySelector('input');
    if (!input) throw new Error('Search input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('actual toolbar component behavior, without provider-backed acceptance claims', () => {
  it('keeps personal controls separate from workspace navigation and closes outside it', () => {
    const menu = container.querySelector('nav[aria-label="Account menu"]');
    expect(menu?.querySelector(`a[href="/app/applicant/${person}"]`)).toBeNull();
    expect(menu?.querySelector('a[href="/app/applicants"]')).toBeNull();
    expect(menu?.querySelector('a[href="/app/agency"]')).toBeNull();
    expect(menu?.querySelector('a[href="/app/shared"]')).toBeNull();
    expect(menu?.querySelector('a[href="/app/help"]')).not.toBeNull();
    const summary = container.querySelector('.record-account summary');
    expect(summary?.querySelector('.workspace-avatar')).toBeNull();
    expect(summary?.querySelector('b')?.textContent).toBe('Synthetic Self');
    expect(summary?.querySelector('.icon')).not.toBeNull();
    const nav = workspaceNavigation(`/app/applicant/${person}`, access);
    const workspacePaths = [...nav.primary, ...nav.tools, ...nav.settings].map((item) => item.href);
    expect(workspacePaths).not.toContain('/app/privacy');
    expect(workspacePaths).not.toContain('/app/account');
    expect(workspacePaths).not.toContain('/app/help');
    expect(menu?.querySelector('a[href="/app/privacy"]')).not.toBeNull();
    expect(menu?.querySelector('a[href="/status"]')).not.toBeNull();
    expect(menu?.querySelector('a[href="/app/admin"]')).toBeNull();
    const account = container.querySelector('details');
    if (!account) throw new Error('Missing account disclosure');
    account.open = true;
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(account.open).toBe(false);
  });
  it('debounces metadata requests and submits only the selected person scope', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              category: 'Profile',
              id: person,
              label: 'Synthetic profile',
              href: `/app/applicant/${person}/profile`,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await query('Synthetic');
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(fetchMock).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      query: 'Synthetic',
      scope: { kind: 'personal', applicantId: person },
    });
    expect(
      container.querySelector(`a[href="/app/applicant/${person}/profile"]`)?.textContent,
    ).toContain('Synthetic profile');
    const input = container.querySelector('input');
    input?.focus();
    act(() =>
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect(document.activeElement?.getAttribute('href')).toBe(`/app/applicant/${person}/profile`);
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
  });
  it('shows a real request failure rather than claiming there are no records', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    await query('Synthetic');
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Search is unavailable',
    );
    expect(container.textContent).not.toContain('No accessible records match');
  });
  it('aborts an in-flight request when the query changes or the context unmounts', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await query('Synthetic');
    await act(() => vi.advanceTimersByTimeAsync(250));
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal;
    await query('Different');
    expect(signal?.aborted).toBe(true);
  });
  it('uses saved unread/plan status and retains actionable account controls', () => {
    expect(
      container.querySelector('a[aria-label="Notifications, 3 unread"]')?.getAttribute('href'),
    ).toBe('/app/notifications');
    expect(container.textContent).toContain('Traveller Free');
    expect(container.textContent).not.toContain('Founding Access');
    expect(container.querySelector('.record-account form button')?.textContent).toBe('Sign out');
  });
});
