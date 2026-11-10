// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fixtureDocumentGroups, fixtureFieldGroups } from '../../../../lib/master-profile-fixture';

const sendAction = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ requestEvidenceAction: sendAction }));

const { RequestEvidenceForm } = await import('./request-evidence-form');

const html = renderToStaticMarkup(
  <RequestEvidenceForm
    organizationId="org-1"
    fieldGroups={fixtureFieldGroups}
    documentGroups={fixtureDocumentGroups}
    applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
  />,
);
const visibleText = html.replace(/<[^>]*>/g, '|');

const byLabel = (host: HTMLElement, text: string | RegExp): HTMLSelectElement => {
  const label = [...host.querySelectorAll('label')].find((l) =>
    typeof text === 'string' ? l.textContent === text : text.test(l.textContent ?? ''),
  );
  const control = label?.htmlFor ? host.ownerDocument.getElementById(label.htmlFor) : null;
  if (!control) throw new Error(`No control labelled ${String(text)}`);
  return control as HTMLSelectElement;
};

describe('RequestEvidenceForm wording', () => {
  it('shows plain words and no stored codes as visible text', () => {
    expect(visibleText).toContain('What do you need?');
    expect(visibleText).toContain('A Detail from the Profile');
    expect(visibleText).toContain('Passport Number');
    expect(visibleText).not.toMatch(/passport_number|bank_statement|Field key/);
  });

  it('still submits the stored code for the chosen detail', () => {
    expect(html).toContain('value="passport_number"');
    expect(html).toContain('name="key"');
  });

  it('offers a detail that only the catalogue added, under its own group', () => {
    expect(visibleText).toContain('Institution Name');
    expect(html).toContain('value="study_institution_name"');
    expect(html).toMatch(/<optgroup label="Study">/);
  });
});

describe('RequestEvidenceForm document choice', () => {
  const mount = async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RequestEvidenceForm
          organizationId="org-1"
          fieldGroups={fixtureFieldGroups}
          documentGroups={fixtureDocumentGroups}
          applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
        />,
      );
    });
    return host;
  };
  const change = async (element: HTMLSelectElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('sends the stored code for a named document and the typed name for another one', async () => {
    const host = await mount();
    await change(byLabel(host, 'What do you need?'), 'DOCUMENT');
    const choice = byLabel(host, /^Which (detail|document)\?$/);
    expect(choice.textContent).toContain('Passport');
    expect(choice.textContent).toContain('Other Document');
    expect(choice.textContent).toContain('Something Else');
    await change(choice, 'BANK_STATEMENT');
    expect((host.querySelector('input[name="key"]') as HTMLInputElement).value).toBe(
      'BANK_STATEMENT',
    );
    await change(choice, '__other__');
    const typed = host.querySelector('input[name="key"]') as HTMLInputElement;
    expect(typed.type).toBe('text');
    expect(typed.required).toBe(true);
  });
});

describe('RequestEvidenceForm sending', () => {
  const SENT = { ok: true, message: 'Request sent. It stays open until the traveller replies.' };
  const mount = async (extra: Record<string, unknown> = {}) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RequestEvidenceForm
          organizationId="org-1"
          fieldGroups={fixtureFieldGroups}
          documentGroups={fixtureDocumentGroups}
          applicants={[
            { applicantId: 'a-1', displayName: 'Test Applicant' },
            { applicantId: 'a-2', displayName: 'Other Person' },
          ]}
          missions={[{ missionId: 'm-1', title: 'Japan Visit', applicantName: 'Test Applicant' }]}
          {...extra}
        />,
      );
    });
    return host;
  };
  const choose = async (element: HTMLSelectElement | HTMLInputElement, value: string) => {
    await act(async () => {
      const proto = element instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
      );
    });
  };
  const send = async (host: HTMLElement) => {
    await act(async () => {
      (host.querySelector('form') as HTMLFormElement).requestSubmit();
    });
  };
  const sentFields = (call: number) => {
    const data = sendAction.mock.calls[call]?.[1] as FormData;
    return Object.fromEntries(data.entries());
  };

  it('keeps the traveller and the case after a send, clears only the item, message and date', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const host = await mount();
    await choose(byLabel(host, 'Traveller'), 'a-1');
    await choose(byLabel(host, 'Case'), 'm-1');
    await choose(byLabel(host, 'What do you need?'), 'DOCUMENT');
    await choose(byLabel(host, 'Which document?'), 'PASSPORT');
    await choose(byLabel(host, 'Message (Optional)'), 'Clear scan please');
    await choose(byLabel(host, 'Due Date (Optional)'), '2030-01-05');
    await send(host);

    expect(sentFields(0)).toEqual({
      organizationId: 'org-1',
      applicantId: 'a-1',
      missionId: 'm-1',
      kind: 'DOCUMENT',
      key: 'PASSPORT',
      message: 'Clear scan please',
      dueDate: '2030-01-05',
    });
    expect(byLabel(host, 'Traveller').value).toBe('a-1');
    expect(byLabel(host, 'Case').value).toBe('m-1');
    expect(byLabel(host, 'What do you need?').value).toBe('DOCUMENT');
    expect(byLabel(host, 'Which document?').value).toBe('');
    expect(byLabel(host, 'Message (Optional)').value).toBe('');
    expect(byLabel(host, 'Due Date (Optional)').value).toBe('');
    // The item list takes focus, so the next one is one choice away.
    expect(document.activeElement).toBe(byLabel(host, 'Which document?'));
    // Polite, plain sent feedback: the server's line and what has gone out so far.
    const lines = [...host.querySelectorAll('output')].map((o) => o.textContent);
    expect(lines).toContain(SENT.message);
    expect(lines).toContain('Sent to Test Applicant: Passport.');

    await choose(byLabel(host, 'Which document?'), 'BANK_STATEMENT');
    await send(host);
    expect(sentFields(1)).toMatchObject({
      applicantId: 'a-1',
      missionId: 'm-1',
      key: 'BANK_STATEMENT',
    });
    expect([...host.querySelectorAll('output')].map((o) => o.textContent)).toContain(
      'Sent to Test Applicant: Passport, Bank Statement.',
    );
  });

  it('lists a request only under the traveller and case it went to', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const host = await mount();
    await choose(byLabel(host, 'Traveller'), 'a-1');
    await choose(byLabel(host, 'Which detail?'), 'full_name');
    await send(host);
    expect(host.textContent).toContain('Sent to Test Applicant: Full Name.');
    await choose(byLabel(host, 'Traveller'), 'a-2');
    expect(host.textContent).not.toContain('Sent to');
    await choose(byLabel(host, 'Traveller'), 'a-1');
    expect(host.textContent).toContain('Sent to Test Applicant: Full Name.');
  });

  it('does not carry the case chosen for one traveller over to the next traveller', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const host = await mount();
    await choose(byLabel(host, 'Traveller'), 'a-1');
    await choose(byLabel(host, 'Case'), 'm-1');
    await choose(byLabel(host, 'Traveller'), 'a-2');
    expect(byLabel(host, 'Case').value).toBe('');
    await choose(byLabel(host, 'Which detail?'), 'full_name');
    await send(host);
    expect(sentFields(0)).toMatchObject({ applicantId: 'a-2', missionId: '' });
  });

  it('files a request that finishes after the traveller changed under the traveller it went to', async () => {
    sendAction.mockReset();
    let finish: (value: typeof SENT) => void = () => undefined;
    sendAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const host = await mount();
    await choose(byLabel(host, 'Traveller'), 'a-1');
    await choose(byLabel(host, 'Which detail?'), 'full_name');
    await send(host);
    await choose(byLabel(host, 'Traveller'), 'a-2');
    await act(async () => finish({ ...SENT }));
    expect(host.textContent).not.toContain('Sent to Other Person');
    await choose(byLabel(host, 'Traveller'), 'a-1');
    expect(host.textContent).toContain('Sent to Test Applicant: Full Name.');
  });

  it('keeps everything that was typed when the request is refused', async () => {
    sendAction.mockReset();
    sendAction.mockResolvedValue({ ok: false, message: 'This organization has no current grant.' });
    const host = await mount();
    await choose(byLabel(host, 'Traveller'), 'a-1');
    await choose(byLabel(host, 'Which detail?'), 'full_name');
    await choose(byLabel(host, 'Message (Optional)'), 'Needed soon');
    await send(host);
    expect(byLabel(host, 'Which detail?').value).toBe('full_name');
    expect(byLabel(host, 'Message (Optional)').value).toBe('Needed soon');
    expect(host.textContent).toContain('This organization has no current grant.');
    expect(host.textContent).not.toContain('Sent to');
  });

  it('on a case workspace shows no traveller or case list and sends the case own two ids', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const host = await mount({
      applicants: [],
      missions: [],
      fixed: {
        applicantId: 'a-9',
        applicantName: 'Case Traveller',
        missionId: 'm-9',
        caseTitle: 'Canada Study',
      },
    });
    expect([...host.querySelectorAll('label')].map((l) => l.textContent)).not.toContain(
      'Traveller',
    );
    expect(host.textContent).toContain('For Case Traveller, Canada Study');
    await choose(byLabel(host, 'Which detail?'), 'passport_number');
    await send(host);
    expect(sentFields(0)).toEqual({
      organizationId: 'org-1',
      applicantId: 'a-9',
      missionId: 'm-9',
      kind: 'FIELD',
      key: 'passport_number',
      message: '',
      dueDate: '',
    });
    expect(host.textContent).toContain('Sent to Case Traveller: Passport Number.');
  });

  it('shows nothing sent for another case when the case workspace moves to a different case', async () => {
    sendAction.mockReset();
    sendAction.mockImplementation(async () => ({ ...SENT }));
    const first = {
      applicantId: 'a-9',
      applicantName: 'Case Traveller',
      missionId: 'm-9',
      caseTitle: 'Canada Study',
    };
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = (fixed: typeof first) =>
      act(async () => {
        root.render(
          <RequestEvidenceForm
            organizationId="org-1"
            fieldGroups={fixtureFieldGroups}
            documentGroups={fixtureDocumentGroups}
            fixed={fixed}
          />,
        );
      });
    await render(first);
    await choose(byLabel(host, 'Which detail?'), 'full_name');
    await send(host);
    expect(host.textContent).toContain('Sent to Case Traveller: Full Name.');
    await render({
      applicantId: 'a-8',
      applicantName: 'Someone Else',
      missionId: 'm-8',
      caseTitle: 'UK Visit',
    });
    expect(host.textContent).not.toContain('Sent to');
    await choose(byLabel(host, 'Which detail?'), 'passport_number');
    await send(host);
    expect(sentFields(1)).toMatchObject({ applicantId: 'a-8', missionId: 'm-8' });
  });
});
