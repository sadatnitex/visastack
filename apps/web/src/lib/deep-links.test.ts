import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WHATSAPP_SETTINGS_PATH } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import {
  DEEP_LINK_ROUTES,
  type DeepLink,
  InvalidDeepLinkError,
  deepLinkPath,
  deepLinkUrl,
} from './deep-links';

const APP_DIR = join(__dirname, '..', 'app');
const ID = '0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

describe('stable deep-link routes', () => {
  it.each(Object.entries(DEEP_LINK_ROUTES))('%s still has its page (%s)', (_kind, route) => {
    expect(existsSync(join(APP_DIR, route, 'page.tsx'))).toBe(true);
  });
});

describe('links sent from WhatsApp', () => {
  it('point at a page that exists', () => {
    expect(existsSync(join(APP_DIR, WHATSAPP_SETTINGS_PATH, 'page.tsx'))).toBe(true);
    expect(existsSync(join(APP_DIR, '/app/applicants', 'page.tsx'))).toBe(true);
    expect(existsSync(join(APP_DIR, '/app/applicant/[id]', 'page.tsx'))).toBe(true);
  });
});

describe('deepLinkPath', () => {
  it('fills the record id into the route', () => {
    expect(deepLinkPath({ kind: 'case', caseId: ID })).toBe(`/app/mission/${ID}`);
    expect(deepLinkPath({ kind: 'documents', applicantId: ID })).toBe(
      `/app/applicant/${ID}/documents`,
    );
    expect(deepLinkPath({ kind: 'shared-with-me', grantId: ID })).toBe(`/app/shared/${ID}`);
    expect(deepLinkPath({ kind: 'workspace' })).toBe('/app');
  });

  it('refuses anything that is not a record id, so no personal value can reach a link', () => {
    const attempts: DeepLink[] = [
      { kind: 'case', caseId: 'A12345678' },
      { kind: 'profile-review', applicantId: 'rahim@example.com' },
      { kind: 'expiry', applicantId: `${ID}?token=secret` },
      { kind: 'sharing-review', applicantId: '../../api/blob/key' },
      { kind: 'documents', applicantId: '' },
    ];
    for (const link of attempts) expect(() => deepLinkPath(link)).toThrow(InvalidDeepLinkError);
  });

  it('never carries a query string or fragment', () => {
    for (const kind of Object.keys(DEEP_LINK_ROUTES)) {
      const link = { kind, caseId: ID, applicantId: ID, grantId: ID } as unknown as DeepLink;
      expect(deepLinkPath(link)).toMatch(/^\/app[/a-z0-9-]*$/);
    }
  });

  it('normalises an upper-case id', () => {
    expect(deepLinkPath({ kind: 'traveller', applicantId: ID.toUpperCase() })).toBe(
      `/app/applicant/${ID}`,
    );
  });
});

describe('deepLinkUrl', () => {
  it('builds an absolute HTTPS link on the given origin', () => {
    expect(
      deepLinkUrl('https://vs.obsidianglobal.studio', { kind: 'expiry', applicantId: ID }),
    ).toBe(`https://vs.obsidianglobal.studio/app/applicant/${ID}/expiry`);
  });
});
