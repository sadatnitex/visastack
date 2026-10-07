import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { pilotAccessBypassed, pilotInviteOnly } from './pilot-access';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('who may get an account in a real deployment', () => {
  it('lets anyone in by default (open sign-up)', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
    vi.stubEnv('PILOT_INVITE_ONLY', '');
    expect(pilotInviteOnly()).toBe(false);
    expect(pilotAccessBypassed()).toBe(true);
  });

  it('brings the invitation gate back only when PILOT_INVITE_ONLY is true', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
    vi.stubEnv('PILOT_INVITE_ONLY', ' TRUE ');
    expect(pilotInviteOnly()).toBe(true);
    expect(pilotAccessBypassed()).toBe(false);
  });

  it('treats any other value as open', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
    vi.stubEnv('PILOT_INVITE_ONLY', 'yes');
    expect(pilotAccessBypassed()).toBe(true);
  });
});
