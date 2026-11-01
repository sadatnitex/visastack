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

function mount(canCancel = true) {
  act(() =>
    root.render(<CaseMoreMenu missionId="case-1" applicantId="person-1" canCancel={canCancel} />),
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
});
