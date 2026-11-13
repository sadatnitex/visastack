// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  setShareLevelAction: vi.fn(),
  leaveTripAction: vi.fn(),
  planOwnCaseAction: vi.fn(),
  choosePaperAction: vi.fn(),
  removePaperAction: vi.fn(),
}));
vi.mock('./actions', () => actions);
const { ChoosePaperForm, LeaveTripForm, PlanOwnCaseForm, RemovePaperForm, ShareLevelForm } =
  await import('./joined-trip-forms');
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

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text);
const submit = () => container.querySelector('button[type="submit"]');

describe('Leave This Trip', () => {
  it('shows one quiet button, asks once, and sends nothing until confirmed', () => {
    act(() => root.render(<LeaveTripForm tripId="t1" />));
    // Nothing can be sent yet: the first button only opens the question.
    expect(submit()).toBeNull();
    expect(button('Leave This Trip')?.className).toContain('btn-secondary');
    expect(container.querySelector('.btn-primary')).toBeNull();
    act(() => button('Leave This Trip')?.click());
    expect(container.textContent).toContain(
      'Leave this trip? The organiser will no longer see you.',
    );
    expect(submit()?.textContent).toBe('Yes, Leave This Trip');
    expect(actions.leaveTripAction).not.toHaveBeenCalled();
    // Staying puts everything back, still without sending anything.
    act(() => button('Stay')?.click());
    expect(submit()).toBeNull();
    expect(button('Leave This Trip')).toBeDefined();
    expect(actions.leaveTripAction).not.toHaveBeenCalled();
  });

  it('sends the trip, once confirmed, and only then', async () => {
    actions.leaveTripAction.mockResolvedValue({ ok: true, message: '' });
    act(() => root.render(<LeaveTripForm tripId="t1" />));
    act(() => button('Leave This Trip')?.click());
    await act(async () => submit()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(actions.leaveTripAction).toHaveBeenCalledTimes(1);
    const sent = actions.leaveTripAction.mock.calls[0]?.[1] as FormData;
    expect(sent.get('tripId')).toBe('t1');
  });
});

describe('What You Share with the Organiser', () => {
  const choices = [
    { value: 'NAME_ONLY', label: 'Name Only', line: 'Your name and that you joined.' },
    { value: 'PLAN_STATUS', label: 'Plan Status', line: 'Also one plain phrase.' },
    { value: 'TRAVEL_BOOKINGS', label: 'Travel Bookings', line: 'Also booking names.' },
  ];

  it('shows the three levels with one line each, the current one chosen, and a single Save', () => {
    act(() => root.render(<ShareLevelForm tripId="t1" current="PLAN_STATUS" choices={choices} />));
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(['NAME_ONLY', 'PLAN_STATUS', 'TRAVEL_BOOKINGS']);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['PLAN_STATUS']);
    expect(container.textContent).toContain('What You Share with the Organiser');
    for (const choice of choices) expect(container.textContent).toContain(choice.line);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(submit()?.textContent).toBe('Save');
    // Which one is chosen is a real control state, not colour.
    expect(radios.every((r) => r.name === 'shareLevel')).toBe(true);
  });

  it('puts focus on the choice and says why when the action names the field', async () => {
    actions.setShareLevelAction.mockResolvedValue({
      ok: false,
      message: 'Choose how much you want to share.',
      field: 'shareLevel',
    });
    act(() => root.render(<ShareLevelForm tripId="t1" current="NAME_ONLY" choices={choices} />));
    await act(async () => submit()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const chosen = container.querySelector<HTMLInputElement>('input[value="NAME_ONLY"]');
    expect(chosen?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(chosen);
    expect(container.textContent).toContain('Choose how much you want to share.');
  });
});

describe('Plan My Own Case for This Trip', () => {
  it('is one filled button that names what it does', () => {
    act(() => root.render(<PlanOwnCaseForm tripId="t1" />));
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(submit()?.textContent).toBe('Plan My Own Case for This Trip');
    expect(submit()?.className).toContain('btn-primary');
    expect(container.querySelector<HTMLInputElement>('[name="tripId"]')?.value).toBe('t1');
  });
});

describe('papers', () => {
  const papers = [
    { documentId: 'd1', name: 'Tokyo hotel.pdf', kind: 'Hotel or Stay Booking' },
    { documentId: 'd2', name: 'Flight to Tokyo.pdf', kind: 'Flight Ticket' },
  ];

  it('offers each paper by name and kind in a labelled list, with a quiet Show This Paper', () => {
    act(() => root.render(<ChoosePaperForm tripId="t1" options={papers} />));
    const select = container.querySelector('select');
    expect(select?.id).toBeTruthy();
    expect(container.querySelector(`label[for="${select?.id}"]`)?.textContent).toBe(
      'Paper to Show',
    );
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual([
      'Choose a Paper',
      'Tokyo hotel.pdf (Hotel or Stay Booking)',
      'Flight to Tokyo.pdf (Flight Ticket)',
    ]);
    expect(select?.required).toBe(true);
    expect(submit()?.textContent).toBe('Show This Paper');
    expect(submit()?.className).toContain('btn-secondary');
  });

  it('marks the paper list when the action says the paper is the problem', async () => {
    actions.choosePaperAction.mockResolvedValue({
      ok: false,
      message: 'That paper is not available.',
      field: 'documentId',
    });
    act(() => root.render(<ChoosePaperForm tripId="t1" options={papers} />));
    const select = container.querySelector('select');
    if (select) select.value = 'd1';
    await act(async () => submit()?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('select')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('Remove names the paper it removes', () => {
    act(() => root.render(<RemovePaperForm tripId="t1" paper={papers[0] as (typeof papers)[0]} />));
    expect(submit()?.textContent).toBe('Remove');
    expect(submit()?.getAttribute('aria-label')).toBe('Remove: Tokyo hotel.pdf');
    expect(container.querySelector<HTMLInputElement>('[name="documentId"]')?.value).toBe('d1');
  });
});

describe('joined trip forms under Bengali', () => {
  const draw = async (node: React.ReactNode) => {
    const { I18nProvider } = await import('../../../../components/i18n-provider');
    act(() =>
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          {node}
        </I18nProvider>,
      ),
    );
  };
  const words = async (name: string) => {
    const { appTripInvitationsCatalog } = await import('../../../../i18n/app-trip-invitations');
    return (
      (appTripInvitationsCatalog.bn as Record<string, string>)[
        `appTripInvitations.appTripInvitationsIdJoinedTripForms.${name}`
      ] ?? `missing ${name}`
    );
  };

  it('leaving asks first in Bengali, with Stay', async () => {
    await draw(<LeaveTripForm tripId="t1" />);
    const leaveWords = await words('leaveThisTrip');
    const leave = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === leaveWords,
    );
    if (!leave) throw new Error('Leave This Trip button');
    act(() => leave.click());
    expect(container.textContent).toContain(await words('leaveThisTripTheOrganiserWill'));
    expect(container.textContent).toContain(await words('stay'));
    expect(container.textContent).not.toContain('Leave this trip? The organiser');
  });

  it('choosing a paper: the label and the first choice are Bengali', async () => {
    await draw(
      <ChoosePaperForm
        tripId="t1"
        options={[{ documentId: 'd1', name: 'Tokyo hotel.pdf', kind: 'Hotel Booking' }]}
      />,
    );
    expect(container.textContent).toContain(await words('paperToShow'));
    expect(container.textContent).toContain(await words('chooseAPaper'));
    expect(container.textContent).not.toContain('Paper to Show');
  });
});
