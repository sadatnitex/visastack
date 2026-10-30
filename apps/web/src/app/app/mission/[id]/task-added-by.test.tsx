import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { textOf } from '../../../../lib/next-mocks.test-support';

vi.mock('./actions', () => ({
  createTaskAction: vi.fn(),
  decideTaskAction: vi.fn(),
  createAppointmentAction: vi.fn(),
  decideAppointmentAction: vi.fn(),
}));
const { TasksPanel } = await import('./collaboration-panels');

const task = {
  id: 't-1',
  description: 'Book the biometrics appointment',
  status: 'OPEN' as const,
  priority: 'NORMAL' as const,
  dueDate: '2026-11-20T00:00:00.000Z',
  dueTimezone: 'Asia/Dhaka',
};

describe('a reminder an AI app added, on the case page (S21)', () => {
  it('says which app added it', () => {
    const html = renderToStaticMarkup(
      <TasksPanel missionId="m-1" tasks={[{ ...task, addedBy: 'Claude (claude.ai)' }]} />,
    );
    expect(textOf(html)).toContain('Added by Claude (claude.ai)');
  });

  it('shows a task added by hand exactly as before', () => {
    const before = renderToStaticMarkup(<TasksPanel missionId="m-1" tasks={[task]} />);
    expect(
      renderToStaticMarkup(<TasksPanel missionId="m-1" tasks={[{ ...task, addedBy: null }]} />),
    ).toBe(before);
    expect(textOf(before)).not.toContain('Added by');
  });
});
