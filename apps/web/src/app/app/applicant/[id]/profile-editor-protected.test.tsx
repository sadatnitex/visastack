// @vitest-environment jsdom
import { isProtectedPlaceholder } from '@visastack/services';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureView } from '../../../../lib/master-profile-fixture';

/**
 * WALD2: a protected detail (date of birth, passport number) never shows the stand-in
 * "[protected]" as the value in its box, so it can never be saved back. With its real value the
 * box shows it; with none it stays empty and says "Saved and Protected". After a save the box
 * shows what was stored, not what was typed before. Synthetic values only.
 */

const reveal = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ saveFactAction: vi.fn() }));
vi.mock('./profile-reveal-actions', () => ({ revealProfileValueAction: reveal }));
vi.mock('./section-actions', () => ({
  markEndedAction: vi.fn(),
  markNotCurrentAction: vi.fn(),
  openSuggestedSectionsAction: vi.fn(),
  saveOtherItemAction: vi.fn(),
  setExemptionAction: vi.fn(),
  setSectionOpenAction: vi.fn(),
}));
const { ProfileEditor } = await import('./profile-editor');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Value = {
  factId: string;
  value: string | null;
  status: string | null;
  locked?: 'no_key' | 'unreadable' | 'lost' | null;
  withheld?: boolean;
  updatedAt?: string | null;
};

let root: Root;
let container: HTMLDivElement;

function render(values: Record<string, Value>) {
  act(() =>
    root.render(
      <ProfileEditor
        applicantId="synthetic-person"
        values={values}
        repeatingValues={{}}
        assurance={new Map()}
        view={fixtureView()}
        startWithAll
      />,
    ),
  );
}

/**
 * The box of a detail. ESS1: a saved detail is a read row first, so its Edit is pressed to reach
 * the box; a detail not added yet (or to add again) has its box at once.
 */
async function box<T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(
  key: string,
): Promise<T> {
  if (!container.querySelector(`#f-${key}`)) {
    const edit = container.querySelector<HTMLButtonElement>(`button[data-edit="${key}"]`);
    if (edit) await act(async () => edit.click());
  }
  const input = container.querySelector<T>(`#f-${key}`);
  if (!input) throw new Error(`Missing box for ${key}`);
  return input;
}

function hintFor(key: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`#f-${key}-locked`);
}

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  reveal.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('protected details in the profile editor', () => {
  it('shows the real value to the owner when the server opened it', async () => {
    render({
      date_of_birth: { factId: 'f-dob', value: '1990-04-12', status: 'APPLICANT_CONFIRMED' },
      passport_number: { factId: 'f-pp', value: 'X1234567', status: 'APPLICANT_CONFIRMED' },
    });
    expect((await box('date_of_birth')).value).toBe('1990-04-12');
    expect((await box('passport_number')).value).toBe('X1234567');
    expect(hintFor('passport_number')).toBeNull();
  });

  it.each(['[protected]', '[Protected]', '[protected: could not decrypt]'])(
    'never puts the stand-in %j in a box, even if one reaches the editor',
    async (standIn) => {
      render({
        date_of_birth: { factId: 'f-dob', value: standIn, status: 'APPLICANT_CONFIRMED' },
        passport_number: { factId: 'f-pp', value: standIn, status: 'APPLICANT_CONFIRMED' },
      });
      for (const key of ['date_of_birth', 'passport_number']) {
        expect((await box(key)).value).toBe('');
        expect((await box(key)).defaultValue).toBe('');
        expect(new FormData((await box(key)).closest('form') as HTMLFormElement).get('value')).toBe(
          '',
        );
        expect(hintFor(key)?.textContent).toMatch(/^Saved and Protected/);
      }
      expect(container.innerHTML).not.toContain('value="[');
    },
  );

  it('says "Saved and Protected" with an empty box when the value was not opened here', async () => {
    render({
      passport_number: {
        factId: 'f-pp',
        value: null,
        status: 'APPLICANT_CONFIRMED',
        locked: 'no_key',
      },
    });
    const input = await box('passport_number');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Saved and Protected');
    const hint = hintFor('passport_number');
    expect(hint?.textContent).toBe(
      'Saved and Protected. It cannot be shown or changed here right now.',
    );
    expect(input.getAttribute('aria-describedby')).toContain('f-passport_number-locked');
  });

  it('says it could not be opened when the key was there but the value would not open', async () => {
    render({
      passport_number: {
        factId: 'f-pp',
        value: null,
        status: 'APPLICANT_CONFIRMED',
        locked: 'unreadable',
      },
    });
    expect((await box('passport_number')).value).toBe('');
    expect(hintFor('passport_number')?.textContent).toMatch(/could not be opened just now/);
  });

  it('asks for a lost value to be added again, with no badge claiming it is confirmed', async () => {
    render({
      passport_number: { factId: 'f-pp', value: null, status: null, locked: 'lost' },
    });
    const input = await box('passport_number');
    expect(input.value).toBe('');
    expect(input.placeholder).not.toBe('Saved and Protected');
    expect(hintFor('passport_number')?.textContent).toBe(
      'This detail needs to be added again. Type it and press Save.',
    );
    const row = input.closest('form');
    expect(row?.querySelector('.field-badges .badge-neutral')).toBeNull();
  });

  it.each(['no_key', 'unreadable', 'lost'] as const)(
    'keeps a saved Other text row on screen when it is protected and %s',
    async (lock) => {
      render({
        marital_status: { factId: 'f-ms', value: null, status: 'DECLARED', locked: lock },
        marital_status_other: { factId: 'f-mso', value: null, status: 'DECLARED', locked: lock },
      });
      const other = await box('marital_status_other');
      expect(other?.value).toBe('');
      expect(hintFor('marital_status_other')).not.toBeNull();
    },
  );

  it('still hides the Other text row when nothing is saved there', async () => {
    render({ marital_status: { factId: 'f-ms', value: 'Single', status: 'DECLARED' } });
    expect(container.querySelector('#f-marital_status_other')).toBeNull();
  });

  it('links the hint to a protected choice box too', async () => {
    render({
      marital_status: { factId: 'f-ms', value: '[protected]', status: 'DECLARED' },
    });
    const select = await box<HTMLSelectElement>('marital_status');
    expect(select?.value).toBe('');
    expect(select?.getAttribute('aria-describedby')).toContain('f-marital_status-locked');
  });

  it('shows the stored value after a save, not the text typed before it', async () => {
    render({ passport_number: { factId: 'f-pp', value: 'X1234567', status: 'DECLARED' } });
    typeInto(await box('passport_number'), 'x1234567 ');
    render({
      passport_number: { factId: 'f-pp', value: 'X1234567-STORED', status: 'APPLICANT_CONFIRMED' },
    });
    expect((await box('passport_number')).value).toBe('X1234567-STORED');
  });

  it.each([
    '[protected]',
    ' [PROTECTED] ',
    '[ protected ]',
    '[protected: could not decrypt]',
    '[Protected: Could Not Decrypt]',
    'protected',
    '[protected species]',
    'X1234567',
  ])('treats %j exactly as the services package does', async (sample) => {
    render({ passport_number: { factId: 'f-pp', value: sample, status: 'DECLARED' } });
    const standIn = isProtectedPlaceholder(sample);
    expect((await box('passport_number')).value).toBe(standIn ? '' : sample);
    expect(hintFor('passport_number') !== null).toBe(standIn);
  });
});

/**
 * ESS1: a protected value is not in the page. The read row is masked; Show or Edit asks the
 * owner-only reveal action for it, once per saved version, and keeps it in memory only.
 */
describe('withheld protected details (ESS1)', () => {
  const DOB = '1990-04-12';
  const withheld = (updatedAt = '2026-11-01T00:00:00.000Z'): Record<string, Value> => ({
    date_of_birth: {
      factId: 'f-dob',
      value: null,
      status: 'APPLICANT_CONFIRMED',
      withheld: true,
      updatedAt,
    },
  });
  const rowOf = (key: string) =>
    container.querySelector<HTMLElement>(`.profile-field-row[data-field="${key}"]`);
  /** A button of the detail's own row (the Passport Page Card has its own Show). */
  const button = (name: RegExp) => {
    const row = rowOf('date_of_birth') ?? container;
    const found = [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      name.test(b.textContent ?? ''),
    );
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
  };

  it('draws a masked read row with Show and Edit, and no value anywhere in the markup', () => {
    render(withheld());
    const row = rowOf('date_of_birth');
    expect(row?.querySelector('[data-masked="true"]')).not.toBeNull();
    expect(row?.querySelector('input[name="value"]')).toBeNull();
    expect(button(/^Show Date of Birth$/)).toBeTruthy();
    expect(button(/^Edit Date of Birth$/)).toBeTruthy();
    expect(container.innerHTML).not.toContain('1990');
    expect(container.innerHTML).not.toContain('Apr');
    expect(reveal).not.toHaveBeenCalled();
  });

  it('opens the value only on Show, prints it as a day, hides it again, and asks once', async () => {
    reveal.mockResolvedValue({ ok: true, value: DOB });
    render(withheld());
    await act(async () => button(/^Show Date of Birth$/).click());
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith('synthetic-person', 'f-dob');
    expect(rowOf('date_of_birth')?.querySelector('.profile-read-value')?.textContent).toBe(
      '12 Apr 1990',
    );
    await act(async () => button(/^Hide Date of Birth$/).click());
    expect(rowOf('date_of_birth')?.querySelector('[data-masked="true"]')).not.toBeNull();
    await act(async () => button(/^Show Date of Birth$/).click());
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('opens the value into the box on Edit, focuses it, and Cancel goes back to Edit', async () => {
    reveal.mockResolvedValue({ ok: true, value: DOB });
    render(withheld());
    const box = await (async () => {
      await act(async () => button(/^Edit Date of Birth$/).click());
      return container.querySelector<HTMLInputElement>('#f-date_of_birth');
    })();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(box?.value).toBe(DOB);
    expect(document.activeElement).toBe(box);
    await act(async () => button(/^Cancel Date of Birth$/).click());
    expect(container.querySelector('#f-date_of_birth')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Edit Date of Birth');
  });

  it('says so when the value cannot be opened, and still lets a new value be typed', async () => {
    reveal.mockResolvedValue({ ok: false });
    render(withheld());
    await act(async () => button(/^Show Date of Birth$/).click());
    expect(rowOf('date_of_birth')?.querySelector('output.profile-row-problem')?.textContent).toMatch(
      /could not be shown just now/,
    );
    expect(rowOf('date_of_birth')?.querySelector('[data-masked="true"]')).not.toBeNull();
    await act(async () => button(/^Edit Date of Birth$/).click());
    const box = container.querySelector<HTMLInputElement>('#f-date_of_birth');
    expect(box?.value).toBe('');
    expect(box?.placeholder).toBe('Saved and Protected');
  });

  it('opens a newly saved version afresh, never the value opened before', async () => {
    reveal.mockResolvedValueOnce({ ok: true, value: DOB });
    render(withheld());
    await act(async () => button(/^Show Date of Birth$/).click());
    reveal.mockResolvedValueOnce({ ok: true, value: '1991-05-13' });
    render(withheld('2026-11-02T00:00:00.000Z'));
    expect(container.innerHTML).not.toContain('12 Apr 1990');
    await act(async () => button(/^Show Date of Birth$/).click());
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(rowOf('date_of_birth')?.querySelector('.profile-read-value')?.textContent).toBe(
      '13 May 1991',
    );
  });

  it('keeps the value out of the address and the browser storage', async () => {
    reveal.mockResolvedValue({ ok: true, value: DOB });
    const href = window.location.href;
    render(withheld());
    await act(async () => button(/^Show Date of Birth$/).click());
    expect(window.location.href).toBe(href);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(DOB);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(DOB);
  });
});
