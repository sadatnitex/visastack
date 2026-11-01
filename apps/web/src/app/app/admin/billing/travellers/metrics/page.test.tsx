import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../../lib/axe.test-support';
import {
  navigationState,
  renderServer,
  textOf,
} from '../../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  travellerPlanMetrics: vi.fn(),
  travellerPlanHealth: vi.fn(),
}));

vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@example.com' }),
}));
vi.mock('../../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  travellerPlanMetrics: (...args: unknown[]) => mocks.travellerPlanMetrics(...args),
  travellerPlanHealth: (...args: unknown[]) => mocks.travellerPlanHealth(...args),
}));
vi.mock('./actions', () => ({
  saveTravellerThresholdsAction: async () => ({ ok: true, message: '' }),
}));

const { TRAVELLER_HEALTH_UNAVAILABLE } = await import('@visastack/services');
const { default: Page } = await import('./page');

const NOW = new Date('2026-11-01T06:00:00Z');
const SCOPE = { kind: 'staff', platformAction: 'PLANS_MANAGE' };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const EMPTY = {
  views: 0,
  getTaps: 0,
  checkouts: 0,
  payments: 0,
  renewalsMade: 0,
  renewalsPaid: 0,
  lapses: 0,
  stops: 0,
  refunds: 0,
};

/** 14 Bangladesh days, newest first, with two days that have something in them. */
function days() {
  return Array.from({ length: 14 }, (_, back) => {
    const day = new Date(Date.UTC(2026, 10, 1 - back)).toISOString().slice(0, 10);
    if (back === 0) {
      return {
        day,
        ...EMPTY,
        views: 41,
        getTaps: 9,
        checkouts: 7,
        payments: 3,
        renewalsMade: 2,
        renewalsPaid: 1,
        lapses: 1,
        stops: 2,
        refunds: 1,
      };
    }
    if (back === 3) return { day, ...EMPTY, views: 17, getTaps: 4, checkouts: 1, payments: 1 };
    return { day, ...EMPTY };
  });
}

const TOTALS = {
  views: 58,
  getTaps: 13,
  checkouts: 8,
  payments: 4,
  renewalsMade: 2,
  renewalsPaid: 1,
  lapses: 1,
  stops: 2,
  refunds: 1,
};

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    value: {
      days: days(),
      totals: TOTALS,
      rates: { conversion: 0.5, renewal: 0.5, refund: 0.25 },
      testPayments: 2,
      countsAvailable: true,
      ...overrides,
    },
  };
}

const THRESHOLDS = {
  checkoutSuccessMinPercent: 60,
  confirmationMaxMinutes: 20,
  stuckConfirmingMax: 1,
  needsCheckMax: 2,
};

function health(
  signals: readonly Record<string, unknown>[] = [
    { key: 'checkout_success', value: 45, threshold: 60, status: 'attention' },
    { key: 'confirmation_time', value: 1, threshold: 20, status: 'ok' },
    { key: 'stuck_confirming', value: 0, threshold: 1, status: 'ok' },
    { key: 'needs_check', value: 3, threshold: 2, status: 'attention' },
  ],
  available = true,
) {
  return {
    ok: true,
    value: {
      signals,
      thresholds: {
        ...THRESHOLDS,
        available,
        updatedAt: available ? new Date('2026-10-30T04:00:00Z') : null,
        // A careless page might print who changed them: it never may.
        updatedByAccountId: '9d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6',
        updatedByEmail: 'owner@example.com',
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  navigationState.pathname = '/app/admin/billing/travellers/metrics';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.travellerPlanMetrics.mockResolvedValue(metrics());
  mocks.travellerPlanHealth.mockResolvedValue(health());
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** The rows of the daily table, each as its cells' text. */
function tableRows(html: string, section: 'tbody' | 'tfoot'): string[][] {
  const body = html.split(`<${section}>`)[1]?.split(`</${section}>`)[0] ?? '';
  return body
    .split('</tr>')
    .filter((row) => row.includes('<t'))
    .map((row) =>
      [...row.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map((cell) => textOf(cell[1] ?? '')),
    );
}

describe('Platform > Traveller Plan Metrics', () => {
  it('is for the platform owner only, and reads nothing for anyone else', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('PLANS_MANAGE');
    expect(text).toContain('This area is restricted to platform administrators.');
    expect(mocks.travellerPlanMetrics).not.toHaveBeenCalled();
    expect(mocks.travellerPlanHealth).not.toHaveBeenCalled();
    expect(text).not.toContain('Alert Thresholds');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('<form');
    expect(await axeViolations(html)).toEqual([]);
  });

  it("reads 14 days and the health signals with the owner's scope", async () => {
    await renderServer(Page({}));
    expect(mocks.travellerPlanMetrics.mock.calls[0]?.[1]).toBe(SCOPE);
    expect(mocks.travellerPlanMetrics.mock.calls[0]?.[2]).toMatchObject({ days: 14, now: NOW });
    expect(mocks.travellerPlanHealth.mock.calls[0]?.[1]).toBe(SCOPE);
  });

  it('shows the last 14 days in a real table, newest first, with a totals row and a caption', async () => {
    const html = await renderServer(Page({}));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(textOf(html)).toContain('Traveller Plan Metrics');
    expect(html).toContain('<caption');
    expect(textOf(html)).toContain('Traveller Plans by Bangladesh Day, Newest First');
    const head = html.split('<thead>')[1]?.split('</thead>')[0] ?? '';
    expect(
      [...head.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => textOf(m[1] ?? '')),
    ).toEqual([
      'Day',
      'Plan & Usage Views',
      'Get Taps',
      'Checkouts',
      'Payments',
      'Renewals Made',
      'Renewals Paid',
      'Lapses',
      'Stops',
      'Refunds',
    ]);
    const rows = tableRows(html, 'tbody');
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual(['1 Nov 2026', '41', '9', '7', '3', '2', '1', '1', '2', '1']);
    expect(rows[3]).toEqual(['29 Oct 2026', '17', '4', '1', '1', '0', '0', '0', '0', '0']);
    expect(rows[13]?.[0]).toBe('19 Oct 2026');
    // Each day is the header of its row.
    expect(html.match(/<th scope="row"/g)).toHaveLength(14 + 1 + 4);
    expect(tableRows(html, 'tfoot')).toEqual([
      ['Total', '58', '13', '8', '4', '2', '1', '1', '2', '1'],
    ]);
    expect(await axeViolations(html)).toEqual([]);
  });

  it('gives the three rates as plain percentages with what each means, and counts test payments apart', async () => {
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Conversion: 50%');
    expect(text).toContain('Of the purchases started in these days, the share that was paid.');
    expect(text).toContain('Renewal: 50%');
    expect(text).toContain('Of the renewals made in these days, the share that was paid.');
    expect(text).toContain('Refund: 25%');
    expect(text).toContain('Of the payments made in these days, the share refunded since.');
    expect(text).toContain(
      'Test payments are counted apart and left out of Payments, Renewals Paid, Refunds and the rates: 2 payments in the last 14 days. Views, Get taps and the other counts include tests. While payments are in test mode only you can pay, so purchases travellers start then show as not paid.',
    );
    expect(text).not.toContain('Not enough data yet');
  });

  it('says there is not enough data yet for a rate with nothing to divide by', async () => {
    mocks.travellerPlanMetrics.mockResolvedValue(
      metrics({ rates: { conversion: 0.123, renewal: null, refund: null }, testPayments: 0 }),
    );
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Conversion: 12%');
    expect(text).toContain('Renewal: Not enough data yet');
    expect(text).toContain('Refund: Not enough data yet');
    expect(text).toContain('Refunds and the rates: none in the last 14 days.');
  });

  it('says once that views and taps are counted after the database is updated', async () => {
    const counted = textOf(await renderServer(Page({})));
    expect(counted).not.toContain('are counted once the database is updated');
    mocks.travellerPlanMetrics.mockResolvedValue(metrics({ countsAvailable: false }));
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(
      text.match(/Plan & Usage views and Get taps are counted once the database is updated\./g),
    ).toHaveLength(1);
    expect(html).toMatch(/<output class="notice notice-warn[^"]*">Plan &amp; Usage views/);
    // The rest of the page is still there.
    expect(tableRows(html, 'tfoot')).toHaveLength(1);
    expect(await axeViolations(html)).toEqual([]);
  });

  it('names each health signal plainly, with its value, its threshold and a status in words', async () => {
    const html = await renderServer(Page({}));
    const text = textOf(html);
    const section = html.split('id="health-title"')[1]?.split('id="thresholds-title"')[0] ?? '';
    const rows = tableRows(section, 'tbody');
    expect(rows.map((row) => [row[0], row[2], row[3], row[4]])).toEqual([
      ['Checkout Success', '45%', 'Below 60%', 'Needs Attention'],
      ['Time to Confirm', '1 minute', 'Over 20 minutes', 'OK'],
      ['Stuck Confirming', '0 payments', 'More than 1 payment', 'OK'],
      ['Needs a Check', '3 payments', 'More than 2 payments', 'Needs Attention'],
    ]);
    // A badge for each, never colour alone.
    expect(section.match(/class="badge badge-warning"/g)).toHaveLength(2);
    expect(section.match(/class="badge badge-success"/g)).toHaveLength(2);
    expect(text).toContain(
      'Payments still confirming with the payment gateway after 30 minutes, however long ago they started.',
    );

    mocks.travellerPlanHealth.mockResolvedValue(
      health([
        { key: 'checkout_success', value: null, threshold: 50, status: 'no_data' },
        { key: 'confirmation_time', value: null, threshold: 15, status: 'no_data' },
        { key: 'stuck_confirming', value: 0, threshold: 0, status: 'ok' },
        { key: 'needs_check', value: 0, threshold: 0, status: 'ok' },
      ]),
    );
    const empty = await renderServer(Page({}));
    const emptyRows = tableRows(
      empty.split('id="health-title"')[1]?.split('id="thresholds-title"')[0] ?? '',
      'tbody',
    );
    expect(emptyRows.map((row) => [row[0], row[2], row[4]])).toEqual([
      ['Checkout Success', 'Nothing to measure yet', 'No Data Yet'],
      ['Time to Confirm', 'Nothing to measure yet', 'No Data Yet'],
      ['Stuck Confirming', '0 payments', 'OK'],
      ['Needs a Check', '0 payments', 'OK'],
    ]);
    expect(await axeViolations(empty)).toEqual([]);
  });

  it('offers the four thresholds as whole numbers, saved with Save Thresholds', async () => {
    const html = await renderServer(Page({}));
    const form = html.split('id="thresholds-title"')[1] ?? '';
    for (const [name, value] of Object.entries(THRESHOLDS)) {
      const input = form.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
      expect(input, name).toContain('type="number"');
      expect(input, name).toContain(`value="${value}"`);
      expect(input, name).toContain('required=""');
    }
    expect(form.match(/step="1"/g)).toHaveLength(4);
    expect(textOf(form)).toContain('Save Thresholds');
    expect(form).not.toContain('disabled');
    expect(textOf(form)).not.toContain(TRAVELLER_HEALTH_UNAVAILABLE);
    expect(await axeViolations(html)).toEqual([]);
  });

  it('shows the thresholds typed before a sign-in check again, but only four whole numbers', async () => {
    const typed = { success: '70', minutes: '30', stuck: '3', check: '4' };
    const html = await renderServer(Page({ searchParams: Promise.resolve(typed) }));
    const form = html.split('id="thresholds-title"')[1] ?? '';
    const inputValue = (name: string) =>
      form.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`))?.[1];
    expect(inputValue('checkoutSuccessMinPercent')).toBe('70');
    expect(inputValue('confirmationMaxMinutes')).toBe('30');
    expect(inputValue('stuckConfirmingMax')).toBe('3');
    expect(inputValue('needsCheckMax')).toBe('4');
    expect(textOf(html)).toContain('They are not saved yet: press Save Thresholds to save them.');
    expect(await axeViolations(html)).toEqual([]);
    // Once saved, the same numbers in the address are simply the saved ones: no note.
    const same = await renderServer(
      Page({
        searchParams: Promise.resolve({ success: '60', minutes: '20', stuck: '1', check: '2' }),
      }),
    );
    expect(textOf(same)).not.toContain('not saved yet');
    // Anything odd in the address, or one missing, and the saved thresholds show instead.
    for (const odd of [
      { ...typed, stuck: '1.5' },
      { ...typed, check: '<b>' },
      { success: '70', minutes: '30', stuck: '3' },
      { ...typed, minutes: ['30', '31'] },
    ]) {
      const again = await renderServer(Page({ searchParams: Promise.resolve(odd) }));
      const saved = again.split('id="thresholds-title"')[1] ?? '';
      expect(
        saved.match(/<input[^>]*name="checkoutSuccessMinPercent"[^>]*value="([^"]*)"/)?.[1],
      ).toBe(String(THRESHOLDS.checkoutSuccessMinPercent));
    }
  });

  it('shows the thresholds but cannot save them before the database is updated, and says why', async () => {
    mocks.travellerPlanHealth.mockResolvedValue(health(undefined, false));
    const html = await renderServer(Page({}));
    const form = html.split('id="thresholds-title"')[1] ?? '';
    expect(textOf(form)).toContain(TRAVELLER_HEALTH_UNAVAILABLE);
    expect(form).toMatch(/<fieldset[^>]*disabled=""/);
    expect(form).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(textOf(form)).toContain('Save Thresholds');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('never shows an id or an email, in any state', async () => {
    const states = [
      () => undefined,
      () => mocks.travellerPlanMetrics.mockResolvedValue(metrics({ countsAvailable: false })),
      () => mocks.travellerPlanHealth.mockResolvedValue(health(undefined, false)),
      () => mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } }),
    ];
    for (const set of states) {
      set();
      const html = await renderServer(Page({}));
      expect(html).not.toMatch(UUID);
      expect(html).not.toContain('@');
    }
  });
});
