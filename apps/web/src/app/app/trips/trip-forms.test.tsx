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
  removeCompanionAction: vi.fn(),
  resendCompanionAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
const { AddTravellersForm, RemoveCompanionForm, GroupTripStartForm } = await import('./trip-forms');
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

describe('Add Someone Else in the trip forms', () => {
  const openPerson = () => act(() => button('Add Someone Else')?.click());
  const render = (companionsOn: boolean) =>
    act(() =>
      root.render(
        <GroupTripStartForm
          countries={[]}
          purposes={[]}
          travellers={people}
          companionsOn={companionsOn}
        />,
      ),
    );

  it('is a quiet button next to Add a Family Member, closed by default, and a closed section sends nothing', () => {
    render(true);
    const toggle = button('Add Someone Else');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.className).toContain('btn-secondary');
    expect(button('Add a Family Member')).toBeDefined();
    expect(field('newPersonName')).toBeNull();
    expect(field('newPersonEmail')).toBeNull();
  });

  it('does not render at all while the feature is off, and the family member button is unchanged', () => {
    render(false);
    expect(button('Add Someone Else')).toBeUndefined();
    expect(container.textContent).not.toContain('Someone Else');
    expect(button('Add a Family Member')).toBeDefined();
  });

  it('does not render when the page gives no answer (off by default)', () => {
    act(() => root.render(<GroupTripStartForm countries={[]} purposes={[]} travellers={people} />));
    expect(button('Add Someone Else')).toBeUndefined();
  });

  it('opens to a required name and an optional email, with one line of hint', () => {
    render(true);
    openPerson();
    const name = field('newPersonName');
    const email = field('newPersonEmail');
    expect(name?.required).toBe(true);
    expect(name?.maxLength).toBe(120);
    expect(email?.type).toBe('email');
    expect(email?.required).toBe(false);
    expect(email?.autocomplete).toBe('off');
    expect(container.textContent).toContain(
      'With an email, they are invited to join and choose what to share with you.',
    );
    // Nothing of the family member section is open.
    expect(field('newName')).toBeNull();
  });

  it('names its fields for a screen reader and ties the hint to both', () => {
    render(true);
    openPerson();
    const name = field('newPersonName');
    const email = field('newPersonEmail');
    expect(container.querySelector(`label[for="${name?.id}"]`)?.textContent).toBe('Name');
    expect(container.querySelector(`label[for="${email?.id}"]`)?.textContent).toBe('Email');
    expect(container.querySelector('.trip-member-fields legend')?.textContent).toBe(
      'Add Someone Else',
    );
    const hintId = name?.getAttribute('aria-describedby') ?? '';
    expect(container.querySelector(`[id="${hintId}"]`)?.textContent).toContain(
      'they are invited to join',
    );
    expect(email?.getAttribute('aria-describedby')).toBe(hintId);
  });

  it('moves focus to the name when it opens, and back to its button on Cancel', () => {
    render(true);
    openPerson();
    expect(document.activeElement).toBe(field('newPersonName'));
    act(() => button('Cancel')?.click());
    expect(document.activeElement).toBe(button('Add Someone Else'));
    expect(field('newPersonName')).toBeNull();
  });

  it('can be open together with Add a Family Member, each with its own Cancel', () => {
    render(true);
    open();
    openPerson();
    expect(field('newName')).not.toBeNull();
    expect(field('newPersonName')).not.toBeNull();
    const cancels = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Cancel',
    );
    expect(cancels).toHaveLength(2);
  });

  it('marks the email as the problem, as the action says, and puts focus there', async () => {
    actions.addTravellersAction.mockResolvedValue({
      ok: false,
      message: 'You have already added someone with that email to this trip.',
      field: 'newPersonEmail',
    });
    act(() => root.render(<AddTravellersForm tripId="t1" travellers={people} companionsOn />));
    openPerson();
    const name = field('newPersonName');
    const email = field('newPersonEmail');
    if (!name || !email) throw new Error('fields');
    name.value = 'Nadia Rahman';
    email.value = 'friend@example.com';
    await act(async () => {
      container.querySelector('form')?.requestSubmit();
    });
    expect(actions.addTravellersAction).toHaveBeenCalledTimes(1);
    expect(field('newPersonEmail')?.getAttribute('aria-invalid')).toBe('true');
    expect(field('newPersonName')?.getAttribute('aria-invalid')).toBeNull();
    expect(container.textContent).toContain(
      'You have already added someone with that email to this trip.',
    );
    expect(document.activeElement).toBe(field('newPersonEmail'));
  });

  it('on a trip where everyone is already added, the one button names what is being added', () => {
    act(() => root.render(<AddTravellersForm tripId="t1" travellers={[]} companionsOn />));
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    openPerson();
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Add Someone Else');
    open();
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Add People');
  });

  it('on that trip with the feature off, nothing about someone else appears', () => {
    act(() => root.render(<AddTravellersForm tripId="t1" travellers={[]} companionsOn={false} />));
    expect(container.textContent).not.toContain('Someone Else');
    expect(button('Add a Family Member')).toBeDefined();
  });
});

describe('Remove for a companion asks once', () => {
  it('shows one quiet Remove, then Yes, Remove and Keep, and sends nothing until it is confirmed', () => {
    act(() =>
      root.render(<RemoveCompanionForm tripId="t1" companionId="c1" name="Nadia Rahman" />),
    );
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    act(() => button('Remove')?.click());
    expect(container.textContent).toContain('Remove Nadia Rahman? They lose access at once.');
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Yes, Remove');
    act(() => button('Keep')?.click());
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(button('Remove')?.getAttribute('aria-label')).toBe('Remove: Nadia Rahman');
  });
});
