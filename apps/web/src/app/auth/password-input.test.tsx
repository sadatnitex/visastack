// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PasswordInput } from './password-input';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <form>
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          defaultValue="synthetic-password"
        />
      </form>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it('toggles the actual named field without losing its value, constraints or submitting', () => {
  const input = container.querySelector('input');
  const button = container.querySelector('button');
  const form = container.querySelector('form');
  if (!input || !button || !form) throw new Error('Password controls');
  let submitted = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitted = true;
  });
  expect(input.type).toBe('password');
  expect(button.getAttribute('aria-label')).toBe('Show password');
  act(() => button.click());
  expect(input.type).toBe('text');
  expect(input.value).toBe('synthetic-password');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(input.required).toBe(true);
  expect(input.minLength).toBe(8);
  expect(new FormData(form).get('password')).toBe('synthetic-password');
  expect(submitted).toBe(false);
  act(() => button.click());
  expect(input.type).toBe('password');
  expect(button.getAttribute('aria-label')).toBe('Show password');
});
