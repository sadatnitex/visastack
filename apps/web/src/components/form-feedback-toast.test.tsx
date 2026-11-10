// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormMessage, type FormResult, NO_RESULT } from './form-feedback';
import { ToastHost, resetToastForTest } from './toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const show = (props: Partial<Parameters<typeof FormMessage>[0]> & { result: FormResult }) =>
  act(() =>
    root.render(
      <>
        <ToastHost />
        <FormMessage {...props} />
      </>,
    ),
  );
const strip = () => host.querySelector('.toast');

beforeEach(() => {
  vi.useFakeTimers();
  resetToastForTest();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('the done strip after a form result', () => {
  it('echoes a success that arrives after the page is showing, in the same words', () => {
    show({ result: NO_RESULT });
    expect(strip()).toBeNull();
    show({ result: { ok: true, message: 'Saved.' } });
    expect(strip()?.textContent).toContain('Saved.');
    // The form's own line is still the screen reader truth, unchanged.
    expect(host.querySelector('output.field-msg')?.textContent).toBe('Saved.');
  });

  it('does not echo a result the form was first drawn with', () => {
    show({ result: { ok: true, message: 'Saved.' } });
    expect(strip()).toBeNull();
  });

  it('never echoes a failure: it stays under the field', () => {
    show({ result: NO_RESULT });
    show({ result: { ok: false, message: 'Enter a value first.', field: 'value' } });
    expect(strip()).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Enter a value first.');
  });

  it('echoes once per result, not on every render', () => {
    const result = { ok: true, message: 'Saved.' };
    show({ result: NO_RESULT });
    show({ result });
    act(() => void vi.advanceTimersByTime(5000));
    expect(strip()).toBeNull();
    show({ result });
    expect(strip()).toBeNull();
  });

  it('echoes a second success with the same words as a new result', () => {
    show({ result: NO_RESULT });
    show({ result: { ok: true, message: 'Saved.' } });
    act(() => void vi.advanceTimersByTime(5000));
    show({ result: { ok: true, message: 'Saved.' } });
    expect(strip()?.textContent).toContain('Saved.');
  });

  it('stays quiet when the form opts out', () => {
    show({ result: NO_RESULT, toast: false });
    show({ result: { ok: true, message: 'Saved.' }, toast: false });
    expect(strip()).toBeNull();
  });

  it('stays quiet for a message kept for screen readers only', () => {
    show({ result: NO_RESULT, visuallyHidden: true });
    show({ result: { ok: true, message: 'Saved.' }, visuallyHidden: true });
    expect(strip()).toBeNull();
  });
});

describe('how forms hand over their result', () => {
  // The same walk the other source-scan guards use: one directory listing gives each entry's kind,
  // so no file is checked and then read separately.
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
      return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
    });

  it('never builds the result inline, which would echo it again on every render', () => {
    const offenders = sourceFiles(join(__dirname, '..')).filter((file) =>
      /<FormMessage[^>]*\sresult=\{\{/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
