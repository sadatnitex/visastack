import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('../../../../lib/i18n-server', () => ({ primeLocale: async () => 'en' }));
const state = vi.hoisted(() => ({ staff: false }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => unknown) =>
    fn({ db: {}, accountId: 'acct-1', email: 'p@example.test' }),
}));
vi.mock('../../../../lib/session-age', () => ({ isStaffContext: async () => state.staff }));
const listPasskeys = vi.fn();
vi.mock('@visastack/services/passkeys', () => ({
  listPasskeys: (...args: unknown[]) => listPasskeys(...args),
}));
vi.mock('../../../auth/passkey-actions', () => ({
  removePasskeyAction: vi.fn(),
  renamePasskeyAction: vi.fn(),
}));
vi.mock('./passkeys-panel', () => ({ AddPasskey: () => <div data-add-passkey="" /> }));

import PasskeysPage from './page';

async function render(searchParams: Record<string, string> = {}): Promise<Document> {
  const html = renderToStaticMarkup(
    await PasskeysPage({ searchParams: Promise.resolve(searchParams) }),
  );
  return new JSDOM(html).window.document;
}

beforeEach(() => {
  vi.stubEnv('PASSKEYS', 'on');
  state.staff = false;
  listPasskeys.mockReset().mockResolvedValue({
    state: 'ok',
    passkeys: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        label: 'My Phone',
        createdAt: new Date('2026-11-01T10:00:00Z'),
        lastUsedAt: null,
        synced: true,
      },
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

it('does not exist while the switch is off', async () => {
  vi.stubEnv('PASSKEYS', '');
  await expect(render()).rejects.toThrow('NOT_FOUND');
  expect(listPasskeys).not.toHaveBeenCalled();
});

it('lists passkeys by name with rename and remove, and the add control', async () => {
  const doc = await render({ n: 'added' });
  expect(doc.body.textContent).toContain('My Phone');
  expect(doc.body.textContent).toContain('Your passkey is saved.');
  expect(doc.querySelector('[data-add-passkey]')).not.toBeNull();
  expect(doc.querySelectorAll('input[name="passkeyId"]')).toHaveLength(2);
  expect(doc.body.textContent).not.toContain('Staff accounts');
});

it('tells staff their steps still use the password and the authenticator app', async () => {
  state.staff = true;
  expect((await render()).body.textContent).toContain('Staff accounts keep confirming');
});

it('says plainly when passkeys are not ready yet, with no add control', async () => {
  listPasskeys.mockResolvedValue({ state: 'unavailable' });
  const doc = await render();
  expect(doc.body.textContent).toContain('Passkeys Are Not Available Yet');
  expect(doc.querySelector('[data-add-passkey]')).toBeNull();
});
