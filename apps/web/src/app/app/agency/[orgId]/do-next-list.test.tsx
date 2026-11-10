import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DoNextItem } from './do-next';

vi.mock('./follow-up-copy', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { FollowUpCopy: stub('FollowUpCopy') };
});

import { DoNextList } from './do-next-list';

const item = (key: string): DoNextItem => ({
  key,
  tier: 1,
  tierLabel: 'No Reply Yet',
  heading: 'Bank Statement',
  traveller: 'Test Traveller',
  caseTitle: 'Test Case',
  owner: 'You',
  reason: 'Sent 5 days ago with no due date. No reply yet.',
  action: { kind: 'link', label: 'Open Case', href: '/app/agency/o1/cases' },
});

const draw = (quietHidden: number, filtered = false) =>
  renderToStaticMarkup(
    <DoNextList
      items={[item('request:a'), item('request:b'), item('request:c')]}
      admin
      filtered={filtered}
      quietHidden={quietHidden}
      base="/app/agency/o1"
    />,
  );

describe('the quiet requests line on Do Next', () => {
  it('links to the Clients list of requests with no reply, in plain words', () => {
    const html = draw(4);
    expect(html).toContain('href="/app/agency/o1/clients?status=open"');
    expect(html).toContain('4 more requests have had no reply');
  });

  it('agrees with one request', () => {
    expect(draw(1)).toContain('1 more request has had no reply');
  });

  it('says the count is for the cases in view when the view is narrowed, and offers all open requests', () => {
    const html = draw(5, true);
    expect(html).toContain('5 more requests in this view have had no reply.');
    expect(html).toContain('See All Open Requests');
    expect(html).toContain('href="/app/agency/o1/clients?status=open"');
  });

  it('draws no line when none were left off', () => {
    expect(draw(0)).not.toContain('had no reply');
  });
});
