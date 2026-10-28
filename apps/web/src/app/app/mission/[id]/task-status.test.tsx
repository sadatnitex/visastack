// @vitest-environment jsdom
// Owner's list item 9: a task area has one status line. "Task added." never lingers beside
// "Task started."; the latest action's line replaces the one before, on the case page and in an
// agency's case workspace alike.
import type { ReactNode } from 'react';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Answer = { ok: boolean; message: string };
const queue = vi.hoisted(() => [] as Answer[]);
const standIn = vi.hoisted(
  () => () =>
    new Proxy(
      {},
      {
        has: () => true,
        get: (_target, key) =>
          key === 'then' ? undefined : async () => queue.shift() ?? { ok: true, message: '' },
      },
    ),
);
vi.mock('./actions', standIn);
vi.mock('../../agency/[orgId]/actions', standIn);
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { TasksPanel, AppointmentsPanel } = await import('./collaboration-panels');
const { MissionCollaboration } = await import('../../agency/[orgId]/mission-collaboration');

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
  queue.length = 0;
});

/** Every line the area is saying right now, polite or urgent. */
const lines = (scope: Element = container) =>
  [...scope.querySelectorAll('output, [role="alert"]')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean);

async function press(button: HTMLButtonElement | null | undefined) {
  if (!button) throw new Error('button not found');
  await act(async () => {
    button.form?.requestSubmit(button);
  });
}
const buttonNamed = (scope: Element, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === text,
  );
function typeTask(scope: Element) {
  const input = scope.querySelector<HTMLInputElement>('input[name="description"]');
  if (input) input.value = 'Book the biometrics visit';
}

const OPEN_TASK = {
  id: 't1',
  description: 'Check passport validity',
  status: 'OPEN' as const,
  priority: 'NORMAL' as const,
  dueDate: null,
  dueTimezone: null,
};

describe('the case page task list', () => {
  it('replaces "Task added." with "Task started." instead of showing both', async () => {
    act(() => root.render(<TasksPanel missionId="m1" tasks={[OPEN_TASK]} />));
    queue.push({ ok: true, message: 'Task added.' });
    typeTask(container);
    await press(buttonNamed(container, 'Add'));
    expect(lines()).toEqual(['Task added.']);

    queue.push({ ok: true, message: 'Task started.' });
    await press(buttonNamed(container, 'Start'));
    expect(lines()).toEqual(['Task started.']);

    queue.push({ ok: false, message: 'This task is already finished.' });
    await press(buttonNamed(container, 'Done'));
    expect(lines()).toEqual(['This task is already finished.']);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'This task is already finished.',
    );
  });

  it('keeps one line for appointments too', async () => {
    act(() =>
      root.render(
        <AppointmentsPanel
          missionId="m1"
          appointments={[
            {
              id: 'ap1',
              title: 'Biometrics',
              localDateTime: '2026-05-02T10:30',
              timezone: 'Asia/Dhaka',
              place: null,
              channel: null,
              status: 'OPEN',
            },
          ]}
        />,
      ),
    );
    const create = container.querySelector<HTMLFormElement>('form:has(input[name="title"])');
    for (const [name, value] of [
      ['title', 'Interview'],
      ['localDate', '2026-06-01'],
      ['localTime', '09:00'],
    ] as const) {
      const input = create?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (input) input.value = value;
    }
    queue.push({ ok: true, message: 'Appointment scheduled.' });
    await act(async () => {
      create?.requestSubmit();
    });
    expect(lines()).toEqual(['Appointment scheduled.']);
    queue.push({ ok: true, message: 'Appointment completed.' });
    await press(buttonNamed(container, 'Done'));
    expect(lines()).toEqual(['Appointment completed.']);
  });
});

describe("an agency's case workspace", () => {
  it('shows one line in the task area, the latest', async () => {
    act(() =>
      root.render(
        <MissionCollaboration
          organizationId="o1"
          missionId="m1"
          applicantId="a1"
          title="UK visit"
          applicantName="Synthetic Traveller"
          viewerAssigned
          members={[{ accountId: 'u1', email: 'staff@example.test' }]}
          assignments={[]}
          notes={[]}
          tasks={[{ ...OPEN_TASK, assigneeAccountId: 'u1', dueDate: null }]}
          appointments={[]}
          requirements={[]}
          decisions={[]}
          issuerVerifications={[]}
        />,
      ),
    );
    const taskArea = container
      .querySelector('input[name="description"][placeholder="Add a task…"]')
      ?.closest('div');
    if (!taskArea) throw new Error('task area not found');
    queue.push({ ok: true, message: 'Task added.' });
    typeTask(taskArea);
    await press(buttonNamed(taskArea, 'Add'));
    expect(lines(taskArea)).toEqual(['Task added.']);

    queue.push({ ok: true, message: 'Task reassigned.' });
    await press(buttonNamed(taskArea, 'Reassign'));
    expect(lines(taskArea)).toEqual(['Task reassigned.']);

    queue.push({ ok: true, message: 'Task in progress.' });
    await press(buttonNamed(taskArea, 'Start'));
    expect(lines(taskArea)).toEqual(['Task in progress.']);
  });
});
