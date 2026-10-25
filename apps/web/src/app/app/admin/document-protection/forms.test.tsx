// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  setDocumentProtectionAction: vi.fn(async () => ({ ok: true, message: '' })),
}));
const { ProtectionSwitch } = await import('./forms');

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

const buttons = () => [...container.querySelectorAll('button')];
const button = (text: string) => {
  const found = buttons().find((b) => b.textContent === text);
  if (!found) throw new Error(`No button ${text}`);
  return found;
};

describe('the document protection switch', () => {
  it('gives every reason field its own name when several switches share a page', () => {
    act(() =>
      root.render(
        <>
          <ProtectionSwitch
            scope="CATEGORY"
            switchKey="medical"
            name="Medical"
            restricted
            defaultRestricted
            overridden={false}
          />
          <ProtectionSwitch
            scope="CATEGORY"
            switchKey="financial"
            name="Financial"
            restricted
            defaultRestricted
            overridden={false}
          />
        </>,
      ),
    );
    const names = [...container.querySelectorAll('label')].map((l) => l.textContent);
    expect(names).toEqual(['Reason (optional) for Medical', 'Reason (optional) for Financial']);
    const ids = [...container.querySelectorAll('input[name="reason"]')].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('asks for confirmation, with the warning, before turning protection off', () => {
    act(() =>
      root.render(
        <ProtectionSwitch
          scope="UNKNOWN_TYPE"
          switchKey="unknown"
          name="Documents Not Sorted Yet"
          restricted
          defaultRestricted
          overridden={false}
          offWarning="They could be passports."
        />,
      ),
    );
    const turnOff = button('Turn Off');
    // Opening the confirmation does not submit anything.
    expect(turnOff.getAttribute('type')).toBe('button');
    expect(turnOff.getAttribute('aria-label')).toBe('Turn Off for Documents Not Sorted Yet');
    expect(container.textContent).not.toContain('Yes, Turn Off');
    act(() => turnOff.click());

    const confirm = button('Yes, Turn Off');
    expect(confirm.getAttribute('type')).toBe('submit');
    expect(confirm.getAttribute('name')).toBe('choice');
    expect(confirm.getAttribute('value')).toBe('off');
    // Focus lands on the reason, which is now required, and which reads the warning.
    const reason = container.querySelector<HTMLInputElement>('input[name="reason"]');
    expect(document.activeElement).toBe(reason);
    expect(reason?.required).toBe(true);
    expect(container.querySelector(`label[for="${reason?.id}"]`)?.textContent).toBe(
      'Reason for Documents Not Sorted Yet',
    );
    const described = (reason?.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((x) => document.getElementById(x)?.textContent)).toEqual([
      expect.stringContaining('Turn off the sign-in check'),
      'Say why, without names or document details.',
    ]);
    const warning = document.getElementById(confirm.getAttribute('aria-describedby') ?? '');
    expect(warning?.textContent).toContain(
      'Turn off the sign-in check for Documents Not Sorted Yet?',
    );
    expect(warning?.textContent).toContain('They could be passports.');
    expect(container.querySelector<HTMLInputElement>('input[name="confirmed"]')?.value).toBe('yes');

    act(() => button('Cancel').click());
    expect(container.textContent).not.toContain('Yes, Turn Off');
    expect(container.querySelector('input[name="confirmed"]')).toBeNull();
    // Focus goes back to the button that opened the confirmation.
    expect(document.activeElement).toBe(button('Turn Off'));
    // Back to optional once nothing is being removed.
    expect(container.querySelector<HTMLInputElement>('input[name="reason"]')?.required).toBe(false);
  });

  it('turns protection on straight away and offers the standard setting when changed', () => {
    act(() =>
      root.render(
        <ProtectionSwitch
          scope="CATEGORY"
          switchKey="medical"
          name="Medical"
          restricted={false}
          defaultRestricted
          overridden
        />,
      ),
    );
    const on = button('Turn On');
    expect(on.getAttribute('type')).toBe('submit');
    expect(on.getAttribute('value')).toBe('on');
    // Going back to a standard setting that is on adds protection: no confirmation.
    const standard = button('Use Standard Setting');
    expect(standard.getAttribute('type')).toBe('submit');
    expect(standard.getAttribute('value')).toBe('default');
    // Visible "Reason (optional)", with the switch name for screen readers.
    const label = container.querySelector('label');
    expect(label?.textContent).toBe('Reason (optional) for Medical');
    expect(label?.querySelector('.sr-only')?.textContent).toBe(' for Medical');
    const reason = container.querySelector<HTMLInputElement>('input[name="reason"]');
    expect(reason?.required).toBe(false);
    expect(reason?.getAttribute('placeholder')).toBeNull();
    expect(container.textContent).toContain('Say why, without names or document details.');
  });

  it('confirms before going back to a standard setting that removes protection', () => {
    act(() =>
      root.render(
        <ProtectionSwitch
          scope="DOCUMENT_TYPE"
          switchKey="SALARY_SLIP"
          name="Salary Slip"
          restricted
          defaultRestricted={false}
          overridden
        />,
      ),
    );
    const standard = button('Use Standard Setting');
    expect(standard.getAttribute('type')).toBe('button');
    act(() => standard.click());
    expect(button('Yes, Turn Off').getAttribute('value')).toBe('default');
    expect(container.querySelector<HTMLInputElement>('input[name="reason"]')?.required).toBe(true);
    act(() => button('Cancel').click());
    expect(document.activeElement).toBe(button('Use Standard Setting'));
  });
});
