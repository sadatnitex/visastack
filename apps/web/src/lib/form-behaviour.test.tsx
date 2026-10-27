// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the accessibility work promises, shown by running it: the real components in a
 * DOM, a real submit, and what a keyboard or screen reader user would meet. The markup
 * checks elsewhere (`a11y-forms.test.tsx`) show the right attributes are in the page;
 * these show the behaviour that depends on running code: where focus goes, what the
 * announcement regions say and when, and that a second click is refused.
 *
 * Not the same as using a screen reader. A DOM tells us which element has focus and what
 * text a live region holds; it cannot tell us how a particular screen reader voices it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  createApplicant: vi.fn(),
}));
vi.mock('../app/app/actions', () => ({
  createApplicantAction: (...args: unknown[]) => actions.createApplicant(...args),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { AddApplicantForm } = await import('../app/app/add-applicant-form');
const { DocumentUploader, UPLOAD_UNKNOWN_OUTCOME } = await import(
  '../app/app/applicant/[id]/document-uploader'
);
const { StatusClient } = await import('../app/status/status-client');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const $ = <T extends Element>(selector: string): T => {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Nothing in the page matches ${selector}`);
  return found;
};

/** A promise the test settles by hand, to hold an action in its "working" state. */
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Submits the form the way a click on its button does, skipping the browser's own checks. */
async function press(button: HTMLButtonElement) {
  // The browser would stop an empty required field before the server is asked; these tests
  // are about what happens once the server has answered, so its checks are switched off.
  (button.form as HTMLFormElement).noValidate = true;
  await act(async () => {
    button.click();
    // Let the action settle and React commit its answer (a few turns of the event loop's
    // microtask queue; timers are not used, so this also works under fake timers).
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  });
}

describe('a form whose problem is about one field', () => {
  it('moves focus to that field, marks it invalid and ties it to the alert that says why', async () => {
    actions.createApplicant.mockResolvedValue({
      ok: false,
      message: 'Enter a name.',
      field: 'displayName',
    });
    await act(async () => root.render(<AddApplicantForm />));
    const input = $<HTMLInputElement>('input[name="displayName"]');
    // Spaces satisfy the browser's "required" but not the server's own check.
    input.value = '   ';
    const button = $<HTMLButtonElement>('button[type="submit"]');
    button.focus();
    expect(document.activeElement).toBe(button);

    await press(button);

    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toBe('Enter a name.');
    // The polite region stays empty, so the failure is announced once, not twice.
    expect($('output').textContent).toBe('');
  });

  it('clears the mark when the next try works, so a fixed field is not still called invalid', async () => {
    actions.createApplicant
      .mockResolvedValueOnce({ ok: false, message: 'Enter a name.', field: 'displayName' })
      .mockResolvedValueOnce({ ok: true, message: 'Added.' });
    await act(async () => root.render(<AddApplicantForm />));
    const input = $<HTMLInputElement>('input[name="displayName"]');
    const button = $<HTMLButtonElement>('button[type="submit"]');
    input.value = '   ';
    await press(button);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    input.value = 'Rahim Uddin';
    await press(button);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect($('output').textContent).toBe('Added.');
    expect($('[role="alert"]').textContent).toBe('');
  });
});

describe('an upload that takes a while', () => {
  it('keeps the buttons focusable, says which file is going, then how each one went', async () => {
    const sent: Array<{ onload: (() => void) | null; status: number; responseText: string }> = [];
    class HeldRequest {
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      responseText = '';
      timeout = 0;
      open() {}
      setRequestHeader() {}
      send() {
        sent.push(this);
      }
    }
    vi.stubGlobal('XMLHttpRequest', HeldRequest);
    await act(async () => root.render(<DocumentUploader applicantId="a1" />));
    const choose = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Choose Files',
    ) as HTMLButtonElement;
    const input = $<HTMLInputElement>('[data-testid="document-files"]');
    const polite = $('output.upload-summary');
    choose.focus();

    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'passport.jpg', { type: 'image/jpeg' })],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(sent).toHaveLength(1);
    expect(polite.textContent).toBe('Uploading 1 of 1: passport.jpg.');
    // Nothing becomes disabled and focus stays where the person is, so more files can be added.
    expect(container.querySelector('[disabled]')).toBeNull();
    expect(document.activeElement).toBe(choose);

    const request = sent[0] as (typeof sent)[number];
    await act(async () => {
      request.status = 201;
      request.responseText = JSON.stringify({ message: 'Passport added.' });
      request.onload?.();
    });
    expect(polite.textContent).toBe('1 file added.');
    expect(document.activeElement).toBe(choose);
  });

  it('says it could not confirm the outcome when no answer ever comes, instead of an error screen', async () => {
    const sent: Array<{ onerror: (() => void) | null }> = [];
    class LostRequest {
      upload = { onprogress: null };
      onload = null;
      onerror: (() => void) | null = null;
      ontimeout = null;
      onabort = null;
      status = 0;
      responseText = '';
      timeout = 0;
      open() {}
      setRequestHeader() {}
      send() {
        sent.push(this);
      }
    }
    vi.stubGlobal('XMLHttpRequest', LostRequest);
    await act(async () => root.render(<DocumentUploader applicantId="a1" />));
    const input = $<HTMLInputElement>('[data-testid="document-files"]');
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'passport.jpg', { type: 'image/jpeg' })],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => sent[0]?.onerror?.());

    const line = $('.upload-item-status');
    expect(line.textContent).toContain(UPLOAD_UNKNOWN_OUTCOME);
    expect(line.textContent).not.toMatch(/failed/i);
  });
});

describe('the status page re-checking by itself', () => {
  it('keeps keyboard focus on "Check Now" while a check runs, so nobody loses their place', async () => {
    vi.useFakeTimers();
    const second = gate<unknown>();
    const answer = { ok: true, status: 200, json: async () => ({ status: 'ready', platform: {} }) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer) // first check, live
      .mockResolvedValueOnce(answer) // first check, ready
      .mockReturnValueOnce(second.promise) // the automatic check after 15 seconds, live
      .mockReturnValueOnce(second.promise); // ... and ready
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<StatusClient />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const button = $<HTMLButtonElement>('button');
    expect(button.textContent).toBe('Check Now');
    button.focus();
    expect(document.activeElement).toBe(button);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    // The automatic check is under way and the button says so, without being disabled.
    expect(button.textContent).toBe('Checking…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(button);

    await act(async () => second.resolve(answer));
    expect(button.textContent).toBe('Check Now');
    expect(document.activeElement).toBe(button);
  });
});
