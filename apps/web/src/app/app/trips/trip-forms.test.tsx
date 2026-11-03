// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  startGroupTripAction: vi.fn(),
  addTravellersAction: vi.fn(),
  removeTravellerAction: vi.fn(),
  addTripEvidenceAction: vi.fn(),
  removeTripEvidenceAction: vi.fn(),
  tripEvidenceAllowanceAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
const { AddTravellersForm, GroupTripStartForm } = await import('./trip-forms');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(actions)) fn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const people = [{ applicantId: 'p1', name: 'Rahima Akter' }];
const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`);
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text);
const open = () => act(() => button('Add a Family Member')?.click());

describe('Add a Family Member in the trip forms', () => {
  it('is a button until it is opened, and a closed section sends nothing', () => {
    act(() => root.render(<GroupTripStartForm countries={[]} purposes={[]} travellers={people} />));
    expect(button('Add a Family Member')?.getAttribute('aria-expanded')).toBe('false');
    expect(field('newName')).toBeNull();
    expect(field('newAuthority')).toBeNull();
  });

  it('opens to a name, a relationship that starts on Family Member, and the authority confirmation', () => {
    act(() => root.render(<GroupTripStartForm countries={[]} purposes={[]} travellers={people} />));
    open();
    expect(field('newName')?.required).toBe(true);
    expect(container.querySelectorAll<HTMLInputElement>('[name="newKind"]')).toHaveLength(2);
    expect(
      container.querySelector<HTMLInputElement>('[name="newKind"][value="FAMILY_MEMBER"]')?.checked,
    ).toBe(true);
    expect(field('newAuthority')?.required).toBe(true);
    expect(container.textContent).toContain('I confirm I have authority');
  });

  it('moves focus to the name when it opens, and back to the button on Cancel', () => {
    act(() => root.render(<GroupTripStartForm countries={[]} purposes={[]} travellers={people} />));
    open();
    expect(document.activeElement).toBe(field('newName'));
    act(() => button('Cancel')?.click());
    expect(document.activeElement).toBe(button('Add a Family Member'));
  });

  it('closes again on Cancel and removes the fields', () => {
    act(() => root.render(<GroupTripStartForm countries={[]} purposes={[]} travellers={people} />));
    open();
    act(() => button('Cancel')?.click());
    expect(field('newName')).toBeNull();
    expect(button('Add a Family Member')).toBeDefined();
  });

  it('on a trip where everyone is already added, offers one quiet button and no empty Add button', () => {
    act(() => root.render(<AddTravellersForm tripId="t1" travellers={[]} />));
    expect(container.textContent).toContain('Everyone you manage is already on this trip.');
    expect(field('newName')).toBeNull();
    expect(field('traveller')).toBeNull();
    expect(button('Add Travellers')).toBeUndefined();
    open();
    expect(field('newName')).not.toBeNull();
    expect(button('Add Family Member')).toBeDefined();
  });

  it('ticks a family member made before a problem, so trying again does not make a second one', async () => {
    actions.addTravellersAction.mockResolvedValue({
      ok: false,
      message: 'Karim Uddin: something went wrong.',
      created: 'p2',
    });
    act(() => root.render(<AddTravellersForm tripId="t1" travellers={people} />));
    open();
    const name = field('newName');
    const authority = field('newAuthority');
    if (!name || !authority) throw new Error('fields');
    name.value = 'Karim Uddin';
    authority.checked = true;
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
    });
    expect(actions.addTravellersAction).toHaveBeenCalledTimes(1);
    // The page reads the new person after the action; the list now has them.
    act(() =>
      root.render(
        <AddTravellersForm
          tripId="t1"
          travellers={[...people, { applicantId: 'p2', name: 'Karim Uddin' }]}
        />,
      ),
    );
    const ticked = [...container.querySelectorAll<HTMLInputElement>('[name="traveller"]')]
      .filter((c) => c.checked)
      .map((c) => c.value);
    expect(ticked).toEqual(['p2']);
    expect(field('newName')).toBeNull();
  });
});
