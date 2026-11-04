import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';
import { AdminNotForRole, AdminRestricted } from './admin-restricted';

describe('the two refusals on a platform page', () => {
  it('tells a staff member who lacks the role who can open the view, in plain words', async () => {
    const text = textOf(
      await renderServer(<AdminNotForRole needs="a Support Admin or a platform owner" />),
    );
    expect(text).toContain('Not available for your role.');
    expect(text).toContain('This view is for a Support Admin or a platform owner.');
    expect(text).not.toMatch(/[A-Z]+_ADMIN/);
  });

  it('keeps the short wording when no role is named', async () => {
    expect(textOf(await renderServer(<AdminNotForRole />))).toContain(
      'Ask a platform owner if you need this view.',
    );
  });

  it('keeps the administrator wording for someone who holds no platform role at all', async () => {
    expect(textOf(await renderServer(<AdminRestricted />))).toContain(
      'restricted to platform administrators',
    );
  });
});
