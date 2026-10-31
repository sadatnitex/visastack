import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { createInvoice } from './billing';
import {
  type InvoiceDocumentFacts,
  type PersonInvoiceDocumentFacts,
  billingDocumentFileName,
  buildInvoiceDocument,
  buildPersonInvoiceDocument,
  buildPersonReceiptDocument,
  buildReceiptDocument,
  getInvoiceDocument,
  getReceiptDocument,
  invoiceDocumentStamp,
  personInvoiceDocumentStamp,
} from './billing-documents';
import { setConsent } from './consent';
import type { Db } from './db';
import { applyInvoiceCollection } from './invoice-ledger';
import { createMission } from './missions';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';
import { acceptGrant, createGrant } from './sharing';

const NBSP = ' ';
const ORG_ID = '7d3f9a2c-1111-4222-8333-444455556666';

function facts(overrides: Partial<InvoiceDocumentFacts> = {}): InvoiceDocumentFacts {
  return {
    invoiceRef: 'INV-7D3F9A2C-20261101',
    status: 'OPEN',
    currency: 'BDT',
    invoicedAmountMinorUnits: 250000,
    collectedAmountMinorUnits: 0,
    issuedAt: new Date('2026-11-01T04:00:00Z'),
    dueDate: new Date('2026-11-08T00:00:00Z'),
    periodStart: new Date('2026-11-01T04:00:00Z'),
    periodEnd: new Date('2026-12-01T04:00:00Z'),
    planName: 'Agency Standard',
    organizationId: ORG_ID,
    organizationName: 'Dhaka Visa Desk',
    billingEmail: 'owner@dhakavisadesk.example',
    payments: [],
    ...overrides,
  };
}

const NOW = new Date('2026-10-30T08:05:00Z');

describe('the invoice document in words (S30)', () => {
  it('writes amounts with separators and the code, and dates as "8 Nov 2026"', () => {
    const doc = buildInvoiceDocument(facts(), NOW);
    expect(doc.title).toBe('Invoice');
    expect(doc.number).toBe('INV-7D3F9A2C-20261101');
    expect(doc.fileName).toBe('VisaStack-Invoice-INV-7D3F9A2C-20261101.pdf');
    expect(doc.stamp).toEqual({ label: 'Open', tone: 'open' });
    expect(doc.facts).toEqual([
      { label: 'Invoice Number', value: 'INV-7D3F9A2C-20261101' },
      { label: 'Issue Date', value: '1 Nov 2026' },
      { label: 'Due Date', value: '8 Nov 2026' },
      { label: 'Period', value: '1 Nov 2026 to 30 Nov 2026' },
    ]);
    expect(doc.billedTo).toEqual({
      name: 'Dhaka Visa Desk',
      lines: ['Agency Code 7D3F9A2C', 'owner@dhakavisadesk.example'],
    });
    expect(doc.items.rows).toEqual([
      ['Agency Standard', '1 Nov 2026 to 30 Nov 2026', `BDT${NBSP}2,500.00`],
    ]);
    expect(doc.totals).toEqual([
      { label: 'Invoiced', value: `BDT${NBSP}2,500.00` },
      { label: 'Paid So Far', value: `BDT${NBSP}0.00` },
      { label: 'Still Owed', value: `BDT${NBSP}2,500.00`, strong: true },
    ]);
    expect(doc.sections).toEqual([]);
    expect(doc.notes[0]).toBe(
      `Pay BDT${NBSP}2,500.00 by 8 Nov 2026 from Invoices in your VisaStack workspace, online or another way.`,
    );
    expect(doc.generatedAt).toBe('30 Oct 2026, 14:05');
  });

  it('lists payments with their receipts, a credit, and a refund, and owes nothing once refunded', () => {
    const doc = buildInvoiceDocument(
      facts({
        status: 'PARTIALLY_PAID',
        collectedAmountMinorUnits: 150000,
        payments: [
          {
            kind: 'MANUAL_CLAIM',
            amountMinorUnits: 100000,
            collectedDate: new Date('2026-11-03T00:00:00Z'),
            reference: 'BKASH-8H2K4Q',
            receiptNumber: 41,
          },
          {
            kind: 'CREDIT',
            amountMinorUnits: 75000,
            collectedDate: new Date('2026-11-04T00:00:00Z'),
            reference: 'credit from INV-OLD',
            receiptNumber: 42,
          },
          {
            kind: 'REFUND',
            amountMinorUnits: -25000,
            collectedDate: new Date('2026-11-05T00:00:00Z'),
            reference: 'RF-2026-7',
            receiptNumber: null,
          },
        ],
      }),
      NOW,
    );
    expect(doc.stamp).toEqual({ label: 'Partly Refunded', tone: 'refunded' });
    expect(doc.totals).toEqual([
      { label: 'Invoiced', value: `BDT${NBSP}2,500.00` },
      { label: 'Kept After Refunds', value: `BDT${NBSP}1,500.00` },
      { label: 'Refunded', value: `BDT${NBSP}250.00` },
      { label: 'Still Owed', value: `BDT${NBSP}0.00`, strong: true },
    ]);
    // A refunded invoice has no due date (S18, D2).
    expect(doc.facts.map((f) => f.label)).not.toContain('Due Date');
    expect(doc.sections).toEqual([
      {
        heading: 'Payments Received',
        columns: ['Date', 'How It Was Paid', 'Payment Reference', 'Receipt', 'Amount'],
        rows: [
          [
            '3 Nov 2026',
            'Reported Payment, Confirmed',
            'BKASH-8H2K4Q',
            'R-000041',
            `BDT${NBSP}1,000.00`,
          ],
          ['4 Nov 2026', 'Credit', 'credit from INV-OLD', 'R-000042', `BDT${NBSP}750.00`],
        ],
      },
      {
        heading: 'Refunds',
        columns: ['Date', 'Refund Reference', 'Amount'],
        rows: [['5 Nov 2026', 'RF-2026-7', `BDT${NBSP}250.00`]],
      },
    ]);
    expect(doc.notes).toEqual([
      'Part of the money paid on this invoice was refunded. There is nothing more to pay on it.',
      'A credit is money from an earlier payment that was counted towards this invoice.',
    ]);
  });

  it('stamps every state, with Overdue from the Bangladesh day after the due date', () => {
    const stamp = (overrides: Partial<InvoiceDocumentFacts>, now = NOW) =>
      invoiceDocumentStamp(facts(overrides), now).label;
    expect(stamp({ status: 'PAID', collectedAmountMinorUnits: 250000 })).toBe('Paid');
    expect(stamp({ status: 'PARTIALLY_PAID', collectedAmountMinorUnits: 1 })).toBe('Partly Paid');
    expect(stamp({ status: 'VOID' })).toBe('Cancelled');
    const due = new Date('2026-10-30T00:00:00Z');
    expect(stamp({ dueDate: due }, new Date('2026-10-30T17:59:00Z'))).toBe('Open');
    // 18:00 UTC is midnight in Dhaka: the next Bangladesh day.
    expect(stamp({ dueDate: due }, new Date('2026-10-30T18:00:00Z'))).toBe('Overdue');
    expect(
      stamp(
        {
          payments: [
            {
              kind: 'REFUND',
              amountMinorUnits: -1,
              collectedDate: due,
              reference: 'r',
              receiptNumber: null,
            },
          ],
        },
        new Date('2027-01-01T00:00:00Z'),
      ),
    ).toBe('Refunded');
  });

  it('says when an overdue invoice was due', () => {
    const doc = buildInvoiceDocument(facts({ dueDate: new Date('2026-10-22T00:00:00Z') }), NOW);
    expect(doc.stamp).toEqual({ label: 'Overdue', tone: 'overdue' });
    expect(doc.notes[0]).toBe(
      `This invoice was due on 22 Oct 2026. Pay BDT${NBSP}2,500.00 from Invoices in your VisaStack workspace, online or another way.`,
    );
  });

  it('never breaks on a bad currency code', () => {
    const doc = buildInvoiceDocument(facts({ currency: 'XYZ' }), NOW);
    expect(doc.totals[0]?.value).toBe(`2,500.00${NBSP}XYZ`);
  });

  it('makes the receipt document from its payment', () => {
    const doc = buildReceiptDocument(
      {
        receiptNumber: 41,
        kind: 'ONLINE',
        amountMinorUnits: 250000,
        currency: 'BDT',
        collectedDate: new Date('2026-11-03T00:00:00Z'),
        issuedAt: new Date('2026-11-03T05:30:00Z'),
        reference: 'VAL-123',
        invoiceRef: 'INV-7D3F9A2C-20261101',
        invoicedAmountMinorUnits: 250000,
        periodStart: new Date('2026-11-01T04:00:00Z'),
        periodEnd: new Date('2026-12-01T04:00:00Z'),
        planName: 'Agency Standard',
        organizationId: ORG_ID,
        organizationName: 'Dhaka Visa Desk',
        billingEmail: null,
      },
      NOW,
    );
    expect(doc.number).toBe('R-000041');
    expect(doc.fileName).toBe('VisaStack-Receipt-R-000041.pdf');
    expect(doc.stamp).toEqual({ label: 'Paid', tone: 'paid' });
    expect(doc.billedTo.lines).toEqual(['Agency Code 7D3F9A2C']);
    expect(doc.items.rows).toEqual([['Paid Online', 'VAL-123', `BDT${NBSP}2,500.00`]]);
    expect(doc.totals.at(-1)).toEqual({
      label: 'Amount Received',
      value: `BDT${NBSP}2,500.00`,
      strong: true,
    });
  });
});

describe("a person's own documents in words (ADR 0025 T5)", () => {
  const payer = { referenceCode: 'A1B2C3D4', email: 'rahim@example.test' };
  const personFacts = (
    overrides: Partial<PersonInvoiceDocumentFacts> = {},
  ): PersonInvoiceDocumentFacts => ({
    invoiceRef: 'TP-A1B2C3D4-1',
    status: 'PAID',
    currency: 'BDT',
    invoicedAmountMinorUnits: 49900,
    collectedAmountMinorUnits: 49900,
    issuedAt: new Date('2026-11-01T04:00:00Z'),
    periodStart: new Date('2026-11-01T04:00:00Z'),
    periodEnd: new Date('2026-12-01T04:00:00Z'),
    planName: 'Traveller Plus',
    paidAt: new Date('2026-11-01T04:10:00Z'),
    stillPayable: false,
    payer,
    payments: [
      {
        kind: 'ONLINE',
        amountMinorUnits: 49900,
        collectedDate: new Date('2026-11-01T04:10:00Z'),
        reference: 'VAL-9',
        receiptNumber: 1,
      },
    ],
    ...overrides,
  });

  it('bills the person by reference code and address, never as an agency, with nothing owed', () => {
    const doc = buildPersonInvoiceDocument(personFacts(), NOW);
    expect(doc.billedTo).toEqual({
      name: 'rahim@example.test',
      lines: ['Reference Code A1B2C3D4'],
    });
    expect(doc.stamp).toEqual({ label: 'Paid', tone: 'paid' });
    expect(doc.facts.map((f) => f.label)).toEqual([
      'Invoice Number',
      'Issue Date',
      'Paid On',
      'Period',
    ]);
    expect(doc.totals).toEqual([
      { label: 'Plan Price', value: `BDT${NBSP}499.00` },
      { label: 'Paid', value: `BDT${NBSP}499.00`, strong: true },
    ]);
    expect(JSON.stringify(doc)).not.toMatch(/Agency|Still Owed|Due Date|Overdue|workspace/);
    // A period starting mid-day ends on the day of its last covered moment, as Plan & Usage says.
    expect(doc.facts.find((f) => f.label === 'Period')?.value).toBe('1 Nov 2026 to 1 Dec 2026');
  });

  it('never stamps an unpaid person invoice Overdue, however old', () => {
    const doc = buildPersonInvoiceDocument(
      personFacts({
        status: 'OPEN',
        collectedAmountMinorUnits: 0,
        paidAt: null,
        payments: [],
        stillPayable: true,
      }),
      new Date('2027-06-01T00:00:00Z'),
    );
    expect(doc.stamp).toEqual({ label: 'Waiting for Payment', tone: 'open' });
    expect(doc.notes[0]).toContain('you owe nothing');
    // Past the time it could be paid in, it says so: the page and the PDF use the same word.
    const lapsed = buildPersonInvoiceDocument(
      personFacts({ status: 'OPEN', collectedAmountMinorUnits: 0, paidAt: null, payments: [] }),
      NOW,
    );
    expect(lapsed.stamp).toEqual({ label: 'Not Paid', tone: 'cancelled' });
    expect(lapsed.notes[0]).toBe(
      'This invoice was not paid in time, so nothing was charged and you owe nothing.',
    );
    expect(
      personInvoiceDocumentStamp({
        status: 'VOID',
        collectedAmountMinorUnits: 0,
        refunded: false,
        stillPayable: true,
      }),
    ).toEqual({ label: 'Cancelled', tone: 'cancelled' });
  });

  it('shows a refund and what was kept', () => {
    // A full refund leaves the invoice open with nothing collected (invoiceStatusForTotals).
    const doc = buildPersonInvoiceDocument(
      personFacts({
        status: 'OPEN',
        collectedAmountMinorUnits: 0,
        payments: [
          ...personFacts().payments,
          {
            kind: 'REFUND',
            amountMinorUnits: -49900,
            collectedDate: new Date('2026-11-03T00:00:00Z'),
            reference: 'RF-1',
            receiptNumber: null,
          },
        ],
      }),
      NOW,
    );
    expect(doc.stamp).toEqual({ label: 'Refunded', tone: 'refunded' });
    expect(doc.totals.map((t) => t.label)).toEqual([
      'Plan Price',
      'Refunded',
      'Kept After Refunds',
    ]);
    expect(doc.facts.map((f) => f.label)).toContain('Paid On');
  });

  it("makes a person's receipt exactly like an agency's apart from who paid", () => {
    const core = {
      receiptNumber: 1,
      kind: 'ONLINE' as const,
      amountMinorUnits: 49900,
      currency: 'BDT',
      collectedDate: new Date('2026-11-01T04:10:00Z'),
      issuedAt: new Date('2026-11-01T04:10:00Z'),
      reference: 'VAL-9',
      invoiceRef: 'TP-A1B2C3D4-1',
      invoicedAmountMinorUnits: 49900,
      periodStart: new Date('2026-11-01T04:00:00Z'),
      periodEnd: new Date('2026-12-01T04:00:00Z'),
      planName: 'Traveller Plus',
    };
    const person = buildPersonReceiptDocument({ ...core, payer }, NOW);
    const agency = buildReceiptDocument(
      { ...core, organizationId: ORG_ID, organizationName: 'Dhaka Visa Desk', billingEmail: null },
      NOW,
    );
    expect(person.billedTo).toEqual({
      name: 'rahim@example.test',
      lines: ['Reference Code A1B2C3D4'],
    });
    // The same receipt apart from who paid, and the period: a person's starts at the moment they
    // bought, so its last day is the day of its last covered moment.
    const period = (doc: typeof person) => doc.sections[0]?.rows[0]?.[2];
    expect(period(person)).toBe('1 Nov 2026 to 1 Dec 2026');
    expect(period(agency)).toBe('1 Nov 2026 to 30 Nov 2026');
    const without = (doc: typeof person) => ({
      ...doc,
      billedTo: null,
      sections: doc.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) => row.slice(0, 2)),
      })),
    });
    expect(without(person)).toEqual(without(agency));
    // After the account is gone, the receipt says so instead of naming anyone.
    expect(
      buildPersonReceiptDocument({ ...core, payer: { ...payer, email: null } }, NOW).billedTo.name,
    ).toBe('Deleted Account');
  });
});

describe('download names (S30)', () => {
  it('keeps letters, digits and hyphens only', () => {
    expect(billingDocumentFileName('invoice', 'INV-2026-014')).toBe(
      'VisaStack-Invoice-INV-2026-014.pdf',
    );
    expect(billingDocumentFileName('invoice', '../../etc/passwd"\r\nX: y')).toBe(
      'VisaStack-Invoice-etc-passwd-X-y.pdf',
    );
    expect(billingDocumentFileName('receipt', 'Résumé  #7')).toBe('VisaStack-Receipt-Resume-7.pdf');
    expect(billingDocumentFileName('invoice', '"";')).toBe('VisaStack-Invoice-Document.pdf');
    expect(billingDocumentFileName('invoice', 'A'.repeat(300))).toBe(
      `VisaStack-Invoice-${'A'.repeat(80)}.pdf`,
    );
  });
});

// --- Who can read a document --------------------------------------------------------------

const TRAVELLER_NAME = 'Nusrat Jahan Chowdhury';
const PASSPORT = 'EB0731946';

async function account(db: Db, email: string): Promise<{ id: string; email: string }> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return { id: made.value.id, email: made.value.email };
}

async function agency(db: Db, tag: string) {
  const owner = await account(db, `owner-${tag}@agency.example`);
  const org = await createOrganization(db, { actorAccountId: owner.id, name: `Agency ${tag}` });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await account(db, `reviewer-${tag}@platform.example`);
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  const admin = await account(db, `admin-${tag}@agency.example`);
  const member = await account(db, `member-${tag}@agency.example`);
  for (const [person, role] of [
    [admin, 'ADMIN'],
    [member, 'CASE_MANAGER'],
  ] as const) {
    const added = await addMembership(db, {
      actorAccountId: owner.id,
      organizationId: org.value.id,
      accountId: person.id,
      role,
    });
    if (!isOk(added)) throw new Error('member');
  }
  return { organizationId: org.value.id, owner, admin, member };
}

describe('reading billing documents (S30)', () => {
  let db: Db;
  let platform: { id: string; email: string };
  let stranger: { id: string; email: string };
  let mine: Awaited<ReturnType<typeof agency>>;
  let theirs: Awaited<ReturnType<typeof agency>>;
  let invoiceId: string;
  let receiptId: string;
  let otherInvoiceId: string;

  beforeAll(async () => {
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    platform = await account(db, 'owner@platform.example');
    const granted = await grantPlatformRole(db, {
      actor: { accountId: platform.id, email: platform.email, bootstrapEmails: [platform.email] },
      targetAccountId: platform.id,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    stranger = await account(db, 'stranger@example.com');
    mine = await agency(db, 'mine');
    theirs = await agency(db, 'theirs');

    // A traveller who works with the agency, with a case whose title carries a passport number.
    const traveller = await account(db, 'nusrat@example.com');
    await setConsent(db, {
      actorAccountId: traveller.id,
      accountId: traveller.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: traveller.id,
      ownerAccountId: traveller.id,
      displayName: TRAVELLER_NAME,
    });
    if (!isOk(applicant)) throw new Error('applicant');
    await setConsent(db, {
      actorAccountId: traveller.id,
      accountId: traveller.id,
      type: 'SHARING',
      granted: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: traveller.id,
      applicantId: applicant.value.id,
      recipientOrganizationId: mine.organizationId,
      actions: ['VIEW_METADATA'],
      purpose: 'billing document test',
    });
    if (!isOk(grant)) throw new Error('grant');
    const accepted = await acceptGrant(db, {
      actorAccountId: mine.owner.id,
      grantId: grant.value.id,
    });
    if (!isOk(accepted)) throw new Error('accept');
    const mission = await createMission(db, {
      actorAccountId: traveller.id,
      applicantId: applicant.value.id,
      title: `Passport ${PASSPORT} renewal`,
    });
    if (!isOk(mission)) throw new Error('mission');

    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('plan');
    const issue = async (organizationId: string, ref: string) => {
      const start = new Date('2026-11-01T04:00:00Z');
      const made = await createInvoice(db, {
        actor: { accountId: platform.id, email: platform.email, bootstrapEmails: [] },
        stepUpSatisfied: true,
        organizationId,
        planId: plan.id,
        periodStart: start,
        periodEnd: new Date('2026-12-01T04:00:00Z'),
        invoiceRef: ref,
        invoicedAmountMinorUnits: 250000,
        currency: 'BDT',
        dueDate: new Date('2026-11-08T00:00:00Z'),
      });
      if (!isOk(made)) throw new Error('invoice');
      return made.value.id;
    };
    invoiceId = await issue(mine.organizationId, 'INV-MINE-1');
    otherInvoiceId = await issue(theirs.organizationId, 'INV-THEIRS-1');
    const paid = await db.transaction((tx) =>
      applyInvoiceCollection(tx, {
        invoiceId,
        amountMinorUnits: 100000,
        currency: 'BDT',
        kind: 'MANUAL_CLAIM',
        sourceId: randomUUID(),
        reference: 'BKASH-8H2K4Q',
        collectedDate: new Date('2026-11-03T00:00:00Z'),
        recordedByAccountId: platform.id,
      }),
    );
    if (!isOk(paid)) throw new Error('collect');
    const receipt = (
      await db
        .select({ id: schema.paymentReceipts.id })
        .from(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.invoiceId, invoiceId))
    )[0];
    if (!receipt) throw new Error('receipt');
    receiptId = receipt.id;
  });

  const asPerson = (person: { id: string }, organizationId = mine.organizationId) => ({
    actorAccountId: person.id,
    organizationId,
    now: NOW,
  });

  it('gives the owner and an admin the invoice and the receipt', async () => {
    for (const person of [mine.owner, mine.admin]) {
      const invoice = await getInvoiceDocument(db, { ...asPerson(person), invoiceId });
      expect(isOk(invoice) && invoice.value.number).toBe('INV-MINE-1');
      const receipt = await getReceiptDocument(db, { ...asPerson(person), receiptId });
      expect(isOk(receipt) && receipt.value.number).toBe('R-000001');
    }
  });

  it('gives a platform owner the invoice through the platform standing', async () => {
    const invoice = await getInvoiceDocument(db, {
      ...asPerson(platform),
      actorEmail: platform.email,
      bootstrapEmails: [],
      invoiceId,
    });
    expect(isOk(invoice)).toBe(true);
  });

  it('refuses a member, a stranger, another agency and an unknown id alike, as not found', async () => {
    const refused = [
      await getInvoiceDocument(db, { ...asPerson(mine.member), invoiceId }),
      await getInvoiceDocument(db, { ...asPerson(stranger), invoiceId }),
      // Another agency's owner, asking about this agency.
      await getInvoiceDocument(db, { ...asPerson(theirs.owner), invoiceId }),
      // This agency's owner, asking for another agency's invoice under this agency.
      await getInvoiceDocument(db, { ...asPerson(mine.owner), invoiceId: otherInvoiceId }),
      // Another agency's owner, naming their own agency but this agency's invoice.
      await getInvoiceDocument(db, {
        ...asPerson(theirs.owner, theirs.organizationId),
        invoiceId,
      }),
      await getInvoiceDocument(db, { ...asPerson(mine.owner), invoiceId: randomUUID() }),
      await getInvoiceDocument(db, { ...asPerson(mine.owner), invoiceId: 'not-an-id' }),
      // A platform owner without the platform standing passed is just a stranger.
      await getInvoiceDocument(db, { ...asPerson(platform), invoiceId }),
      await getReceiptDocument(db, { ...asPerson(mine.member), receiptId }),
      await getReceiptDocument(db, { ...asPerson(stranger), receiptId }),
      await getReceiptDocument(db, {
        ...asPerson(theirs.owner, theirs.organizationId),
        receiptId,
      }),
    ];
    for (const result of refused) {
      expect(isErr(result) && result.error).toEqual({
        code: 'not_found',
        message: 'document not found',
      });
    }
  });

  it('holds no traveller, case or document data', async () => {
    const invoice = await getInvoiceDocument(db, { ...asPerson(mine.owner), invoiceId });
    const receipt = await getReceiptDocument(db, { ...asPerson(mine.owner), receiptId });
    if (!isOk(invoice) || !isOk(receipt)) throw new Error('documents');
    for (const doc of [invoice.value, receipt.value]) {
      const text = JSON.stringify(doc);
      expect(text).not.toContain(TRAVELLER_NAME);
      expect(text).not.toContain('Nusrat');
      expect(text).not.toContain(PASSPORT);
      expect(text).not.toContain('nusrat@example.com');
      // No staff account and no member of the agency other than the billing address.
      expect(text).not.toContain(mine.admin.email);
      expect(text).not.toContain(mine.member.email);
      expect(text).not.toContain(platform.email);
      expect(doc.billedTo.lines).toEqual([
        `Agency Code ${mine.organizationId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        mine.owner.email,
      ]);
    }
    expect(invoice.value.sections[0]?.rows).toEqual([
      [
        '3 Nov 2026',
        'Reported Payment, Confirmed',
        'BKASH-8H2K4Q',
        'R-000001',
        `BDT${NBSP}1,000.00`,
      ],
    ]);
  });
});
