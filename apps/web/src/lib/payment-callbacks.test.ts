import { createHash, randomUUID } from 'node:crypto';
import { NullPaymentPort, SslcommerzPaymentPort } from '@visastack/adapters';
import { FakeSslcommerzGateway } from '@visastack/adapters/testing';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  type PaymentPort,
  createInvoice,
  createOrganization,
  getPlanByKey,
  grantPlatformRole,
  provisionAccount,
  reviewOrganization,
  startOnlinePayment,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./public-db', () => ({ withPublicDb: vi.fn() }));
vi.mock('./providers', () => ({ createPaymentPort: vi.fn() }));

const get = (record: Readonly<Record<string, string>> | null | undefined, name: string) =>
  record?.[name];

const STORE_ID = 'visastacktest001';
const PASSWORD = 'store-password-that-must-never-leak';
const BASE = 'https://app.example.test';

const { handleBrowserReturn, handleGatewayNotification, readCallbackForm } = await import(
  './payment-callbacks'
);
const { verifyPaymentResultParams } = await import('./payment-result');

let db: Db;
let gateway: FakeSslcommerzGateway;
let port: PaymentPort;
let invoiceId: string;
let tran: string;
let logged: string[];

const deps = (override: Partial<{ port: () => PaymentPort }> = {}) => ({
  port: () => port,
  withDb: <T>(work: (handle: Db) => Promise<T>) => work(db),
  baseUrl: () => BASE,
  ...override,
});

const formRequest = (
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
const ipn = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  formRequest('/api/payments/sslcommerz/ipn', fields, headers);

const attemptsOf = (forInvoice: string) =>
  db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.invoiceId, forInvoice));
const ledger = () => db.select().from(schema.invoicePayments);
const attempt = async () => (await attemptsOf(invoiceId))[0];
const invoice = async () =>
  (await db.select().from(schema.invoices))[0] as typeof schema.invoices.$inferSelect;

async function seed() {
  const platform = await provisionAccount(db, { email: 'platform@example.com' });
  if (!platform.ok) throw new Error('platform');
  await grantPlatformRole(db, {
    actor: {
      accountId: platform.value.id,
      email: platform.value.email,
      bootstrapEmails: [platform.value.email],
    },
    targetAccountId: platform.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  const admin = await provisionAccount(db, { email: 'admin@acme.example' });
  if (!admin.ok) throw new Error('admin');
  const org = await createOrganization(db, { actorAccountId: admin.value.id, name: 'Acme Travel' });
  if (!org.ok) throw new Error('org');
  const reviewer = await provisionAccount(db, { email: 'reviewer@example.com' });
  if (!reviewer.ok) throw new Error('reviewer');
  await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  const plan = await getPlanByKey(db, 'agency_starter');
  if (!plan) throw new Error('plan');
  const now = new Date();
  const created = await createInvoice(db, {
    actor: { accountId: platform.value.id, email: platform.value.email, bootstrapEmails: [] },
    stepUpSatisfied: true,
    organizationId: org.value.id,
    planId: plan.id,
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 86_400_000),
    invoiceRef: 'INV-CB-1',
    invoicedAmountMinorUnits: 125050,
    currency: 'BDT',
    dueDate: new Date(now.getTime() + 14 * 86_400_000),
  });
  if (!created.ok) throw new Error('invoice');
  // S29: the sandbox is the gateway's test mode, where only the platform owner may start a
  // payment (for an agency they belong to), as the owner does when testing.
  await db.insert(schema.memberships).values({
    accountId: platform.value.id,
    organizationId: org.value.id,
    role: 'ADMIN',
    active: true,
  });
  const started = await startOnlinePayment(db, port, {
    actorAccountId: platform.value.id,
    actorEmail: platform.value.email,
    bootstrapEmails: [],
    invoiceId: created.value.id,
    urlFor: (kind, id) =>
      `${BASE}/api/payments/sslcommerz/${kind === 'ipn' ? 'ipn' : `return?o=${kind}&t=${id}`}`,
  });
  if (!started.ok) throw new Error('start');
  invoiceId = created.value.id;
  const row = await attempt();
  if (!row) throw new Error('attempt');
  tran = row.merchantTranId;
}

beforeEach(async () => {
  vi.stubEnv('SSLCOMMERZ_STORE_PASSWORD', PASSWORD);
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  gateway = new FakeSslcommerzGateway({ storeId: STORE_ID, storePassword: PASSWORD });
  port = new SslcommerzPaymentPort({
    storeId: STORE_ID,
    storePassword: PASSWORD,
    mode: 'sandbox',
    fetch: gateway.fetch,
    sessionTimeoutMs: 500,
    validationTimeoutMs: 500,
  });
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
  await seed();
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the gateway notification address', () => {
  it('counts a genuine payment once, however often the gateway repeats the notification', async () => {
    gateway.pay(tran);
    const first = await handleGatewayNotification(ipn(gateway.notification(tran)), deps());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    for (let i = 0; i < 3; i++) {
      const again = await handleGatewayNotification(ipn(gateway.notification(tran)), deps());
      expect(again.status).toBe(200);
    }
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'ONLINE', amountMinorUnits: 125050, currency: 'BDT' });
    expect((await invoice()).status).toBe('PAID');
    expect((await attempt())?.status).toBe('RECORDED');
  });

  it('records nothing for a forged notification: no signature, a wrong signature, or a stranger password', async () => {
    gateway.pay(tran);
    const good = gateway.notification(tran);
    const stranger = new FakeSslcommerzGateway({ storeId: STORE_ID, storePassword: 'guess' });
    const forgeries: Array<Record<string, string>> = [
      { status: 'VALID', tran_id: tran, val_id: get(good, 'val_id') ?? '', amount: '1250.50' },
      { ...good, verify_sign: '0'.repeat(32) },
      { ...good, amount: '0.01' },
      stranger.sign({ status: 'VALID', tran_id: tran, val_id: get(good, 'val_id') ?? '' }),
    ];
    for (const form of forgeries) {
      const response = await handleGatewayNotification(ipn(form), deps());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
    }
    expect(await ledger()).toHaveLength(0);
    expect((await invoice()).status).toBe('OPEN');
    expect((await attempt())?.status).toBe('REDIRECTED');
    // Not even the gateway was asked: a bad signature stops it at the door.
    expect(gateway.requests.filter((r) => r.path.includes('validator'))).toHaveLength(0);
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.filter((a) => a.eventType === 'PAYMENT_CALLBACK_REJECTED')).toHaveLength(4);
  });

  it('asks the gateway even when the signature is right, and records nothing it does not confirm', async () => {
    // A correctly signed notification that claims success for a payment the gateway never saw.
    const claimed = gateway.sign({
      status: 'VALID',
      tran_id: tran,
      val_id: 'NEVERPAID12345',
      amount: '1250.50',
      currency: 'BDT',
    });
    const response = await handleGatewayNotification(ipn(claimed), deps());
    expect(response.status).toBe(200);
    expect(await ledger()).toHaveLength(0);
    expect((await attempt())?.status).toBe('REDIRECTED');
    expect(gateway.requests.some((r) => r.path.includes('validationserverAPI'))).toBe(true);
  });

  it('does not let a forged failure disturb a payment the gateway shows as made', async () => {
    gateway.pay(tran);
    const failed = gateway.sign({ status: 'FAILED', tran_id: tran, amount: '1250.50' });
    expect((await handleGatewayNotification(ipn(failed), deps())).status).toBe(200);
    // The gateway was asked by transaction id and said paid: the payment counts.
    expect((await attempt())?.status).toBe('RECORDED');
    expect(await ledger()).toHaveLength(1);
  });

  it('holds a payment whose amount, currency or store differs, and a risky one', async () => {
    const cases: Array<[string, Parameters<FakeSslcommerzGateway['pay']>[1]]> = [
      ['amount', { reportedAmount: '1.00' }],
      ['currency', { currencyType: 'USD' }],
      ['store', { reportedStoreId: 'someone-else' }],
      ['risk', { riskLevel: '1' }],
    ];
    for (const [name, overrides] of cases) {
      const fresh = await freshAttempt(`INV-CB-${name}`);
      gateway.pay(fresh.tran, overrides);
      const response = await handleGatewayNotification(
        ipn(gateway.notification(fresh.tran)),
        deps(),
      );
      expect(response.status, name).toBe(200);
      const row = (await attemptsOf(fresh.invoiceId))[0];
      expect(row?.status, name).toBe('HELD_FOR_REVIEW');
    }
    expect(await ledger()).toHaveLength(0);
  });

  it('answers 503 so the gateway retries when it cannot be asked, and counts the payment once it can', async () => {
    gateway.pay(tran);
    gateway.setOutage(true);
    const down = await handleGatewayNotification(ipn(gateway.notification(tran)), deps());
    expect(down.status).toBe(503);
    expect(await ledger()).toHaveLength(0);
    expect((await attempt())?.status).toBe('REDIRECTED');
    gateway.setOutage(false);
    const retry = await handleGatewayNotification(ipn(gateway.notification(tran)), deps());
    expect(retry.status).toBe(200);
    expect(await ledger()).toHaveLength(1);
  });

  it('is limited per network address', async () => {
    const key = `net:${createHash('sha256').update('203.0.113.9').digest('hex').slice(0, 32)}`;
    const window = 60 * 60 * 1000;
    const current = Math.floor(Date.now() / window) * window;
    for (const windowStart of [current, current + window]) {
      await db.insert(schema.rateLimitBuckets).values({
        subjectId: key,
        action: 'payments.callback_ip',
        windowStart: new Date(windowStart),
        count: 300,
      });
    }
    gateway.pay(tran);
    const limited = await handleGatewayNotification(
      ipn(gateway.notification(tran), { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }),
      deps(),
    );
    expect(limited.status).toBe(429);
    expect(await ledger()).toHaveLength(0);
    // Another address is not held back.
    const other = await handleGatewayNotification(
      ipn(gateway.notification(tran), { 'x-forwarded-for': '198.51.100.7' }),
      deps(),
    );
    expect(other.status).toBe(200);
    expect(await ledger()).toHaveLength(1);
  });

  it('refuses malformed requests and does nothing while payments are not configured', async () => {
    const wrongType = new Request(`${BASE}/api/payments/sslcommerz/ipn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tran_id: tran }),
    });
    expect((await handleGatewayNotification(wrongType, deps())).status).toBe(400);
    const huge = ipn({ tran_id: tran, pad: 'x'.repeat(40_000) });
    expect((await handleGatewayNotification(huge, deps())).status).toBe(400);
    const manyFields = ipn(
      Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`f${i}`, 'v'])),
    );
    expect((await handleGatewayNotification(manyFields, deps())).status).toBe(400);
    const off = await handleGatewayNotification(
      ipn(gateway.notification(tran)),
      deps({ port: () => new NullPaymentPort() }),
    );
    expect(off.status).toBe(503);
    const broken = await handleGatewayNotification(
      ipn(gateway.notification(tran)),
      deps({
        port: () => {
          throw new Error(`bad configuration ${PASSWORD}`);
        },
      }),
    );
    expect(broken.status).toBe(503);
    expect(await ledger()).toHaveLength(0);
  });

  it('ignores a signed notification for a transaction VisaStack never started', async () => {
    const unknown = gateway.sign({
      status: 'VALID',
      tran_id: 'VSP00000000000000000000000f',
      val_id: 'ABCDEF123456',
    });
    expect((await handleGatewayNotification(ipn(unknown), deps())).status).toBe(200);
    const malformed = gateway.sign({ status: 'VALID', tran_id: "x'; drop table invoices;--" });
    expect((await handleGatewayNotification(ipn(malformed), deps())).status).toBe(200);
    expect(await ledger()).toHaveLength(0);
    const rejected = (await db.select().from(schema.auditEvents)).filter(
      (a) => a.eventType === 'PAYMENT_CALLBACK_REJECTED',
    );
    expect(rejected.map((a) => a.reason)).toEqual(['unknown_transaction', 'unknown_transaction']);
  });

  it('keeps the store password out of every log line, reply and audit record', async () => {
    gateway.pay(tran);
    const replies: string[] = [];
    for (const form of [
      gateway.notification(tran),
      { ...gateway.notification(tran), verify_sign: '0'.repeat(32) },
    ]) {
      const response = await handleGatewayNotification(ipn(form), deps());
      replies.push(await response.text());
    }
    gateway.setOutage(true);
    replies.push(
      await (await handleGatewayNotification(ipn(gateway.notification(tran)), deps())).text(),
    );
    const audits = JSON.stringify(await db.select().from(schema.auditEvents));
    const everything = [...logged, ...replies, audits].join('\n');
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toMatch(/store_passwd/i);
  });
});

describe('the browser return address', () => {
  const returnRequest = (fields: Record<string, string>) =>
    formRequest(`/api/payments/sslcommerz/return?t=${tran}&o=success`, fields);

  it('records nothing for a browser that only claims success, and sends it to a signed result page', async () => {
    const response = await handleBrowserReturn(
      returnRequest({ status: 'VALID', tran_id: tran, val_id: 'CLAIMED123456', amount: '1250.50' }),
      deps(),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe(BASE);
    expect(location.pathname).toBe('/payments/result');
    expect(
      verifyPaymentResultParams({
        t: location.searchParams.get('t') ?? undefined,
        x: location.searchParams.get('x') ?? undefined,
        s: location.searchParams.get('s') ?? undefined,
      }),
    ).toBe(true);
    expect(await ledger()).toHaveLength(0);
    expect((await invoice()).status).toBe('OPEN');
    expect((await attempt())?.status).toBe('REDIRECTED');
  });

  it('settles a real payment with the gateway before sending the browser on', async () => {
    const paid = gateway.pay(tran);
    const response = await handleBrowserReturn(
      returnRequest({ status: 'VALID', tran_id: tran, val_id: paid.valId ?? '' }),
      deps(),
    );
    expect(response.status).toBe(303);
    expect(await ledger()).toHaveLength(1);
    expect((await attempt())?.status).toBe('RECORDED');
    // The notification arriving as well changes nothing.
    await handleGatewayNotification(ipn(gateway.notification(tran)), deps());
    expect(await ledger()).toHaveLength(1);
  });

  it('answers a get with only the transaction in the address, ignoring any claim in it', async () => {
    const response = await handleBrowserReturn(
      new Request(
        `${BASE}/api/payments/sslcommerz/return?t=${tran}&o=success&status=VALID&amount=1`,
      ),
      deps(),
    );
    expect(response.status).toBe(303);
    expect(await ledger()).toHaveLength(0);
  });

  it('sends a made-up or malformed transaction to the generic page, with no signature', async () => {
    for (const id of ['VSP00000000000000000000000f', 'junk', '']) {
      const response = await handleBrowserReturn(
        new Request(`${BASE}/api/payments/sslcommerz/return?t=${encodeURIComponent(id)}`),
        deps(),
      );
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/payments/result');
      expect(location.search).toBe('');
    }
  });

  it('never redirects anywhere but its own result page, whatever the request says', async () => {
    const response = await handleBrowserReturn(
      new Request(`https://evil.example/api/payments/sslcommerz/return?t=${tran}`, {
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      }),
      deps(),
    );
    expect(new URL(response.headers.get('location') ?? '').origin).toBe(BASE);
  });

  it('is limited per network address like the notification address', async () => {
    const key = `net:${createHash('sha256').update('203.0.113.50').digest('hex').slice(0, 32)}`;
    const window = 60 * 60 * 1000;
    const current = Math.floor(Date.now() / window) * window;
    for (const windowStart of [current, current + window]) {
      await db.insert(schema.rateLimitBuckets).values({
        subjectId: key,
        action: 'payments.callback_ip',
        windowStart: new Date(windowStart),
        count: 300,
      });
    }
    gateway.pay(tran);
    const limited = await handleBrowserReturn(
      new Request(`${BASE}/api/payments/sslcommerz/return?t=${tran}`, {
        headers: { 'x-forwarded-for': '203.0.113.50' },
      }),
      deps(),
    );
    // The payer sees the neutral page, never a bare error; nothing was settled.
    expect(limited.status).toBe(303);
    expect(new URL(limited.headers.get('location') ?? '').search).toBe('');
    expect(await ledger()).toHaveLength(0);
    expect(gateway.requests.filter((r) => r.path.includes('validator'))).toHaveLength(0);
  });

  it('fails safe when payments are off or the database fails', async () => {
    const off = await handleBrowserReturn(
      returnRequest({ tran_id: tran }),
      deps({ port: () => new NullPaymentPort() }),
    );
    expect(off.status).toBe(303);
    expect(new URL(off.headers.get('location') ?? '').pathname).toBe('/payments/result');
    expect(new URL(off.headers.get('location') ?? '').search).toBe('');
    const dbDown = await handleBrowserReturn(returnRequest({ tran_id: tran }), {
      ...deps(),
      withDb: async () => {
        throw new Error(`connection string with ${PASSWORD}`);
      },
    });
    expect(dbDown.status).toBe(303);
    expect(new URL(dbDown.headers.get('location') ?? '').search).toBe('');
    expect(logged.join('\n')).not.toContain(PASSWORD);
  });
});

describe('reading a callback form', () => {
  it('takes the first value of a repeated field and refuses a prototype-poisoned name', async () => {
    const request = new Request(`${BASE}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'a=1&a=2&__proto__=x&b=%E2%9C%93',
    });
    const form = await readCallbackForm(request);
    expect(get(form, 'a')).toBe('1');
    expect(get(form, 'b')).toBe('✓');
    expect(Object.getPrototypeOf(form)).toBeNull();
    expect(get({}, 'x')).toBeUndefined();
  });
});

/** A second invoice with its own started payment, for tests that need several. */
async function freshAttempt(ref: string): Promise<{ invoiceId: string; tran: string }> {
  const first = (await db.select().from(schema.invoices))[0];
  const organizationId = first?.organizationId ?? '';
  const planId = first?.planId ?? '';
  const [row] = await db
    .insert(schema.invoices)
    .values({
      organizationId,
      planId,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 86_400_000),
      invoiceRef: ref,
      invoicedAmountMinorUnits: 125050,
      currency: 'BDT',
      dueDate: new Date(Date.now() + 86_400_000),
    })
    .returning();
  if (!row) throw new Error('invoice');
  // S29: in the sandbox (test mode) the platform owner, who is also an admin here, starts it.
  const owner = (
    await db
      .select({ id: schema.accounts.id, email: schema.accounts.email })
      .from(schema.accounts)
      .where(eq(schema.accounts.email, 'platform@example.com'))
  )[0];
  const started = await startOnlinePayment(db, port, {
    actorAccountId: owner?.id ?? randomUUID(),
    actorEmail: owner?.email ?? '',
    bootstrapEmails: [],
    invoiceId: row.id,
    urlFor: (kind, id) => `${BASE}/x/${kind}/${id}`,
  });
  if (!started.ok) throw new Error('start');
  const attemptRow = (await attemptsOf(row.id))[0];
  return { invoiceId: row.id, tran: attemptRow?.merchantTranId ?? '' };
}
