import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./extend-grant-action', () => ({
  extendGrantAction: async () => ({ ok: true, message: '' }),
}));

import { AccessEndsNote } from './access-ends-note';
import { ExtendGrantButton } from './extend-grant-button';
import { canOfferExtension } from './grant-extension';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-10T09:00:00Z');
const inDays = (days: number) => new Date(now.getTime() + days * DAY);

describe('canOfferExtension', () => {
  it('offers it for an active grant that is still running and can grow by the full 30 days', () => {
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: inDays(5) }, now)).toBe(true);
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: inDays(60) }, now)).toBe(true);
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: inDays(5).toISOString() }, now)).toBe(
      true,
    );
  });

  it('offers nothing for paused, revoked, waiting, ended, undated or fully extended grants', () => {
    for (const status of ['PAUSED', 'REVOKED', 'EXPIRED', 'PENDING_ACCEPTANCE']) {
      expect(canOfferExtension({ status, expiryAt: inDays(5) }, now)).toBe(false);
    }
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: inDays(-1) }, now)).toBe(false);
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: null }, now)).toBe(false);
    // Near the 90-day ceiling it would add fewer than 30 days, so nothing is promised.
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: inDays(61) }, now)).toBe(false);
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: inDays(90) }, now)).toBe(false);
    expect(canOfferExtension({ status: 'ACTIVE', expiryAt: 'not a date' }, now)).toBe(false);
  });
});

describe('ExtendGrantButton', () => {
  it('is one Title Case button carrying the end date the person saw', () => {
    const html = renderToStaticMarkup(
      <ExtendGrantButton applicantId="a1" grantId="g1" expiresAt="2026-12-01T00:00:00.000Z" />,
    );
    expect(html).toContain('Keep Sharing for 30 More Days');
    expect(html).toContain('id="extend-grant-g1"');
    expect(html).toContain('name="grantId" value="g1"');
    expect(html).toContain('name="applicantId" value="a1"');
    expect(html).toContain('name="expectedExpiryAt" value="2026-12-01T00:00:00.000Z"');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe('AccessEndsNote', () => {
  it('tells the agency the end date and that only the traveller can extend, with no button', () => {
    const html = renderToStaticMarkup(<AccessEndsNote endsAt="2026-12-01T00:00:00.000Z" />);
    expect(html).toContain('Access ends on 1 Dec 2026. The traveller can extend it.');
    expect(html).not.toContain('<button');
  });

  it("names the traveller's own calendar day, not the server's", () => {
    // 20:00 UTC on 2 Dec is already 3 Dec in Dhaka, the day the reminder names.
    const at = '2026-12-02T20:00:00.000Z';
    expect(renderToStaticMarkup(<AccessEndsNote endsAt={at} timeZone="Asia/Dhaka" />)).toContain(
      'Access ends on 3 Dec 2026.',
    );
    expect(renderToStaticMarkup(<AccessEndsNote endsAt={at} />)).toContain(
      'Access ends on 2 Dec 2026.',
    );
  });

  it('says nothing when there is no end date', () => {
    expect(renderToStaticMarkup(<AccessEndsNote endsAt={null} />)).toBe('');
  });
});
