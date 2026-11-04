import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ chrome: vi.fn(), session: vi.fn() }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => {
    mocks.session();
    return fn({ db: {}, accountId: 'acct-synthetic', email: 'synthetic@example.test' });
  },
}));
vi.mock('../../../../lib/workspace-chrome', () => ({
  loadWorkspaceChrome: async (...args: unknown[]) => {
    mocks.chrome(...args);
    return {
      accountName: 'Synthetic Self',
      toolbar: { unread: 0, personalPlan: null, agencyPlans: [] },
      travellers: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          name: 'Synthetic Self',
          relationship: 'SELF',
        },
      ],
      agencies: [],
      platform: null,
    };
  },
}));
vi.mock('../../../../lib/sign-out', () => ({ signOutCurrentUser: async () => undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { default: AnswersLayout } = await import('./layout');

const COLLECT = join(__dirname, '..', '..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/collect/account/answers';
});

describe('the signed-in answers page has the workspace frame', () => {
  it('wraps the page in the sidebar, top bar and account menu, and keeps the page content', async () => {
    const element = AnswersLayout({ children: <h1>Your Answers to Agencies</h1> }) as ReactElement;
    const Frame = element.type as (props: unknown) => Promise<ReactElement>;
    const html = await renderServer(Frame(element.props));

    expect(html).toContain('class="app-frame"');
    expect(html).toContain('data-workspace="personal"');
    expect(html).toContain('Your Answers to Agencies');
    const text = textOf(html);
    expect(text).toContain('Answers to Agencies');
    expect(text).toContain('Sign Out');
    expect(html).toContain('href="/collect/account/answers"');
    // The workspace chrome is read for the signed-in account, once.
    expect(mocks.chrome).toHaveBeenCalledTimes(1);
    expect(mocks.chrome.mock.calls[0]?.[1]).toMatchObject({ accountId: 'acct-synthetic' });
  });
});

describe('the guest collection pages keep their minimal look', () => {
  it('has a layout only at the answers page, never at /collect or /collect/account', () => {
    expect(existsSync(join(COLLECT, 'layout.tsx'))).toBe(false);
    expect(existsSync(join(COLLECT, 'account', 'layout.tsx'))).toBe(false);
    expect(existsSync(join(COLLECT, 'template.tsx'))).toBe(false);
    expect(existsSync(join(COLLECT, 'account', 'template.tsx'))).toBe(false);
    expect(existsSync(join(COLLECT, 'account', 'answers', 'layout.tsx'))).toBe(true);
  });

  it('is the only file under /collect that uses the workspace frame', () => {
    const users = filesUnder(COLLECT)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /workspace-(frame|shell|chrome)/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(COLLECT.length + 1));
    expect(users).toEqual([join('account', 'answers', 'layout.tsx')]);
  });
});
