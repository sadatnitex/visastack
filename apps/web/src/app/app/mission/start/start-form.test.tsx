// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { caseCountryOptions, casePurposeGroups } from '../../../../lib/case-choices';
import { COMMON_PURPOSE_KEYS } from '../../../../lib/common-purposes';

const actions = vi.hoisted(() => ({ startTripAction: vi.fn() }));
vi.mock('./actions', () => actions);
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const { TripStartForm } = await import('./start-form');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const people = [{ applicantId: 'p1', name: 'Rahima Akter' }];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  actions.startTripAction.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const two = [...people, { applicantId: 'p2', name: 'Karim Hossain' }];
const render = (
  travellers: readonly { applicantId: string; name: string }[] = people,
  initialTravellerId?: string,
) =>
  act(() =>
    root.render(
      <TripStartForm
        countries={caseCountryOptions()}
        purposes={casePurposeGroups()}
        travellers={travellers}
        {...(initialTravellerId ? { initialTravellerId } : {})}
      />,
    ),
  );
const ticked = () =>
  [...container.querySelectorAll<HTMLInputElement>('input[name="traveller"]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
const box = () => container.querySelector<HTMLInputElement>('input[name="destination"]');

function type(input: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Start a Trip: where are you going?', () => {
  it('is one text box with the list of names, in place of a 150-line pick list', async () => {
    render();
    expect(container.querySelector('select[name="destination"]')).toBeNull();
    const input = box();
    expect(input?.type).toBe('text');
    const listed = container.querySelectorAll(
      `datalist[id="${input?.getAttribute('list')}"] option`,
    );
    expect(listed.length).toBe(caseCountryOptions().length);
    // The purpose opens on picture tiles (P15); the grouped list is behind More Purposes.
    expect(container.querySelector('select[name="purpose"]')).toBeNull();
    expect(container.querySelectorAll('input[type="radio"][name="purpose"]')).toHaveLength(8);
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('is named by its question and keeps the plain hint', () => {
    render();
    const label = container.querySelector(`label[for="${box()?.id}"]`);
    expect(label?.textContent).toBe('Where Are You Going?');
    expect(container.textContent).toContain('Type a name or open the list.');
  });

  it('sends the typed text with the form, for the server to turn into one country', () => {
    actions.startTripAction.mockResolvedValue({ ok: true, message: '' });
    render();
    const input = box() as HTMLInputElement;
    type(input, 'Japan');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('destination')).toBe('Japan');
    expect(container.querySelector('output')?.textContent).toBe('Japan chosen.');
  });

  it('keeps what was typed after the server refuses the form', async () => {
    actions.startTripAction.mockResolvedValue({
      ok: false,
      message: 'We could not match that to a country. Pick one from the list.',
      field: 'destination',
    });
    render();
    const input = box() as HTMLInputElement;
    type(input, 'Korea');
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(box()?.value).toBe('Korea');
    expect(container.textContent).toContain('We could not match that to a country.');
    expect(box()?.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('Start a Trip: arriving from the Cases list', () => {
  it('ticks the traveller it was sent for, and nobody else', () => {
    render(two, 'p2');
    expect(ticked()).toEqual(['p2']);
  });

  it('ignores a traveller who is not in the list, so nothing is ticked for a stranger', () => {
    render(two, 'someone-else');
    expect(ticked()).toEqual([]);
  });

  it('still ticks the only traveller when none was named', () => {
    render();
    expect(ticked()).toEqual(['p1']);
  });

  it('gives a way forward when the country is not known, instead of only a refusal', async () => {
    actions.startTripAction.mockResolvedValue({
      ok: false,
      message: 'Choose where you are going.',
      field: 'destination',
    });
    render(two, 'p2');
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    const link = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === 'Start a Case by Name',
    );
    expect(link?.getAttribute('href')).toBe('/app/applicant/p2/missions?manual=1#start-case');
  });

  it('offers no by-name link while several travellers are listed and nobody is ticked', async () => {
    actions.startTripAction.mockResolvedValue({
      ok: false,
      message: 'Choose where you are going.',
      field: 'destination',
    });
    render(two);
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(container.textContent).not.toContain('Start a Case by Name');
  });

  it('shows no such link for a refusal about something else', async () => {
    actions.startTripAction.mockResolvedValue({
      ok: false,
      message: 'Choose who is travelling.',
      field: 'traveller',
    });
    render(two);
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(container.textContent).not.toContain('Start a Case by Name');
  });
});

describe('Start a Trip: why are you going? (P15)', () => {
  const tiles = () => [
    ...container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="purpose"]'),
  ];
  const more = () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'More Purposes',
    );
  const list = () => container.querySelector<HTMLSelectElement>('select[name="purpose"]');
  const submit = async () => {
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
  };
  /** What the form sent to the server action on its last try. */
  const sent = () => {
    const call = actions.startTripAction.mock.calls.at(-1);
    return (call?.[1] as FormData).getAll('purpose');
  };
  const pickFromList = (value: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      set?.call(list(), value);
      list()?.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('opens on a radio group of eight picture tiles with a visible legend, plus More Purposes', () => {
    render();
    const group = container.querySelector('fieldset.purpose-choice');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(group?.querySelector('legend')?.textContent).toBe('Why?');
    expect(tiles().map((t) => t.value)).toEqual([...COMMON_PURPOSE_KEYS]);
    expect(COMMON_PURPOSE_KEYS).toHaveLength(8);
    // Each tile is its picture plus the purpose's own word, and the picture is hidden from readers.
    const options = casePurposeGroups().flatMap((g) => g.options);
    for (const radio of tiles()) {
      const tile = radio.closest('label') as HTMLElement;
      expect(tile.textContent).toBe(options.find((o) => o.key === radio.value)?.label);
      const picture = tile.querySelector('.mark-tile');
      expect(picture?.getAttribute('aria-hidden')).toBe('true');
      expect(picture?.getAttribute('data-mark')).toBeTruthy();
    }
    expect(more()).toBeDefined();
    expect(list()).toBeNull();
  });

  it('keeps the eight in one native radio group, so the arrow keys move within it', () => {
    render();
    expect(new Set(tiles().map((t) => t.name))).toEqual(new Set(['purpose']));
    expect(tiles().every((t) => t.closest('fieldset') === tiles()[0]?.closest('fieldset'))).toBe(
      true,
    );
    // Nothing takes a radio out of the keyboard path.
    expect(tiles().some((t) => t.tabIndex < 0 || t.disabled)).toBe(false);
  });

  it('submits the same field and value for a tile as the list did', async () => {
    actions.startTripAction.mockResolvedValue({ ok: true, message: '' });
    render();
    act(() => tiles()[1]?.click());
    expect(tiles()[1]?.checked).toBe(true);
    await submit();
    expect(sent()).toEqual(['family_or_friends_visit']);
  });

  it('opens the whole grouped list from More Purposes, and its choice is the one sent', async () => {
    actions.startTripAction.mockResolvedValue({ ok: true, message: '' });
    render();
    act(() => tiles()[0]?.click());
    act(() => more()?.click());
    expect(tiles()).toHaveLength(0);
    expect(list()?.querySelectorAll('optgroup')).toHaveLength(casePurposeGroups().length);
    expect(document.activeElement).toBe(list());
    pickFromList('doctorate_or_research_degree');
    await submit();
    // One purpose field only, and it is the list's choice, not the earlier tile.
    expect(sent()).toEqual(['doctorate_or_research_degree']);
  });

  it('sends the same value whether a purpose is picked from a tile or from the list', async () => {
    actions.startTripAction.mockResolvedValue({ ok: true, message: '' });
    render();
    act(() => more()?.click());
    pickFromList('tourism');
    await submit();
    const fromList = sent();
    act(() => root.unmount());
    root = createRoot(container);
    render();
    act(() => tiles()[0]?.click());
    await submit();
    expect(sent()).toEqual(fromList);
    expect(fromList).toEqual(['tourism']);
  });

  it('keeps the list open for a purpose with no tile, and goes back to the tiles for one that has', () => {
    render();
    act(() => more()?.click());
    pickFromList('doctorate_or_research_degree');
    const back = () =>
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'Show Common Purposes',
      );
    expect(back()).toBeUndefined();
    pickFromList('tourism');
    act(() => back()?.click());
    expect(tiles()).toHaveLength(8);
    expect(tiles()[0]?.checked).toBe(true);
    expect(document.activeElement).toBe(tiles()[0]);
  });

  it('attaches the refusal to the group, and puts keyboard focus in it', async () => {
    actions.startTripAction.mockResolvedValue({
      ok: false,
      message: 'Choose why you are travelling.',
      field: 'purpose',
    });
    render();
    await submit();
    const group = container.querySelector('fieldset.purpose-choice') as HTMLElement;
    expect(group.getAttribute('aria-invalid')).toBe('true');
    const message = group.getAttribute('aria-describedby') ?? '';
    expect(container.querySelector(`[id="${message}"]`)?.textContent).toContain(
      'Choose why you are travelling.',
    );
    expect(document.activeElement).toBe(tiles()[0]);
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('passes the accessibility scan on both views', async () => {
    render();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
    act(() => more()?.click());
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
