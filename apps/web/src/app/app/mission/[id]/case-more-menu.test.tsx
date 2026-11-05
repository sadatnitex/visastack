// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';

/**
 * Owner list item 3: Cancel Case lives in the More menu, away from the stage buttons, and asks
 * first, on the page, with what cancelling means. Keyboard and screen reader users get the
 * question in focus and can back out with Keep the Case or Escape.
 */

vi.mock('./actions', () => ({
  transitionMissionAction: vi.fn(async () => ({ ok: true, message: '' })),
  snapshotMissionAction: vi.fn(async () => ({ ok: true, message: '' })),
  deleteCancelledCaseAction: vi.fn(async () => ({ ok: true, message: '' })),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>
      {children as never}
    </a>
  ),
}));

const { CaseMoreMenu } = await import('./case-more-menu');

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

function mount(canCancel = true, canDelete = false) {
  act(() =>
    root.render(
      <CaseMoreMenu
        missionId="case-1"
        applicantId="person-1"
        canCancel={canCancel}
        canDelete={canDelete}
      />,
    ),
  );
  const details = container.querySelector('details') as HTMLDetailsElement;
  const open = () =>
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
  return { details, open };
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

describe('CaseMoreMenu', () => {
  it('is a menu named More that holds Cancel Case and the case history, not a stage button', () => {
    const { details, open } = mount();
    expect(details.querySelector('summary')?.textContent).toContain('More');
    open();
    expect(button('Cancel Case')).toBeDefined();
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/app/applicant/person-1/memory',
    );
    expect(container.querySelector('a')?.textContent).toBe('Open Case History');
    // Nothing is sent by opening the menu or choosing Cancel Case.
    expect(container.querySelector('input[name="to"]')).toBeNull();
  });

  it('leaves Cancel Case out when the stage does not allow it', () => {
    const { open } = mount(false);
    open();
    expect(button('Cancel Case')).toBeUndefined();
    expect(container.querySelector('a')).not.toBeNull();
  });

  it('asks on the page what cancelling means, with focus on the question, and sends the confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { open } = mount();
    open();
    act(() => button('Cancel Case')?.click());
    const question = container.querySelector('h2');
    expect(question?.textContent).toBe('Cancel this case?');
    expect(document.activeElement).toBe(question);
    const region = question?.closest('section');
    expect(region?.getAttribute('aria-labelledby')).toBe(question?.id);
    const consequences = document.getElementById(region?.getAttribute('aria-describedby') ?? '');
    expect(consequences?.textContent).toContain('cannot be reopened');
    expect(consequences?.textContent).toContain('Nothing is deleted now');
    const form = container.querySelector('form') as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get('missionId')).toBe('case-1');
    expect(data.get('to')).toBe('CANCELLED');
    expect(data.get('confirmCancel')).toBe('yes');
    expect(button('Yes, Cancel This Case')?.getAttribute('type')).toBe('submit');
    expect(confirm).not.toHaveBeenCalled();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('goes back without changing anything on Keep the Case, with focus on Cancel Case again', () => {
    const { open } = mount();
    open();
    act(() => button('Cancel Case')?.click());
    act(() => button('Keep the Case')?.click());
    expect(container.querySelector('form')).toBeNull();
    expect(document.activeElement).toBe(button('Cancel Case'));
  });

  it('closes on Escape and returns focus to More', () => {
    const { details, open } = mount();
    open();
    act(() => button('Cancel Case')?.click());
    act(() => {
      details.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector('summary'));
    open();
    expect(container.querySelector('form')).toBeNull();
  });

  it('passes the accessibility scan with the menu open', async () => {
    const { open } = mount();
    open();
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('repeats the header actions for phones when the page passes them (WP-SB2)', async () => {
    act(() =>
      root.render(
        <CaseMoreMenu
          missionId="case-1"
          applicantId="person-1"
          canCancel
          headerActions={{
            addEvidenceHref: '#evidence',
            newCaseHref: '/app/applicant/person-1/missions/prepare-again?from=case-1',
          }}
        />,
      ),
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    const phoneItems = [...container.querySelectorAll('li.case-more-phone')];
    expect(phoneItems).toHaveLength(3);
    expect(phoneItems[0]?.querySelector('a')?.getAttribute('href')).toBe('#evidence');
    expect(phoneItems[0]?.textContent).toBe('Add Evidence');
    expect(phoneItems[1]?.querySelector('a')?.getAttribute('href')).toBe(
      '/app/applicant/person-1/missions/prepare-again?from=case-1',
    );
    expect(phoneItems[2]?.querySelector('button')?.textContent).toBe('Snapshot');
    // The usual items follow, and the menu stays free of accessibility problems.
    expect(button('Cancel Case')).toBeDefined();
    expect(await axeViolations(`${container.innerHTML}<div id="evidence"></div>`)).toEqual([]);
    // Choosing Add Evidence closes the menu, so the page section it points at is not covered.
    act(() => (phoneItems[0]?.querySelector('a') as HTMLAnchorElement).click());
    expect(details.open).toBe(false);
  });

  it('shows no phone items when the page passes none', () => {
    const { open } = mount();
    open();
    expect(container.querySelectorAll('.case-more-phone')).toHaveLength(0);
  });

  it('offers Delete Case only for a cancelled case, and never together with Cancel Case', () => {
    const live = mount(true, false);
    live.open();
    expect(button('Delete Case')).toBeUndefined();
    expect(button('Cancel Case')).toBeDefined();
    act(() => root.unmount());
    root = createRoot(container);
    const cancelled = mount(false, true);
    cancelled.open();
    expect(button('Delete Case')).toBeDefined();
    expect(button('Cancel Case')).toBeUndefined();
  });

  it('asks first on the page what deleting means, sends nothing until Yes, and backs out with Keep the Case', () => {
    const { open } = mount(false, true);
    open();
    act(() => button('Delete Case')?.click());
    const question = container.querySelector('.case-cancel-question');
    expect(question?.textContent).toBe('Delete this case?');
    expect(document.activeElement).toBe(question);
    const consequences = container.querySelector('.case-cancel-consequences')?.textContent ?? '';
    expect(consequences).toContain('removed for good');
    expect(consequences).toContain('Your profile and documents are not touched.');
    expect(consequences).toContain('This cannot be undone.');
    // The form carries the answer the server asks for, and the case and person it is about.
    const form = container.querySelector('form.case-cancel-actions') as HTMLFormElement;
    expect(form.querySelector<HTMLInputElement>('input[name="confirmDelete"]')?.value).toBe('yes');
    expect(form.querySelector<HTMLInputElement>('input[name="missionId"]')?.value).toBe('case-1');
    expect(form.querySelector<HTMLInputElement>('input[name="applicantId"]')?.value).toBe(
      'person-1',
    );
    expect(button('Yes, Delete This Case')).toBeDefined();
    act(() => button('Keep the Case')?.click());
    expect(container.querySelector('.case-cancel-question')).toBeNull();
    expect(document.activeElement).toBe(button('Delete Case'));
  });

  it('shows a refusal under the question only for the attempt that failed, never when it is reopened', async () => {
    const actions = await import('./actions');
    vi.mocked(actions.deleteCancelledCaseAction).mockResolvedValue({
      ok: false,
      message: 'This case is under a legal hold, so it cannot be deleted for now.',
    });
    const { open } = mount(false, true);
    open();
    act(() => button('Delete Case')?.click());
    const form = container.querySelector('form.case-cancel-actions') as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });
    expect(container.textContent).toContain('under a legal hold');
    act(() => button('Keep the Case')?.click());
    act(() => button('Delete Case')?.click());
    expect(container.querySelector('.case-cancel-question')?.textContent).toBe('Delete this case?');
    expect(container.textContent).not.toContain('under a legal hold');
  });
});
