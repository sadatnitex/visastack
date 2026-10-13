import { expect, it } from 'vitest';
import { describeProviderOperations } from './provider-operations';

it('keeps unavailable figures distinct from measured zero and provider bills', () => {
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const rows = describeProviderOperations(
      { ...(value === undefined ? {} : { evidenceBytes: value, aiCostUnits: value }) },
      {},
    );
    expect(rows.find((row) => row.label === 'Tracked evidence storage')?.reading).toBe(
      'Unavailable',
    );
    expect(rows.find((row) => row.label === 'Tracked AI usage')?.reading).toBe('Unavailable');
  }
  const zero = describeProviderOperations({ evidenceBytes: 0, aiCostUnits: 0 }, {});
  expect(zero.find((row) => row.label === 'Tracked evidence storage')?.reading).toBe('0 bytes');
  expect(zero.find((row) => row.label === 'Provider bills and free-plan headroom')?.source).toBe(
    'Not measured',
  );
});
it('does not infer configured application delivery from a key alone', () => {
  const rows = describeProviderOperations({}, { RESEND_API_KEY: 'private-marker' });
  expect(rows.find((row) => row.label === 'Application email')?.reading).toBe('Not configured');
  expect(rows.find((row) => row.label === 'Email delivery receipts')?.reading).toBe(
    'Not configured',
  );
});
it('never exposes credentials or treats their presence as recovery proof', () => {
  const rows = describeProviderOperations(
    {},
    {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'private-marker',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
      RESEND_WEBHOOK_SECRET: 'private-marker',
      KMS_LOCAL_MASTER_KEY_BASE64: 'private-marker',
    },
  );
  expect(rows.find((row) => row.label === 'Application email')?.reading).toBe(
    'Configuration present',
  );
  expect(rows.find((row) => row.label === 'Encryption key recovery')?.reading).toBe(
    'Key present; recovery unverified',
  );
  expect(JSON.stringify(rows)).not.toContain('private-marker');
  expect(JSON.stringify(rows)).not.toContain('noreply@example.com');
});

it('does not mistake environment-key absence for database-managed AI status', () => {
  const absent = describeProviderOperations({}, {});
  const row = absent.find((item) => item.label === 'AI environment key');
  expect(row?.reading).toBe('No supported environment key');
  expect(row?.detail).toContain('database-managed provider');
  const present = describeProviderOperations({}, { OPENAI_API_KEY: 'private-marker' });
  expect(present.find((item) => item.label === 'AI environment key')?.reading).toBe(
    'Environment key present',
  );
  expect(JSON.stringify(present)).not.toContain('private-marker');
  expect(JSON.stringify(present)).not.toContain('Processing enabled');
});

it('gives every row a plain status and a one-sentence headline that never overclaims', () => {
  const rows = describeProviderOperations(
    { evidenceBytes: 2048, aiCostUnits: 3 },
    {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'private-marker',
      RESEND_FROM_ADDRESS: 'noreply@example.com',
      KMS_LOCAL_MASTER_KEY_BASE64: 'private-marker',
    },
  );
  for (const row of rows) {
    expect(row.headline.length, row.label).toBeGreaterThan(10);
    expect(row.headline, row.label).not.toMatch(/\bgood\b|\bhealthy\b|\bverified\b/i);
  }
  const status = (label: string) => rows.find((row) => row.label === label)?.status;
  expect(status('Application email')).toBe('Set Up');
  expect(status('Tracked evidence storage')).toBe('Recorded');
  expect(status('Encryption key recovery')).toBe('Not Proven');
  expect(status('Backup recovery')).toBe('Not Proven');
  expect(status('Provider bills and free-plan headroom')).toBe('Not Measured');
  expect(JSON.stringify(rows)).not.toContain('private-marker');
});

it('says a missing sender is not set up instead of calling it set up', () => {
  const rows = describeProviderOperations({}, {});
  expect(rows.find((row) => row.label === 'Application email')?.status).toBe('Not Set Up');
  expect(rows.find((row) => row.label === 'Tracked evidence storage')?.status).toBe('Not Measured');
});
