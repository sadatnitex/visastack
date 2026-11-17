// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClearShareInboxOnSubmit } from './clear-share-inbox-on-submit';

/**
 * WP-PIC11: signing out empties the shared files still waiting on this phone, without ever
 * holding up or stopping the sign-out itself.
 */

let container: HTMLDivElement;
let root: Root;

function serviceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  serviceWorker(undefined);
});

async function signOut(action: () => Promise<void>) {
  await act(async () => {
    root.render(
      <form action={action}>
        <ClearShareInboxOnSubmit />
        <button type="submit">Sign Out</button>
      </form>,
    );
  });
  await act(async () => {
    container.querySelector('button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('signing out', () => {
  it('asks the worker to empty the shared inbox and still signs out', async () => {
    const postMessage = vi.fn();
    serviceWorker({ controller: { postMessage } });
    const action = vi.fn(async () => undefined);
    await signOut(action);
    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_SHARE_INBOX' });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no worker controls the page', { controller: null }],
    ['the browser has no service workers', undefined],
    [
      'the worker cannot take the message',
      {
        controller: {
          postMessage: () => {
            throw new Error('gone');
          },
        },
      },
    ],
  ])('signs out as before when %s', async (_label, value) => {
    serviceWorker(value);
    const action = vi.fn(async () => undefined);
    await signOut(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('adds nothing to the form it sits in', async () => {
    serviceWorker(undefined);
    await act(async () => {
      root.render(
        <form>
          <ClearShareInboxOnSubmit />
        </form>,
      );
    });
    const form = container.querySelector('form') as HTMLFormElement;
    expect([...new FormData(form).keys()]).toEqual([]);
  });

  it('sits inside both signed-in sign-out forms', () => {
    for (const file of ['../../app/app/workspace-frame.tsx', '../../app/app/account/page.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).toMatch(
        /<form\s+action=\{async \(\) => \{\s*'use server';\s*await signOutCurrentUser\(\);\s*\}\}\s*>\s*<ClearShareInboxOnSubmit \/>/,
      );
    }
  });
});
