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

vi.mock('./actions', () => ({ saveFactAction: vi.fn() }));
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

function box(key: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#f-${key}`);
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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('protected details in the profile editor', () => {
  it('shows the real value to the owner when the server opened it', () => {
    render({
      date_of_birth: { factId: 'f-dob', value: '1990-04-12', status: 'APPLICANT_CONFIRMED' },
      passport_number: { factId: 'f-pp', value: 'X1234567', status: 'APPLICANT_CONFIRMED' },
    });
    expect(box('date_of_birth').value).toBe('1990-04-12');
    expect(box('passport_number').value).toBe('X1234567');
    expect(hintFor('passport_number')).toBeNull();
  });

  it.each(['[protected]', '[Protected]', '[protected: could not decrypt]'])(
    'never puts the stand-in %j in a box, even if one reaches the editor',
    (standIn) => {
      render({
        date_of_birth: { factId: 'f-dob', value: standIn, status: 'APPLICANT_CONFIRMED' },
        passport_number: { factId: 'f-pp', value: standIn, status: 'APPLICANT_CONFIRMED' },
      });
      for (const key of ['date_of_birth', 'passport_number']) {
        expect(box(key).value).toBe('');
        expect(box(key).defaultValue).toBe('');
        expect(new FormData(box(key).closest('form') as HTMLFormElement).get('value')).toBe('');
        expect(hintFor(key)?.textContent).toMatch(/^Saved and Protected/);
      }
      expect(container.innerHTML).not.toContain('value="[');
    },
  );

  it('says "Saved and Protected" with an empty box when the value was not opened here', () => {
    render({
      passport_number: {
        factId: 'f-pp',
        value: null,
        status: 'APPLICANT_CONFIRMED',
        locked: 'no_key',
      },
    });
    const input = box('passport_number');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Saved and Protected');
    const hint = hintFor('passport_number');
    expect(hint?.textContent).toBe(
      'Saved and Protected. It cannot be shown or changed here right now.',
    );
    expect(input.getAttribute('aria-describedby')).toContain('f-passport_number-locked');
  });

  it('says it could not be opened when the key was there but the value would not open', () => {
    render({
      passport_number: {
        factId: 'f-pp',
        value: null,
        status: 'APPLICANT_CONFIRMED',
        locked: 'unreadable',
      },
    });
    expect(box('passport_number').value).toBe('');
    expect(hintFor('passport_number')?.textContent).toMatch(/could not be opened just now/);
  });

  it('asks for a lost value to be added again, with no badge claiming it is confirmed', () => {
    render({
      passport_number: { factId: 'f-pp', value: null, status: null, locked: 'lost' },
    });
    const input = box('passport_number');
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
    (lock) => {
      render({
        marital_status: { factId: 'f-ms', value: null, status: 'DECLARED', locked: lock },
        marital_status_other: { factId: 'f-mso', value: null, status: 'DECLARED', locked: lock },
      });
      const other = container.querySelector<HTMLInputElement>('#f-marital_status_other');
      expect(other).not.toBeNull();
      expect(other?.value).toBe('');
      expect(hintFor('marital_status_other')).not.toBeNull();
    },
  );

  it('still hides the Other text row when nothing is saved there', () => {
    render({ marital_status: { factId: 'f-ms', value: 'Single', status: 'DECLARED' } });
    expect(container.querySelector('#f-marital_status_other')).toBeNull();
  });

  it('links the hint to a protected choice box too', () => {
    render({
      marital_status: { factId: 'f-ms', value: '[protected]', status: 'DECLARED' },
    });
    const select = container.querySelector<HTMLSelectElement>('#f-marital_status');
    expect(select?.value).toBe('');
    expect(select?.getAttribute('aria-describedby')).toContain('f-marital_status-locked');
  });

  it('shows the stored value after a save, not the text typed before it', () => {
    render({ passport_number: { factId: 'f-pp', value: 'X1234567', status: 'DECLARED' } });
    typeInto(box('passport_number'), 'x1234567 ');
    render({
      passport_number: { factId: 'f-pp', value: 'X1234567-STORED', status: 'APPLICANT_CONFIRMED' },
    });
    expect(box('passport_number').value).toBe('X1234567-STORED');
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
  ])('treats %j exactly as the services package does', (sample) => {
    render({ passport_number: { factId: 'f-pp', value: sample, status: 'DECLARED' } });
    const standIn = isProtectedPlaceholder(sample);
    expect(box('passport_number').value).toBe(standIn ? '' : sample);
    expect(hintFor('passport_number') !== null).toBe(standIn);
  });
});
