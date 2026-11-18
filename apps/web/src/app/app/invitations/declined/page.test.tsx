import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import Page from './page';

describe('after saying no (DECL1)', () => {
  it('says plainly that it ended, names nothing about the invitation, and leads home', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Invitation Declined');
    expect(text).toContain('You said no. No access was given, and the link no longer works.');
    expect(html).toContain('href="/app"');
    expect(text).toContain('Return to Your Workspace');
  });
});
