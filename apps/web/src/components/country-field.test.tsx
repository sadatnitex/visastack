// @vitest-environment jsdom
import { packMatchKey } from '@visastack/core';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { caseCountryOptions, resolveCaseCountry } from '../lib/case-choices';
import { CountryField, matchCountry } from './country-field';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const countries = caseCountryOptions();

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

function mount(props: Partial<Parameters<typeof CountryField>[0]> = {}) {
  act(() =>
    root.render(
      <form>
        <label htmlFor="where">Where Are You Going?</label>
        <CountryField id="where" countries={countries} {...props} />
      </form>,
    ),
  );
  return {
    input: container.querySelector<HTMLInputElement>(
      'input[name="destination"]',
    ) as HTMLInputElement,
    status: () => container.querySelector('output')?.textContent ?? '',
  };
}

/** Types into the box the way a person does, so React sees an ordinary input event. */
function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Chooses a name from the browser's list, which arrives as a replacement rather than typing. */
function pick(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }),
    );
  });
}
const leave = (input: HTMLInputElement) =>
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });

describe('the country box', () => {
  it('is a text box with the browser list of every country name, ready for a phone keyboard', () => {
    const { input } = mount();
    expect(input.type).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('words');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('enterkeyhint')).toBe('next');
    const list = container.querySelector(`datalist[id="${input.getAttribute('list') ?? ''}"]`);
    expect(list?.querySelectorAll('option').length).toBe(countries.length);
    expect(list?.querySelector('option[value="United Kingdom"]')).not.toBeNull();
    // The list holds names only: nothing like "Not Sure Yet" or a code is offered as a country.
    expect([...(list?.querySelectorAll('option') ?? [])].every((o) => o.value.length > 2)).toBe(
      true,
    );
  });

  it('is named by its label, and has no accessibility violations', async () => {
    mount({ hint: 'Type a name or open the list.' });
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('starts empty, on what was typed before, or on the name of a code', () => {
    for (const [given, shown] of [
      [undefined, ''],
      ['Narnia', 'Narnia'],
      ['JP', 'Japan'],
    ] as const) {
      act(() => root.render(null));
      expect(mount(given === undefined ? {} : { defaultValue: given }).input.value).toBe(shown);
    }
  });

  it('says which country a name stands for only once it is settled, never while typing', () => {
    const { input, status } = mount();
    // "Dominica" is a whole name, and also the start of "Dominican Republic".
    type(input, 'Dominica');
    expect(status()).toBe('');
    type(input, 'Dominican');
    expect(status()).toBe('');
    type(input, 'japan');
    expect(status()).toBe('');
    leave(input);
    expect(status()).toBe('Japan chosen.');
    expect(container.querySelector('output')?.getAttribute('class')).toContain('field-msg-ok');
    // Typing again takes the line away until the answer settles again.
    type(input, 'UK');
    expect(status()).toBe('');
    leave(input);
    expect(status()).toBe('United Kingdom chosen.');
  });

  it('says it at once when the name is chosen from the browser list', () => {
    const { input, status } = mount();
    type(input, 'Jap');
    expect(status()).toBe('');
    pick(input, 'Japan');
    expect(status()).toBe('Japan chosen.');
  });

  it('says "No country matches" only once the person leaves the box, and marks the box', () => {
    const { input, status } = mount();
    type(input, 'Atlantis');
    expect(status()).toBe('');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    leave(input);
    expect(status()).toBe('No country matches. Pick one from the list.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // Typing again takes the message away until the next time they leave.
    type(input, 'Atlantis 2');
    expect(status()).toBe('');
  });

  it('refuses a part of a name and leaves an empty box alone', () => {
    const { input, status } = mount();
    for (const half of ['Korea', 'Congo']) {
      type(input, half);
      leave(input);
      expect(status(), half).toBe('No country matches. Pick one from the list.');
    }
    type(input, '');
    leave(input);
    expect(status()).toBe('');
  });

  it('keeps the form’s own problem attributes and reads the hint, the problem and the status together', () => {
    const { input } = mount({
      hint: 'Type a name or open the list.',
      problem: { 'aria-invalid': true, 'aria-describedby': 'form-message' },
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described[0]).toBe('form-message');
    expect(described).toHaveLength(3);
    for (const id of described.slice(1))
      expect(container.querySelector(`[id="${id}"]`)).not.toBeNull();
  });
});

describe('the box agrees with the server about what a typed answer means', () => {
  it('reads every whole name, code and other name the same way the server does', () => {
    const typed = [
      ...countries.flatMap((c) => [c.name, c.name.toUpperCase(), c.iso2, ...(c.aka ?? [])]),
      'Korea',
      'Congo',
      'Atlantis',
      'gb',
      'Côte d’Ivoire',
      "Cote d'Ivoire",
      'timor leste',
      '  United   Kingdom ',
      '',
    ];
    for (const text of typed) {
      expect(matchCountry(text, countries)?.iso2 ?? null, text).toBe(
        resolveCaseCountry(text)?.iso2 ?? null,
      );
    }
  });

  it('folds text the same way as the shared match key', () => {
    // The box repeats that folding to stay free of the country data; keep the two together.
    // Every name that has an accent, hyphen or apostrophe, written in capitals.
    const folded = countries.filter((c) => packMatchKey(c.name) !== c.name.toLowerCase());
    expect(folded.length).toBeGreaterThan(0);
    for (const country of folded) {
      expect(matchCountry(country.name.toUpperCase(), countries)?.iso2, country.name).toBe(
        country.iso2,
      );
    }
  });
});
