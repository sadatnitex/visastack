import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ travellerLifecycleAction: async () => undefined }));
vi.mock('@visastack/services', () => ({ TRAVELLER_REFUSALS: {} }));
const { TravellerLifecycleBar } = await import('./lifecycle-bar');

const ID = '10000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-01T10:00:00Z');
const view = (state: 'CURRENT' | 'ARCHIVED' | 'RECENTLY_DELETED', actions: string[]) =>
  ({
    lifecycle: {
      state,
      archivedAt: state === 'ARCHIVED' ? new Date('2026-10-30T10:00:00Z') : null,
      deletedAt: state === 'RECENTLY_DELETED' ? NOW : null,
      purgeAfter: state === 'RECENTLY_DELETED' ? new Date('2026-12-01T10:00:00Z') : null,
    },
    removalBlock: null,
    actions,
  }) as never;

const render = (props: Partial<Parameters<typeof TravellerLifecycleBar>[0]>) =>
  renderToStaticMarkup(
    <TravellerLifecycleBar
      applicantId={ID}
      name="Ayesha"
      view={null}
      outcome={undefined}
      now={NOW}
      {...props}
    />,
  );

describe('the traveller lifecycle bar', () => {
  it('renders nothing before the migration (no view) and with nothing to offer', () => {
    expect(render({})).toBe('');
    expect(render({ view: view('CURRENT', []) })).toBe('');
  });

  it('shows the Manage menu for a current traveller with an allowed action', () => {
    const html = render({ view: view('CURRENT', ['ARCHIVE']) });
    expect(html).toContain('aria-label="Manage Ayesha"');
    expect(html).not.toContain('Restore Traveller');
  });

  it('notes an archived traveller opened by link, with Restore Traveller', () => {
    const html = render({ view: view('ARCHIVED', ['RESTORE']) });
    expect(html).toContain('<strong>Archived</strong>');
    expect(html).toContain('reminders are paused');
    expect(html).toContain('name="command" value="restore"');
    expect(html).toContain('name="returnTo" value="traveller"');
    // Restore is not in the menu, so no menu is drawn.
    expect(html).not.toContain('aria-haspopup');
  });

  it('notes a record in Recently Deleted with the days left and Restore Traveller', () => {
    const html = render({ view: view('RECENTLY_DELETED', ['RESTORE_DELETED']) });
    expect(html).toContain('<strong>Recently Deleted</strong>');
    expect(html).toContain('Removed in 30 Days');
    expect(html).toContain('name="command" value="restoreDeleted"');
  });

  it('shows the result of the last action in a status, even before the migration', () => {
    const html = render({ outcome: 'refused-notEmpty' });
    expect(html).toContain('<output id="traveller-outcome"');
    expect(html).toContain('it can only be archived');
    expect(render({ outcome: 'something-else' })).toBe('');
  });
});
