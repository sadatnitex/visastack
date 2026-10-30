import { expect, it } from 'vitest';
import { describeProviderOperations } from './provider-operations';

it('keeps unavailable figures distinct from measured zero and provider bills', () => {
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const rows = describeProviderOperations(
      { ...(value === undefined ? {} : { evidenceBytes: value, aiCostUnits: value }) },
      {},
    );
    expect(rows.find((row) => row.label === 'Tracked Evidence Storage')?.reading).toBe(
      'Unavailable',
    );
    expect(rows.find((row) => row.label === 'Tracked AI Usage')?.reading).toBe('Unavailable');
  }
  const zero = describeProviderOperations({ evidenceBytes: 0, aiCostUnits: 0 }, {});
  expect(zero.find((row) => row.label === 'Tracked Evidence Storage')?.reading).toBe('0 bytes');
  expect(zero.find((row) => row.label === 'Provider Bills and Free-Plan Headroom')?.source).toBe(
    'Not measured',
  );
});
it('does not infer configured application delivery from a key alone', () => {
  const rows = describeProviderOperations({}, { RESEND_API_KEY: 'private-marker' });
  expect(rows.find((row) => row.label === 'Application Email')?.reading).toBe('Not configured');
  expect(rows.find((row) => row.label === 'Email Delivery Receipts')?.reading).toBe(
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
  expect(rows.find((row) => row.label === 'Application Email')?.reading).toBe(
    'Configuration present',
  );
  expect(rows.find((row) => row.label === 'Encryption Key Recovery')?.reading).toBe(
    'Key present; recovery unverified',
  );
  expect(JSON.stringify(rows)).not.toContain('private-marker');
  expect(JSON.stringify(rows)).not.toContain('noreply@example.com');
});

it('does not mistake environment-key absence for database-managed AI status', () => {
  const absent = describeProviderOperations({}, {});
  const row = absent.find((item) => item.label === 'AI Environment Key');
  expect(row?.reading).toBe('No supported environment key');
  expect(row?.detail).toContain('database-managed provider');
  const present = describeProviderOperations({}, { OPENAI_API_KEY: 'private-marker' });
  expect(present.find((item) => item.label === 'AI Environment Key')?.reading).toBe(
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
  const standing = (label: string) => rows.find((row) => row.label === label)?.standing;
  expect(standing('Application Email')).toBe('Set Up');
  expect(standing('Tracked Evidence Storage')).toBe('Recorded');
  expect(standing('Encryption Key Recovery')).toBe('Not Proven');
  expect(standing('Backup Recovery')).toBe('Not Proven');
  expect(standing('Provider Bills and Free-Plan Headroom')).toBe('Not Measured');
  expect(JSON.stringify(rows)).not.toContain('private-marker');
});

it('says a missing sender is not set up instead of calling it set up', () => {
  const rows = describeProviderOperations({}, {});
  expect(rows.find((row) => row.label === 'Application Email')?.standing).toBe('Not Set Up');
  expect(rows.find((row) => row.label === 'Tracked Evidence Storage')?.standing).toBe(
    'Not Measured',
  );
});

it('shows AI App Access as On only when the connector switch is on (S19 step 0, for S28)', () => {
  const row = (env: Record<string, string>) =>
    describeProviderOperations({}, env).find((item) => item.label === 'AI App Access');
  expect(row({})).toMatchObject({ reading: 'Off', standing: 'Not Set Up' });
  expect(row({})?.headline).toMatch(/^AI App Access: Off\./);
  expect(row({ AI_CONNECTOR_ENABLED: 'TRUE' })?.reading).toBe('Off');
  // Read exactly as the connector itself reads it: spaces around "true" are ignored.
  expect(row({ AI_CONNECTOR_ENABLED: ' true ' })).toMatchObject({
    reading: 'On',
    standing: 'Set Up',
  });
  expect(row({ AI_CONNECTOR_ENABLED: 'true' })?.headline).toMatch(/^AI App Access: On\./);
});

it('has one Online Payments row per payment provider, with its mode, currencies and refunds (S19 step 0)', () => {
  const rows = describeProviderOperations(
    {},
    {
      PAYMENT_PROVIDERS: 'sslcommerz',
      SSLCOMMERZ_STORE_ID: 'store-1',
      SSLCOMMERZ_STORE_PASSWORD: 'private-marker',
      SSLCOMMERZ_MODE: 'sandbox',
    },
  );
  const payments = rows.filter((row) => row.label.startsWith('Online Payments'));
  expect(payments.map((row) => row.label)).toEqual(['Online Payments: SSLCOMMERZ']);
  expect(payments[0]).toMatchObject({ reading: 'Test payments only', standing: 'Set Up' });
  expect(payments[0]?.detail).toContain('Takes invoices in BDT.');
  expect(payments[0]?.detail).toContain('Refunds can be sent through it');
  expect(JSON.stringify(rows)).not.toContain('private-marker');
});
