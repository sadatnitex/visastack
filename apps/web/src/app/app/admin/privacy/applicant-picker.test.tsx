// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicantSearchResult } from './actions';
import { ApplicantPicker, PICKER_DELAY_MS } from './applicant-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** WP-SB7: the legal hold picker searches as you type. Made-up applicants only. */
const RAHIM = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Rahim Uddin' };
const RAHIMA = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Rahima Akter' };

let root: Root;
let form: HTMLFormElement;
let search: ReturnType<typeof vi.fn<(text: string) => Promise<ApplicantSearchResult>>>;

beforeEach(() => {
  vi.useFakeTimers();
  form = document.createElement('form');
  document.body.append(form);
  root = createRoot(form);
  search = vi.fn(async () => ({ ok: true as const, matches: [RAHIM, RAHIMA] }));
  act(() => root.render(<ApplicantPicker search={search} />));
});
afterEach(() => {
  act(() => root.unmount());
  form.remove();
  vi.useRealTimers();
});

const box = () => form.querySelector<HTMLInputElement>('input[role="combobox"]') as HTMLInputElement;
const hidden = () => form.querySelector<HTMLInputElement>('input[type="hidden"]') as HTMLInputElement;
const options = () => [...form.querySelectorAll<HTMLLIElement>('[role="option"]')];
const status = () => form.querySelector('output')?.textContent ?? '';

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(box(), value);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(PICKER_DELAY_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function key(name: string) {
  act(() => {
    box().dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
}

describe('ApplicantPicker', () => {
  it('is a labelled combobox that controls a list and describes its status', () => {
    const input = box();
    const label = form.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toBe('Applicant');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(input.getAttribute('aria-controls') ?? '')?.getAttribute('role')).toBe(
      'listbox',
    );
    expect(input.getAttribute('aria-describedby')).toBe(form.querySelector('output')?.id);
    expect(hidden().name).toBe('applicantId');
    expect(hidden().value).toBe('');
  });

  it('waits for two letters and a pause before asking the server', async () => {
    type('R');
    await settle();
    expect(search).not.toHaveBeenCalled();
    expect(status()).toContain('at least 2 letters');
    type('Ra');
    type('Rah');
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Rah');
    expect(options().map((o) => o.textContent)).toEqual([
      'Rahim Uddin · ID 11111111',
      'Rahima Akter · ID 22222222',
    ]);
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(status()).toContain('2 applicants match');
  });

  it('moves with the arrow keys and chooses with Enter, filling the hidden id', async () => {
    type('Rah');
    await settle();
    key('ArrowDown');
    key('ArrowDown');
    expect(box().getAttribute('aria-activedescendant')).toBe(options()[1]?.id);
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    key('Enter');
    expect(hidden().value).toBe(RAHIMA.id);
    expect(box().value).toBe('Rahima Akter');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(status()).toBe('Chosen: Rahima Akter.');
    // Typing again forgets the choice, so a changed name never keeps the old id.
    type('Rahima A');
    expect(hidden().value).toBe('');
  });

  it('closes on Escape and chooses with the mouse too', async () => {
    type('Rah');
    await settle();
    key('Escape');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    key('ArrowDown');
    act(() => {
      options()[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(hidden().value).toBe(RAHIM.id);
  });

  it('drops a late reply to an older search', async () => {
    let releaseFirst: (value: ApplicantSearchResult) => void = () => undefined;
    search.mockImplementationOnce(
      () =>
        new Promise<ApplicantSearchResult>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    type('Rah');
    await settle();
    search.mockResolvedValueOnce({ ok: true, matches: [RAHIMA] });
    type('Rahima');
    await settle();
    await act(async () => {
      releaseFirst({ ok: true, matches: [RAHIM] });
      await Promise.resolve();
    });
    expect(options().map((o) => o.textContent)).toEqual(['Rahima Akter · ID 22222222']);
  });

  it('says so when nobody matches or the server refuses', async () => {
    search.mockResolvedValueOnce({ ok: true, matches: [] });
    type('Zz');
    await settle();
    expect(status()).toContain('No applicants match');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    search.mockResolvedValueOnce({ ok: false, message: 'Not authorized.' });
    type('Zzz');
    await settle();
    expect(status()).toBe('Not authorized.');
  });

  it('forgets the choice when the form resets after a save', async () => {
    type('Rah');
    await settle();
    key('ArrowDown');
    key('Enter');
    expect(hidden().value).toBe(RAHIM.id);
    act(() => form.reset());
    expect(hidden().value).toBe('');
    expect(box().value).toBe('');
  });
});
