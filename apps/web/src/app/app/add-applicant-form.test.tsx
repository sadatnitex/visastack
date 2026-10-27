// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ createApplicantAction: vi.fn() }));
const { AddApplicantForm } = await import('./add-applicant-form');
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

const select = () => {
  const node = container.querySelector<HTMLSelectElement>('select[name="relationship"]');
  if (!node) throw new Error('relationship box');
  return node;
};
const authority = () =>
  container.querySelector<HTMLInputElement>('input[name="authorityConfirmed"]');
function choose(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
      select(),
      value,
    );
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Add an Applicant: who the new record is for (owner finding 7)', () => {
  it('starts on Myself when the account has no record for the person yet', () => {
    act(() => root.render(<AddApplicantForm />));
    expect(select().value).toBe('SELF');
    expect([...select().options].map((option) => option.textContent)).toEqual([
      'Myself',
      'Family Member',
      'Minor (Guardian)',
    ]);
    expect(authority()).toBeNull();
    expect(container.textContent).not.toContain('already have a record for yourself');
  });

  it('starts on Family Member, with the authority confirmation, once a record for yourself exists', () => {
    act(() => root.render(<AddApplicantForm selfAdded />));
    expect(select().value).toBe('FAMILY_MEMBER');
    expect(authority()?.required).toBe(true);
    expect(select().options[0]?.textContent).toBe('Myself (Already Added)');
    expect(select().hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps Myself a choice, as the service allows, and says what choosing it again does', () => {
    act(() => root.render(<AddApplicantForm selfAdded />));
    choose('SELF');
    expect(select().value).toBe('SELF');
    expect(authority()).toBeNull();
    const noteId = select().getAttribute('aria-describedby');
    expect(noteId).toBeTruthy();
    expect(document.getElementById(noteId ?? '')?.textContent).toBe(
      'You already have a record for yourself. Choosing Myself again adds a second, separate record; your details and documents are not copied into it.',
    );
    const form = container.querySelector('form');
    if (!form) throw new Error('form');
    expect(new FormData(form).get('relationship')).toBe('SELF');
  });
});
