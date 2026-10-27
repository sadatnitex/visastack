import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@visastack/db';
import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_STATUS_LABELS,
  CLAIM_METHOD_LABELS,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_TONES,
  INVOICE_STATE_HINTS,
  INVOICE_STATE_LABELS,
  INVOICE_STATE_TONES,
  receiptKindLabel,
} from './invoice-labels';
import { paymentUrlFor } from './payment-urls';

/**
 * Guards for the agency Invoices screens (S12): the words cover every state the service can
 * produce, the stylesheet block defines every class the screens use, and the screens carry no
 * inline styles.
 */

const SRC = join(process.cwd(), 'src');
const FILES = [
  'app/app/agency/[orgId]/plan/invoices/page.tsx',
  'app/app/agency/[orgId]/plan/invoices/invoice-forms.tsx',
  'app/app/agency/[orgId]/plan/invoices/receipts/[receiptId]/page.tsx',
];

const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8');
function block(): string {
  const start = css.indexOf('/* WP-S12 ');
  if (start < 0) throw new Error('stylesheet block "WP-S12" is missing');
  const next = css.indexOf('\n/* WP-', start + 1);
  return css.slice(start, next < 0 ? undefined : next);
}

describe('the words of the Invoices page', () => {
  it('name every state, claim method, claim status and attempt status the database can hold', () => {
    const states = ['OPEN', 'PAYMENT_STARTED', 'PAYMENT_REPORTED', 'PAID', 'NEEDS_CHECK', 'VOID'];
    for (const table of [INVOICE_STATE_LABELS, INVOICE_STATE_HINTS, INVOICE_STATE_TONES]) {
      expect(Object.keys(table).sort()).toEqual([...states].sort());
    }
    expect(Object.keys(CLAIM_METHOD_LABELS).sort()).toEqual(
      [...schema.manualClaimMethod.enumValues].sort(),
    );
    expect(Object.keys(CLAIM_STATUS_LABELS).sort()).toEqual(
      [...schema.manualClaimStatus.enumValues].sort(),
    );
    expect(Object.keys(CLAIM_STATUS_TONES).sort()).toEqual(
      [...schema.manualClaimStatus.enumValues].sort(),
    );
    expect(Object.keys(ATTEMPT_STATUS_LABELS).sort()).toEqual(
      [...schema.paymentAttemptStatus.enumValues].sort(),
    );
  });

  it('uses the five plain states the owner named', () => {
    expect(INVOICE_STATE_LABELS.OPEN).toBe('Open');
    expect(INVOICE_STATE_LABELS.PAYMENT_STARTED).toBe('Payment Started');
    expect(INVOICE_STATE_LABELS.PAYMENT_REPORTED).toBe('Payment Reported');
    expect(INVOICE_STATE_HINTS.PAYMENT_REPORTED).toMatch(/Waiting for confirmation/);
    expect(INVOICE_STATE_LABELS.PAID).toBe('Paid');
    expect(INVOICE_STATE_LABELS.NEEDS_CHECK).toBe('Payment Needs a Check');
  });

  it('never shows gateway wording, codes or engineering terms', () => {
    const everything = [
      ...Object.values(INVOICE_STATE_LABELS),
      ...Object.values(INVOICE_STATE_HINTS),
      ...Object.values(CLAIM_STATUS_LABELS),
      ...Object.values(ATTEMPT_STATUS_LABELS),
    ].join(' ');
    expect(everything).not.toMatch(
      /IPN|HELD_FOR_REVIEW|validation|webhook|SSLCOMMERZ|ledger|mission/i,
    );
  });

  it('names how a receipt was paid, with a safe fallback', () => {
    expect(receiptKindLabel('ONLINE')).toBe('Paid Online');
    expect(receiptKindLabel('SOMETHING_NEW')).toBe('Payment');
  });
});

describe('the addresses given to the payment gateway', () => {
  const urlFor = paymentUrlFor('https://vs.example.test/');
  it('stay on this site and carry only the transaction id', () => {
    expect(urlFor('ipn', 'VSP1')).toBe('https://vs.example.test/api/payments/sslcommerz/ipn');
    expect(urlFor('success', 'VSP1')).toBe(
      'https://vs.example.test/api/payments/sslcommerz/return?o=success&t=VSP1',
    );
    expect(urlFor('fail', 'VSP&x=1')).toBe(
      'https://vs.example.test/api/payments/sslcommerz/return?o=fail&t=VSP%26x%3D1',
    );
  });
});

describe('the Invoices stylesheet block', () => {
  it('defines every invoice-* and receipt-* class the screens use', () => {
    const used = new Set<string>();
    for (const file of FILES) {
      const source = readFileSync(join(SRC, file), 'utf8');
      for (const match of source.matchAll(/(?<![/\w.-])(?:invoice|receipt)-[a-z-]+\b/g)) {
        if (!/^(invoice|receipt)-[a-z-]*[a-z]$/.test(match[0])) continue;
        used.add(match[0]);
      }
    }
    // The admin screen shares the list and action classes.
    for (const file of ['app/app/admin/organizations/[orgId]/page.tsx']) {
      const source = readFileSync(join(SRC, file), 'utf8');
      for (const match of source.matchAll(/(?<![/\w.-])invoice-[a-z-]+\b/g)) used.add(match[0]);
    }
    const defined = new Set(
      [...block().matchAll(/\.((?:invoice|receipt)-[a-z-]+)\b/g)].map((m) => m[1]),
    );
    // Ids built from a record id (invoice-<id>) and test ids are not classes.
    const missing = [...used].filter((name) => !defined.has(name) && !name.endsWith('-'));
    expect(missing).toEqual([]);
    expect(defined.size).toBeGreaterThan(15);
  });

  it('is the only place these classes are written, and keeps the design flat', () => {
    const outside = css.replace(block(), '');
    expect(outside).not.toMatch(/\.invoice-(card|stack|facts|claim|list|action)\b/);
    expect(block()).not.toMatch(/box-shadow|gradient|backdrop-filter|rgba\(/);
  });

  it('keeps every control at a 44px target', () => {
    expect(block()).toMatch(/\.invoice-claim-summary[^}]*min-height: 44px/);
    expect(block()).toMatch(/\.invoice-link[^}]*min-height: 44px/);
  });

  it('keeps the screens free of inline styles', () => {
    for (const file of FILES) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toContain('style={{');
    }
  });
});
