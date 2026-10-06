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
  upload: vi.fn(),
}));
vi.mock('../app/app/actions', () => ({
  createApplicantAction: (...args: unknown[]) => actions.createApplicant(...args),
}));
vi.mock('../app/app/applicant/[id]/actions', () => ({
  uploadDocumentAction: (...args: unknown[]) => actions.upload(...args),
}));

const { AddApplicantForm } = await import('../app/app/add-applicant-form');
const { DocumentUploader, UPLOADING_SLOW_TEXT, UPLOADING_TEXT, UPLOAD_UNKNOWN_OUTCOME } =
  await import('../app/app/applicant/[id]/document-uploader');
const { StatusClient } = await import('../app/status/status-client');
const { SLOW_AFTER_MS } = await import('./resilience');

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
  it('says it is working, keeps the button focusable, refuses a second click, then says how it went', async () => {
    const held = gate<{ ok: boolean; message: string }>();
    actions.upload.mockReturnValue(held.promise);
    await act(async () => root.render(<DocumentUploader applicantId="a1" />));
    const button = $<HTMLButtonElement>('button[type="submit"]');
    const polite = $('output');
    button.focus();

    await press(button);

    expect(actions.upload).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toBe('Uploading…');
    expect(document.activeElement).toBe(button);
    expect(polite.textContent).toBe(UPLOADING_TEXT);

    // A second click, or the Enter key (which the browser turns into a click), changes nothing.
    await press(button);

    await act(async () => held.resolve({ ok: true, message: 'Uploaded passport.pdf.' }));
    // React queues a second submission behind the first rather than running it at once, so
    // the proof it was refused is that nothing runs after the first one finishes either.
    await act(async () => {
      for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    });
    expect(actions.upload).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.textContent).toBe('Upload document');
    expect(polite.textContent).toBe('Uploaded passport.pdf.');
    expect(document.activeElement).toBe(button);
  });

  it('says it is taking longer than usual once the wait passes the point where that is true', async () => {
    vi.useFakeTimers();
    const held = gate<{ ok: boolean; message: string }>();
    actions.upload.mockReturnValue(held.promise);
    await act(async () => root.render(<DocumentUploader applicantId="a1" />));
    await press($<HTMLButtonElement>('button[type="submit"]'));
    expect($('output').textContent).toBe(UPLOADING_TEXT);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS - 1);
    });
    expect($('output').textContent).toBe(UPLOADING_TEXT);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect($('output').textContent).toBe(UPLOADING_SLOW_TEXT);

    // Every action a test starts is finished before it ends. React holds all later updates
    // behind an action that is still running, so one left hanging would hide the next test's.
    await act(async () => held.resolve({ ok: true, message: '' }));
  });

  it('says it could not confirm the outcome when no answer ever comes, instead of an error screen', async () => {
    actions.upload.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => root.render(<DocumentUploader applicantId="a1" />));
    const button = $<HTMLButtonElement>('button[type="submit"]');
    button.focus();

    await press(button);

    const alert = $('[role="alert"]');
    expect(alert.textContent).toBe(UPLOAD_UNKNOWN_OUTCOME);
    expect(alert.textContent).not.toMatch(/failed/i);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    // No field is named, so focus is not taken from where the person already is.
    expect(document.activeElement).toBe(button);
  });
});

describe('the status page re-checking by itself', () => {
  it('keeps keyboard focus on "Check now" while a check runs, so nobody loses their place', async () => {
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
    expect(button.textContent).toBe('Check now');
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
    expect(button.textContent).toBe('Check now');
    expect(document.activeElement).toBe(button);
  });
});
