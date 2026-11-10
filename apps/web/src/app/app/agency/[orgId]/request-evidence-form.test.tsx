// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fixtureMissing, fixturePicker } from '../../../../lib/master-profile-fixture';
import type { RequestPicker } from '../../../../lib/request-picker-types';

const sendAction = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ requestEvidenceAction: sendAction }));

const { RequestEvidenceForm } = await import('./request-evidence-form');

const html = renderToStaticMarkup(
  <RequestEvidenceForm
    organizationId="org-1"
    picker={fixturePicker}
    applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
  />,
);
const visibleText = html.replace(/<[^>]*>/g, '|');

const byLabel = (host: HTMLElement, text: string | RegExp): HTMLInputElement => {
  const label = [...host.querySelectorAll('label')].find((l) =>
    typeof text === 'string' ? l.textContent === text : text.test(l.textContent ?? ''),
  );
  const control = label?.htmlFor ? host.ownerDocument.getElementById(label.htmlFor) : null;
  if (!control) throw new Error(`No control labelled ${String(text)}`);
  return control as HTMLInputElement;
};

describe('RequestEvidenceForm wording', () => {
  it('shows plain words, folded groups, and no stored codes as visible text', () => {
    expect(visibleText).toContain('Search Documents and Details');
    expect(visibleText).toContain('Documents');
    expect(visibleText).toContain('Details');
    expect(visibleText).toContain('Identity and Contact');
    expect(visibleText).toContain('Selected (0)');
    expect(visibleText).not.toMatch(/passport_number|bank_statement|BANK_STATEMENT|Field key/);
    // Folded: no row is drawn until its group is opened.
    expect(html).not.toContain('type="checkbox"');
  });

  it('no longer asks what kind of thing it is, or offers a typed-in document', () => {
    expect(visibleText).not.toContain('What do you need?');
    expect(visibleText).not.toContain('Something Else (Type Its Name)');
    expect(html).not.toContain('name="key"');
  });
});

const mountWith = async (props: Record<string, unknown> = {}) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <RequestEvidenceForm
        organizationId="org-1"
        picker={fixturePicker}
        applicants={[
          { applicantId: 'a-1', displayName: 'Test Applicant' },
          { applicantId: 'a-2', displayName: 'Other Person' },
        ]}
        missions={[{ missionId: 'm-1', title: 'Japan Visit', applicantName: 'Test Applicant' }]}
        {...props}
      />,
    );
  });
  return { host, root };
};

const typeInto = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
};
const click = async (element: Element | null | undefined) => {
  if (!element) throw new Error('nothing to click');
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const search = (host: HTMLElement) => byLabel(host, 'Search Documents and Details');
const groupButton = (host: HTMLElement, name: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((b) =>
    b.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`No group ${name}`);
  return found;
};
const row = (host: HTMLElement, name: string): HTMLInputElement | null => {
  const label = [...host.querySelectorAll('label.ask-row')].find((l) =>
    l.textContent?.startsWith(name),
  );
  return (label?.querySelector('input[type="checkbox"]') as HTMLInputElement | null) ?? null;
};
const tray = (host: HTMLElement) =>
  [...host.querySelectorAll('.ask-tray-item .ask-tray-name')].map((n) => n.textContent);
const trayTitle = (host: HTMLElement) => host.querySelector('.ask-tray-title')?.textContent;
const sendButton = (host: HTMLElement) =>
  host.querySelector('button[type="submit"]') as HTMLButtonElement;
const send = async (host: HTMLElement) => {
  await act(async () => {
    (host.querySelector('form') as HTMLFormElement).requestSubmit();
  });
};
const sentData = (call: number) => sendAction.mock.calls[call]?.[1] as FormData;
const outputs = (host: HTMLElement) =>
  [...host.querySelectorAll('output')].map((o) => o.textContent);

describe('RequestEvidenceForm picker', () => {
  it('opens a group to show its rows, as a native disclosure with its own list', async () => {
    const { host } = await mountWith();
    const toggle = groupButton(host, 'Financial');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(row(host, 'Bank Statement')).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    // Every choice is a native checkbox inside its label: Tab and Space work without any script.
    expect(row(host, 'Bank Statement')?.type).toBe('checkbox');
    await click(toggle);
    expect(row(host, 'Bank Statement')).toBeNull();
  });

  it('finds items by their plain names (NID, solvency, passport size) and by Other', async () => {
    const { host } = await mountWith();
    await typeInto(search(host), 'nid');
    expect(row(host, 'National ID Card')).not.toBeNull();
    expect(row(host, 'Passport')).toBeNull();
    await typeInto(search(host), 'solvency');
    expect(row(host, 'Bank Solvency Certificate')).not.toBeNull();
    // Every word must match, in any order.
    await typeInto(search(host), 'certificate bank');
    expect(row(host, 'Bank Solvency Certificate')).not.toBeNull();
    await typeInto(search(host), 'something else');
    expect(row(host, 'Other Document')).not.toBeNull();
    // Search opens every matching group by itself; clearing it folds them again.
    await typeInto(search(host), '');
    expect(row(host, 'Other Document')).toBeNull();
  });

  it('Enter in the search box searches and never sends the form', async () => {
    sendAction.mockReset();
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await typeInto(search(host), 'passport');
    await click(row(host, 'Passport'));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => {
      search(host).dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('says what to do when nothing matches', async () => {
    const { host } = await mountWith();
    await typeInto(search(host), 'zzzz');
    expect(host.textContent).toContain(
      'Not in the list? Choose Other Document and explain in the message.',
    );
    expect(host.querySelector('label.ask-row')).toBeNull();
    expect(outputs(host)).toContain('No matches.');
  });

  it('tells apart items that share a name by a plain context line', async () => {
    const { host } = await mountWith();
    await click(groupButton(host, 'Identity and Contact'));
    const names = [...host.querySelectorAll('label.ask-row')].map((l) => l.textContent);
    expect(names).toContain('Date of Birth (Traveller)');
    expect(names).toContain('Date of Birth (Dependant)');
    expect(names).toContain('Passport Number (Current Passport)');
    expect(names).toContain('Full Name');
    await click(row(host, 'Date of Birth (Dependant)'));
    expect(tray(host)).toEqual(['Date of Birth (Dependant)Detail']);
    expect(host.querySelector('[data-remove]')?.getAttribute('aria-label')).toBe(
      'Remove Date of Birth (Dependant)',
    );
  });

  it('collects chosen items in a tray with their own Remove, and counts them on the button', async () => {
    const { host } = await mountWith();
    expect(trayTitle(host)).toBe('Selected (0)');
    expect(sendButton(host).textContent).toBe('Request Evidence');
    await typeInto(search(host), 'passport');
    await click(row(host, 'Passport'));
    await typeInto(search(host), 'statement');
    await click(row(host, 'Bank Statement'));
    expect(trayTitle(host)).toBe('Selected (2)');
    expect(tray(host)).toEqual(['PassportDocument', 'Bank StatementDocument']);
    expect(sendButton(host).textContent).toBe('Request Evidence (2)');
    // A ticked row stays ticked when the search changes and comes back.
    await typeInto(search(host), 'passport');
    expect(row(host, 'Passport')?.checked).toBe(true);

    const remove = host.querySelector('[data-remove="DOCUMENT:PASSPORT"]') as HTMLButtonElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove Passport');
    await click(remove);
    expect(trayTitle(host)).toBe('Selected (1)');
    expect(row(host, 'Passport')?.checked).toBe(false);
    // Focus moves on to the next Remove button, never to the top of the page.
    expect(document.activeElement).toBe(
      host.querySelector('[data-remove="DOCUMENT:BANK_STATEMENT"]'),
    );
    await click(host.querySelector('[data-remove]'));
    expect(trayTitle(host)).toBe('Selected (0)');
    expect(document.activeElement).toBe(search(host));
  });

  it('Clear All empties the tray and returns to the search box', async () => {
    const { host } = await mountWith();
    await typeInto(search(host), 'a');
    await click(row(host, 'Passport'));
    await click(row(host, 'Bank Statement'));
    const clear = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Clear All');
    await click(clear);
    expect(trayTitle(host)).toBe('Selected (0)');
    expect(document.activeElement).toBe(search(host));
  });

  it('stops at the most one send may carry and says so', async () => {
    const many: RequestPicker = {
      groups: [
        {
          id: 'DOCUMENT:many',
          label: 'Many',
          kind: 'DOCUMENT',
          items: Array.from({ length: 30 }, (_, i) => [`K_${i}`, `Item ${i}`] as const),
        },
      ],
    };
    const { host } = await mountWith({ picker: many });
    await click(groupButton(host, 'Many'));
    for (let i = 0; i < 26; i += 1) await click(row(host, `Item ${i}`));
    expect(trayTitle(host)).toBe('Selected (25)');
    expect(host.textContent).toContain('25 is the most in one send.');
    expect(row(host, 'Item 25')?.checked).toBe(false);
  });

  it('draws at most 60 rows of a long group and offers Show More', async () => {
    const long: RequestPicker = {
      groups: [
        {
          id: 'FIELD:long',
          label: 'Long',
          kind: 'FIELD',
          items: Array.from({ length: 130 }, (_, i) => [`k_${i}`, `Thing ${i}`] as const),
        },
      ],
    };
    const { host } = await mountWith({ picker: long });
    await click(groupButton(host, 'Long'));
    expect(host.querySelectorAll('label.ask-row')).toHaveLength(60);
    const more = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Show More'),
    );
    expect(more?.textContent).toBe('Show More (70)');
    await click(more);
    expect(host.querySelectorAll('label.ask-row')).toHaveLength(120);
  });
});

describe('RequestEvidenceForm sending', () => {
  const SENT = {
    ok: true,
    message: '2 requests sent. They stay open until the traveller replies.',
  };
  const pick = async (host: HTMLElement) => {
    await typeInto(search(host), 'passport');
    await click(row(host, 'Passport'));
    await typeInto(search(host), 'statement');
    await click(row(host, 'Bank Statement'));
  };

  it('sends one item field per chosen thing, with one shared message and date', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await typeInto(byLabel(host, 'Case'), 'm-1');
    await pick(host);
    await typeInto(byLabel(host, 'Message (Optional)'), 'Clear scan please');
    await typeInto(byLabel(host, 'Due Date (Optional)'), '2030-01-05');
    await send(host);

    const data = sentData(0);
    expect(data.getAll('item')).toEqual(['DOCUMENT:PASSPORT', 'DOCUMENT:BANK_STATEMENT']);
    expect(data.get('organizationId')).toBe('org-1');
    expect(data.get('applicantId')).toBe('a-1');
    expect(data.get('missionId')).toBe('m-1');
    expect(data.get('message')).toBe('Clear scan please');
    expect(data.get('dueDate')).toBe('2030-01-05');
    // The earlier single-item fields are not sent from here.
    expect(data.has('key')).toBe(false);
    expect(data.has('kind')).toBe(false);
  });

  it('after a send keeps the traveller and case, clears the rest, and says what went out', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await typeInto(byLabel(host, 'Case'), 'm-1');
    await pick(host);
    await typeInto(byLabel(host, 'Message (Optional)'), 'Clear scan please');
    await send(host);

    expect(byLabel(host, 'Traveller').value).toBe('a-1');
    expect(byLabel(host, 'Case').value).toBe('m-1');
    expect(trayTitle(host)).toBe('Selected (0)');
    expect(byLabel(host, 'Message (Optional)').value).toBe('');
    expect(search(host).value).toBe('');
    expect(document.activeElement).toBe(search(host));
    expect(outputs(host)).toContain('Sent 2 requests to Test Applicant.');

    // The next send is one search away.
    await typeInto(search(host), 'passport');
    await click(row(host, 'Passport'));
    await send(host);
    expect(sentData(1).getAll('item')).toEqual(['DOCUMENT:PASSPORT']);
    expect(outputs(host)).toContain('Sent 1 request to Test Applicant.');
  });

  it('shows a send only under the traveller and case it went to', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await pick(host);
    await send(host);
    expect(host.textContent).toContain('Sent 2 requests to Test Applicant.');
    await typeInto(byLabel(host, 'Traveller'), 'a-2');
    expect(host.textContent).not.toContain('Sent 2 requests to');
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    expect(host.textContent).toContain('Sent 2 requests to Test Applicant.');
  });

  it('does not carry the case chosen for one traveller over to the next traveller', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await typeInto(byLabel(host, 'Case'), 'm-1');
    await typeInto(byLabel(host, 'Traveller'), 'a-2');
    expect(byLabel(host, 'Case').value).toBe('');
    await pick(host);
    await send(host);
    expect(sentData(0).get('applicantId')).toBe('a-2');
    expect(sentData(0).get('missionId')).toBe('');
  });

  it('files a send that finishes after the traveller changed under the traveller it went to', async () => {
    sendAction.mockReset();
    let finish: (value: typeof SENT) => void = () => undefined;
    sendAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await pick(host);
    await send(host);
    await typeInto(byLabel(host, 'Traveller'), 'a-2');
    await act(async () => finish({ ...SENT }));
    expect(host.textContent).not.toContain('Sent 2 requests to Other Person');
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    expect(host.textContent).toContain('Sent 2 requests to Test Applicant.');
  });

  it('keeps everything chosen when the send is refused', async () => {
    sendAction.mockReset();
    sendAction.mockResolvedValue({ ok: false, message: 'This organization has no current grant.' });
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await pick(host);
    await typeInto(byLabel(host, 'Message (Optional)'), 'Needed soon');
    await send(host);
    expect(trayTitle(host)).toBe('Selected (2)');
    expect(byLabel(host, 'Message (Optional)').value).toBe('Needed soon');
    expect(host.textContent).toContain('This organization has no current grant.');
    expect(host.textContent).not.toContain('Sent 2 requests');
  });

  it('with nothing chosen sends nothing and says where to choose', async () => {
    sendAction.mockReset();
    const { host } = await mountWith();
    await typeInto(byLabel(host, 'Traveller'), 'a-1');
    await send(host);
    expect(sendAction).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Choose at least one item.');
    expect(document.activeElement).toBe(search(host));
    // Choosing something clears the message.
    await typeInto(search(host), 'passport');
    await click(row(host, 'Passport'));
    expect(host.textContent).not.toContain('Choose at least one item.');
  });
});

describe('RequestEvidenceForm on a case', () => {
  const fixed = {
    applicantId: 'a-9',
    applicantName: 'Case Traveller',
    missionId: 'm-9',
    caseTitle: 'Canada Study',
  };
  const mountCase = (missing = fixtureMissing) =>
    mountWith({ applicants: undefined, missions: undefined, fixed, missing });
  const SENT = {
    ok: true,
    message: '2 requests sent. They stay open until the traveller replies.',
  };

  it('shows no traveller or case list and sends the case own two ids', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const { host } = await mountCase();
    expect([...host.querySelectorAll('label')].map((l) => l.textContent)).not.toContain(
      'Traveller',
    );
    expect(host.textContent).toContain('For Case Traveller, Canada Study');
    await send(host);
    const data = sentData(0);
    expect(data.get('applicantId')).toBe('a-9');
    expect(data.get('missionId')).toBe('m-9');
    expect(outputs(host)).toContain('Sent 2 requests to Case Traveller.');
  });

  it('lists what is missing first, with the required items ticked and each removable', async () => {
    const { host } = await mountCase();
    const section = host.querySelector('[aria-label="Missing for This Case"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('Missing for This Case');
    // The two required gaps start ticked.
    expect(trayTitle(host)).toBe('Selected (2)');
    expect(row(section as HTMLElement, 'Passport')?.checked).toBe(true);
    expect(row(section as HTMLElement, 'Bank Statement')?.checked).toBe(true);
    // A request already waiting shows as such and starts unticked.
    expect(row(section as HTMLElement, 'Full Name')?.checked).toBe(false);
    expect(section?.textContent).toContain('Already Asked');
    // A checklist name the list does not have is shown as text and cannot be sent.
    expect(section?.textContent).toContain('Village Elder Letter');
    expect(section?.textContent).toContain('Not in the List');
    expect(row(section as HTMLElement, 'Village Elder Letter')).toBeNull();
    // Alternatives: nothing ticked, with the plain reason.
    expect(section?.textContent).toContain('Any One of These');
    expect(section?.textContent).toContain('The traveller needs only one of these.');
    expect(row(section as HTMLElement, 'National ID Card')?.checked).toBe(false);

    await click(host.querySelector('[data-remove="DOCUMENT:PASSPORT"]'));
    expect(trayTitle(host)).toBe('Selected (1)');
    const askAll = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Ask for All Missing'),
    );
    expect(askAll?.textContent).toBe('Ask for All Missing (2)');
    await click(askAll);
    expect(trayTitle(host)).toBe('Selected (2)');
    expect(row(section as HTMLElement, 'Passport')?.checked).toBe(true);
  });

  it('ticks no more than one send can carry and says how many were left out', async () => {
    const many = {
      rows: Array.from({ length: 31 }, (_, i) => ({
        id: `DOCUMENT:K_${i}`,
        label: `Gap ${i}`,
        hint: '',
        state: 'ask' as const,
      })),
      anyOf: [],
    };
    const { host } = await mountCase(many);
    expect(trayTitle(host)).toBe('Selected (25)');
    expect(host.textContent).toContain('Ask for All Missing (31)');
    expect(host.textContent).toContain(
      'Only the first 25 are ticked. Send these, then ask for the rest.',
    );
    await click(host.querySelector('[data-remove="DOCUMENT:K_0"]'));
    const askAll = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Ask for All Missing'),
    );
    await click(askAll);
    expect(trayTitle(host)).toBe('Selected (25)');
    expect(outputs(host).join(' ')).toContain('25 is the most in one send.');
  });

  it('shows no such group when the case has no gaps, and never on Clients', async () => {
    const none = await mountCase(null as never);
    expect(none.host.querySelector('[aria-label="Missing for This Case"]')).toBeNull();
    expect(trayTitle(none.host)).toBe('Selected (0)');
    const clients = await mountWith();
    expect(clients.host.textContent).not.toContain('Missing for This Case');
    expect(clients.host.textContent).not.toContain('Ask for All Missing');
  });

  it('shows nothing sent for another case when the workspace moves to a different case', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const { host, root } = await mountCase();
    await send(host);
    expect(host.textContent).toContain('Sent 2 requests to Case Traveller.');
    await act(async () => {
      root.render(
        <RequestEvidenceForm
          organizationId="org-1"
          picker={fixturePicker}
          fixed={{
            applicantId: 'a-8',
            applicantName: 'Someone Else',
            missionId: 'm-8',
            caseTitle: 'UK Visit',
          }}
        />,
      );
    });
    expect(host.textContent).not.toContain('Sent 2 requests to');
  });
});
