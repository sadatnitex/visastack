// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ unassign: vi.fn() }));
vi.mock('./actions', () => {
  const idle = vi.fn(async () => ({ ok: true, message: '' }));
  return {
    addNoteAction: idle,
    assignMemberAction: idle,
    createAppointmentForOrgAction: idle,
    createTaskForOrgAction: idle,
    decideAppointmentForOrgAction: idle,
    decideTaskForOrgAction: idle,
    recordDecisionAction: idle,
    recordIssuerVerificationAction: idle,
    unassignMemberAction: actions.unassign,
    updateTaskForOrgAction: idle,
  };
});

const { MissionCollaboration } = await import('./mission-collaboration');

describe('case workspace: removing a member', () => {
  it('names each Remove button for its member and marks only the row that is sending', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Never answers, so the first row stays busy.
    actions.unassign.mockImplementation(() => new Promise(() => undefined));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MissionCollaboration
          organizationId="o1"
          missionId="m1"
          applicantId="a1"
          title="UK visit"
          applicantName="Rahim Uddin"
          viewerAssigned
          members={[]}
          assignments={[
            { id: 'as1', memberAccountId: 'u1', memberEmail: 'first@example.com' },
            { id: 'as2', memberAccountId: 'u2', memberEmail: 'second@example.com' },
          ]}
          notes={[]}
          tasks={[]}
          appointments={[]}
          requirements={[]}
          decisions={[]}
          issuerVerifications={[]}
        />,
      );
    });
    const buttons = () =>
      [...host.querySelectorAll('button')].filter((b) => b.textContent?.startsWith('Remov'));
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove first@example.com',
      'Remove second@example.com',
    ]);
    expect(buttons().map((b) => b.textContent)).toEqual(['Remove', 'Remove']);

    await act(async () => {
      buttons()[0]?.closest('form')?.requestSubmit();
    });
    expect(buttons().map((b) => b.textContent)).toEqual(['Removing…', 'Remove']);
    // The busy row's name is dropped while its wording changes; the other keeps its own.
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      null,
      'Remove second@example.com',
    ]);
  });
});

describe('case workspace: where the case is going (P16)', () => {
  const render = async (destinationLabel?: React.ReactNode) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MissionCollaboration
          organizationId="o1"
          missionId="m1"
          applicantId="a1"
          title="UK visit"
          applicantName="Rahim Uddin"
          {...(destinationLabel ? { destinationLabel } : {})}
          viewerAssigned
          members={[]}
          assignments={[]}
          notes={[]}
          tasks={[]}
          appointments={[]}
          requirements={[]}
          decisions={[]}
          issuerVerifications={[]}
        />,
      );
    });
    return host;
  };

  it('draws the slot the page fills under the title row and leaves the title as it was', async () => {
    const host = await render(<span data-testid="where">United Kingdom</span>);
    expect(host.querySelector('.case-work-title')?.textContent).toBe('UK visit');
    const line = host.querySelector('[data-testid="where"]')?.parentElement;
    expect(line?.tagName).toBe('P');
    expect(line?.textContent).toBe('United Kingdom');
    // It sits after the title row, never inside it, so the heading line keeps its shape.
    expect(host.querySelector('.case-work-title')?.parentElement?.contains(line ?? null)).toBe(
      false,
    );
  });

  it('draws no line, and no empty paragraph, when the case has no destination', async () => {
    const host = await render();
    expect(host.querySelector('.case-work-title')?.textContent).toBe('UK visit');
    expect(host.querySelector('p.muted.u-fs-085:empty')).toBeNull();
    expect(host.textContent).not.toContain('United Kingdom');
  });
});
