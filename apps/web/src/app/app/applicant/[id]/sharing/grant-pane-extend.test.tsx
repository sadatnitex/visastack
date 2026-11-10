import type { GrantWithRecipient } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../components/grant-expiry/extend-grant-action', () => ({
  extendGrantAction: async () => ({ ok: true, message: '' }),
}));
vi.mock('./actions', () => ({
  updateGrantAction: async () => ({ ok: true, message: '' }),
}));
vi.mock('./grant-ai-actions', () => ({}));
vi.mock('./ai-connection-actions', () => ({}));

import { GrantPane } from './grant-pane';

const DAY = 24 * 60 * 60 * 1000;

function grant(status: string, endsInDays: number | null): GrantWithRecipient {
  return {
    id: 'g1',
    applicantId: 'a1',
    status,
    actions: ['VIEW_METADATA'],
    purpose: 'visa_application',
    categories: null,
    documentIds: null,
    missionId: null,
    acceptedAt: new Date(Date.now() - 3 * DAY),
    expiryAt: endsInDays === null ? null : new Date(Date.now() + endsInDays * DAY),
    caseExceptions: [],
    recipient: { kind: 'organization', label: 'Harbor Visas' },
  } as unknown as GrantWithRecipient;
}

const render = (g: GrantWithRecipient) =>
  renderToStaticMarkup(
    <GrantPane
      applicantId="a1"
      grant={g}
      ended={false}
      badge={{ label: 'Active', tone: 'badge-ok' }}
      documents={[]}
      aiAssistReady={false}
      expansions={[]}
    />,
  );

describe('Keep Sharing for 30 More Days in the grant panel', () => {
  it('sits beside Pause and Revoke for an active grant that is about to end', () => {
    const html = render(grant('ACTIVE', 5));
    expect(html).toContain('Keep Sharing for 30 More Days');
    expect(html.indexOf('Revoke')).toBeLessThan(html.indexOf('Keep Sharing for 30 More Days'));
    expect(html).toContain('name="grantId" value="g1"');
  });

  it('is not offered for a paused, revoked or undated grant, or one already near the ceiling', () => {
    for (const html of [
      render(grant('PAUSED', 5)),
      render(grant('REVOKED', 5)),
      render(grant('ACTIVE', null)),
      render(grant('ACTIVE', 80)),
    ]) {
      expect(html).not.toContain('Keep Sharing for 30 More Days');
    }
  });
});
