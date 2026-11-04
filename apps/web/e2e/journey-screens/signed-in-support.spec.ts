import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { blocked, configured, confirmed, optional } from '../signed-in/support/setup';
import { RFC6238_SECRET_BASE32, totp } from '../signed-in/support/totp';
import { expectNoApprovalPromise, keepEvidence } from '../signed-in/support/ui';

/**
 * The parts of the on-demand signed-in suite that need no deployment, so a pull request still
 * proves them: how a missing setting fails (BLOCKED, by name, never by value), the second-step
 * code generator, and the promise detector the case journey uses. The journeys themselves never
 * run here (playwright.config.ts ignores e2e/signed-in).
 */

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const before: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) {
    before[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test.describe('missing setup fails closed', () => {
  test('a missing setting is BLOCKED and names the setting', () => {
    withEnv({ E2E_TEST_ONLY_SETTING: undefined }, () => {
      expect(() => configured('E2E_TEST_ONLY_SETTING')).toThrow(
        'BLOCKED: missing staging setting E2E_TEST_ONLY_SETTING',
      );
    });
  });

  test('an empty setting counts as missing, and a present one is returned but never named in a failure', () => {
    withEnv({ E2E_TEST_ONLY_SETTING: '' }, () => {
      expect(() => configured('E2E_TEST_ONLY_SETTING')).toThrow(/BLOCKED/);
      expect(optional('E2E_TEST_ONLY_SETTING')).toBeUndefined();
    });
    withEnv({ E2E_TEST_ONLY_SETTING: 'a-value-that-must-not-leak' }, () => {
      expect(configured('E2E_TEST_ONLY_SETTING')).toBe('a-value-that-must-not-leak');
      let message = '';
      try {
        confirmed('E2E_TEST_ONLY_SETTING', 'The owner has not confirmed it.');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('BLOCKED: E2E_TEST_ONLY_SETTING is not "true"');
      expect(message).not.toContain('a-value-that-must-not-leak');
    });
  });

  test('a fact the owner confirms must be exactly true', () => {
    withEnv({ E2E_TEST_ONLY_SETTING: 'true' }, () => {
      expect(() => confirmed('E2E_TEST_ONLY_SETTING', 'x')).not.toThrow();
    });
    for (const wrong of ['TRUE', 'yes', '1', 'false']) {
      withEnv({ E2E_TEST_ONLY_SETTING: wrong }, () => {
        expect(() => confirmed('E2E_TEST_ONLY_SETTING', 'x')).toThrow(/BLOCKED/);
      });
    }
  });

  test('blocked() always throws a BLOCKED message', () => {
    expect(() => blocked('the feature is not deployed')).toThrow(
      'BLOCKED: the feature is not deployed',
    );
  });
});

test.describe('second-step code', () => {
  // RFC 6238 appendix B, SHA-1, secret "12345678901234567890", six digits kept.
  test('matches the RFC 6238 published values', () => {
    expect(totp(RFC6238_SECRET_BASE32, 59_000)).toBe('287082');
    expect(totp(RFC6238_SECRET_BASE32, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC6238_SECRET_BASE32, 1_234_567_890_000)).toBe('005924');
  });

  test('stays the same inside one 30 second step and changes at the next', () => {
    const a = totp(RFC6238_SECRET_BASE32, 60_000);
    expect(totp(RFC6238_SECRET_BASE32, 89_999)).toBe(a);
    expect(totp(RFC6238_SECRET_BASE32, 90_000)).not.toBe(a);
  });

  test('refuses a secret that is not base32', () => {
    expect(() => totp('not base32 !!')).toThrow();
  });
});

test.describe('approval promise detector', () => {
  test('catches a score, a chance and a rate', () => {
    for (const text of [
      'Your approval probability is high.',
      'There is a 70% chance of approval.',
      'You are likely to be approved.',
      'Visa success rate for this route',
    ]) {
      expect(() => expectNoApprovalPromise(text), text).toThrow();
    }
  });

  test('lets the disclaimer that denies a promise through', () => {
    expect(() =>
      expectNoApprovalPromise(
        'Completeness of the checklist is not an approval probability. Nobody can promise an outcome.',
      ),
    ).not.toThrow();
  });
});

test.describe('evidence', () => {
  test('is written into the output folder and attached by path, so the upload can find it', async () => {
    const info = test.info();
    await keepEvidence(info, 'probe.txt', 'synthetic evidence', 'text/plain');
    const attached = info.attachments.find((a) => a.name === 'probe.txt');
    // Playwright copies a path attachment into the run's output folder; that copy is what is uploaded.
    expect(attached?.path?.startsWith(info.outputDir)).toBe(true);
    expect(attached?.body).toBeUndefined();
    expect(readFileSync(attached?.path ?? '', 'utf8')).toBe('synthetic evidence');
  });
});
