// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const allowCaseAction = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ allowCaseAction }));

const { CaseExceptions } = await import('./case-exceptions');

describe('CaseExceptions', () => {
  it('names each case that is not shared and asks inside the page before allowing it', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const confirmSpy = vi.spyOn(window, 'confirm');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CaseExceptions
          applicantId="a-1"
          grantId="g-1"
          recipientLabel="Agency A"
          exceptions={[
            { missionId: 'm-2', title: 'Japan trip 2026' },
            { missionId: 'm-3', title: 'Canada study' },
          ]}
        />,
      );
    });
    const buttons = (text: string) =>
      Array.from(host.querySelectorAll('button')).filter((b) => b.textContent === text);

    expect(host.textContent).toContain('Not Shared: Japan trip 2026');
    expect(host.textContent).toContain('Not Shared: Canada study');
    expect(host.textContent).toContain('Documents and profile details you shared stay shared.');
    expect(buttons('Allow This Case')).toHaveLength(2);
    expect(buttons('Yes, Allow This Case')).toHaveLength(0);

    await act(async () => {
      buttons('Allow This Case')[0]?.click();
    });
    expect(host.textContent).toContain('Agency A will be able to see this case and its records.');
    const yes = buttons('Yes, Allow This Case')[0];
    expect(yes?.getAttribute('type')).toBe('submit');
    expect(
      yes?.closest('form')?.querySelector('input[name="missionId"]')?.getAttribute('value'),
    ).toBe('m-2');
    expect(buttons('Allow This Case')).toHaveLength(1);

    await act(async () => {
      buttons('Keep It Private')[0]?.click();
    });
    expect(buttons('Yes, Allow This Case')).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps focus with the choice and puts each message next to its own case', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    allowCaseAction.mockResolvedValue({
      ok: false,
      message: 'Confirm it is you to allow this case.',
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <CaseExceptions
          applicantId="a-1"
          grantId="g-1"
          recipientLabel="Agency A"
          exceptions={[
            { missionId: 'm-2', title: 'Japan trip 2026' },
            { missionId: 'm-3', title: 'Canada study', sharedSeparately: true },
          ]}
        />,
      );
    });
    const rows = () => Array.from(host.querySelectorAll('li'));
    const button = (row: Element | undefined, text: string) =>
      Array.from(row?.querySelectorAll('button') ?? []).find((b) => b.textContent === text);

    expect(rows()[1]?.textContent).toContain('Shared Separately: Canada study');
    expect(rows()[1]?.textContent).toContain(
      'Agency A sees this case through another access you gave.',
    );
    expect(button(rows()[0], 'Allow This Case')?.getAttribute('aria-label')).toBe(
      'Allow This Case: Japan trip 2026',
    );

    await act(async () => button(rows()[0], 'Allow This Case')?.click());
    expect(document.activeElement).toBe(button(rows()[0], 'Yes, Allow This Case'));
    await act(async () => button(rows()[0], 'Keep It Private')?.click());
    expect(document.activeElement).toBe(button(rows()[0], 'Allow This Case'));

    await act(async () => button(rows()[0], 'Allow This Case')?.click());
    await act(async () => button(rows()[0], 'Yes, Allow This Case')?.click());
    expect(allowCaseAction).toHaveBeenCalledTimes(1);
    expect(rows()[0]?.querySelector('[role="alert"].field-msg')?.textContent).toBe(
      'Confirm it is you to allow this case.',
    );
    expect(rows()[1]?.querySelector('[role="alert"].field-msg')?.textContent).toBe('');
    expect(document.activeElement).toBe(
      rows()[0]?.querySelector('.sharing-case-exception-message'),
    );
    await act(async () => root.unmount());
    host.remove();
  });
});
