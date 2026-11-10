// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { CodeInput, digitsOnly } from './code-input';

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

function mount(extra: Partial<Parameters<typeof CodeInput>[0]> = {}) {
  act(() =>
    root.render(
      <form>
        <label htmlFor="c">Six-Digit Code</label>
        <CodeInput id="c" name="code" {...extra} />
      </form>,
    ),
  );
}
const input = () => container.querySelector<HTMLInputElement>('input') as HTMLInputElement;
const boxes = () => [...container.querySelectorAll('.code-box')].map((box) => box.textContent);
function type(text: string) {
  act(() => {
    // React tracks the value itself; set it the way a keyboard or a paste does.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('digitsOnly', () => {
  it('keeps digits, drops spaces and dashes, and stops at the length', () => {
    expect(digitsOnly('123 456', 6)).toBe('123456');
    expect(digitsOnly('12-34-56-78', 6)).toBe('123456');
    expect(digitsOnly('ab1c2', 6)).toBe('12');
    expect(digitsOnly('', 6)).toBe('');
  });
});

describe('the code field', () => {
  it('is one real, labelled input with the phone keypad and one-time-code suggestion', () => {
    mount();
    expect(container.querySelectorAll('input')).toHaveLength(1);
    expect(input().name).toBe('code');
    expect(input().getAttribute('inputmode')).toBe('numeric');
    expect(input().getAttribute('autocomplete')).toBe('one-time-code');
    expect(input().required).toBe(true);
    expect(input().pattern).toBe('[0-9]{6}');
    expect(container.querySelector('label')?.getAttribute('for')).toBe(input().id);
  });

  it('has no cap on the input itself, so a pasted "123 456" is not cut before it is cleaned', () => {
    mount();
    expect(input().hasAttribute('maxlength')).toBe(false);
  });

  it('draws one box per digit and fills them as the code is typed', () => {
    mount();
    expect(boxes()).toEqual(['', '', '', '', '', '']);
    type('12');
    expect(boxes()).toEqual(['1', '2', '', '', '', '']);
    expect(input().value).toBe('12');
  });

  it('takes the whole code pasted at once, spaces and all, under the same field name', () => {
    mount();
    type('123 456');
    expect(input().value).toBe('123456');
    expect(boxes()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('code')).toBe(
      '123456',
    );
  });

  it('refuses letters and extra digits', () => {
    mount();
    type('12ab34567890');
    expect(input().value).toBe('123456');
  });

  it('marks the box being typed into while the field has focus', () => {
    mount();
    expect(container.querySelector('[data-active="true"]')).toBeNull();
    act(() => input().focus());
    type('12');
    const active = [...container.querySelectorAll('.code-box')].findIndex(
      (box) => box.getAttribute('data-active') === 'true',
    );
    expect(active).toBe(2);
  });

  it('hides the boxes from screen readers and passes the problem to the input', () => {
    mount({ 'aria-invalid': true, 'aria-describedby': 'msg' });
    expect(container.querySelector('.code-boxes-cells')?.getAttribute('aria-hidden')).toBe('true');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe('msg');
  });

  it('is the plain input before the page runs: the boxes are not drawn', () => {
    const html = renderToStaticMarkup(<CodeInput id="c" name="code" />);
    expect(html).toContain('data-drawn="false"');
  });

  it('takes the format check and length it is given', () => {
    mount({ length: 4, pattern: '[0-9]*' });
    expect(boxes()).toHaveLength(4);
    expect(input().pattern).toBe('[0-9]*');
  });

  it('has no accessibility violations', async () => {
    mount();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
