import { randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type BlobStore,
  type Db,
  type InvoiceDocumentFacts,
  acceptGrant,
  addMembership,
  applyInvoiceCollection,
  buildInvoiceDocument,
  buildReceiptDocument,
  createApplicant,
  createGrant,
  createInvoice,
  createMission,
  createOrganization,
  getInvoiceDocument,
  getPlanByKey,
  getReceiptDocument,
  grantPlatformRole,
  provisionAccount,
  reviewOrganization,
  setConsent,
} from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { renderBillingDocumentPdf } from './billing-document-pdf';
import { DeterministicTextExtractor } from './text-extraction';

const NOW = new Date('2026-10-30T08:05:00Z');

/** Reads a PDF back with the product's own text extraction (unpdf), as one line of words. */
async function readBack(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const store: BlobStore = {
    async putObject() {},
    async getObject() {
      return { contentType: 'application/pdf', bytes };
    },
    async deleteObject() {},
    async listObjectKeys() {
      return { objectKeys: [], cursor: undefined };
    },
  };
  const outcome = await new DeterministicTextExtractor({ blobStore: store }).extract({
    bucket: 'CLEAN',
    objectKey: 'document',
    originalName: 'document.pdf',
  });
  if (!outcome.ok) throw new Error(outcome.message);
  return {
    text: outcome.result.text.replace(/\s+/g, ' ').trim(),
    pages: outcome.result.pageCount ?? 0,
  };
}

function facts(overrides: Partial<InvoiceDocumentFacts> = {}): InvoiceDocumentFacts {
  return {
    invoiceRef: 'INV-7D3F9A2C-20260901',
    status: 'PARTIALLY_PAID',
    currency: 'BDT',
    invoicedAmountMinorUnits: 250000,
    collectedAmountMinorUnits: 100000,
    issuedAt: new Date('2026-09-01T04:00:00Z'),
    dueDate: new Date('2026-10-22T00:00:00Z'),
    periodStart: new Date('2026-09-01T04:00:00Z'),
    periodEnd: new Date('2026-10-01T04:00:00Z'),
    planName: 'Agency Standard',
    organizationId: '7d3f9a2c-1111-4222-8333-444455556666',
    organizationName: 'Dhaka Visa Desk',
    billingEmail: 'owner@dhakavisadesk.example',
    payments: [
      {
        kind: 'MANUAL_CLAIM',
        amountMinorUnits: 100000,
        collectedDate: new Date('2026-10-12T00:00:00Z'),
        reference: 'BKASH-8H2K4Q',
        receiptNumber: 41,
      },
    ],
    ...overrides,
  };
}

describe('the billing document PDF (S30)', () => {
  it('reads back, word for word, as the invoice it was made from', async () => {
    const bytes = await renderBillingDocumentPdf(
      buildInvoiceDocument(facts(), NOW),
      { website: 'vs.obsidianglobal.studio' },
      NOW,
    );
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const { text, pages } = await readBack(bytes);
    expect(pages).toBe(1);
    expect(text).toBe(
      [
        'VisaStack vs.obsidianglobal.studio Invoice INV-7D3F9A2C-20260901',
        'Billed To Dhaka Visa Desk Agency Code 7D3F9A2C owner@dhakavisadesk.example',
        'Invoice Number INV-7D3F9A2C-20260901 Issue Date 1 Sep 2026 Due Date 22 Oct 2026',
        'Period 1 Sep 2026 to 1 Oct 2026 Status Overdue',
        'Plan Description Period Amount Agency Standard 1 Sep 2026 to 1 Oct 2026 BDT 2,500.00',
        'Invoiced BDT 2,500.00 Paid So Far BDT 1,000.00 Still Owed BDT 1,500.00',
        'Payments Received Date How It Was Paid Payment Reference Receipt Amount',
        '12 Oct 2026 Reported Payment, Confirmed BKASH-8H2K4Q R-000041 BDT 1,000.00',
        'This invoice was due on 22 Oct 2026. Pay BDT 1,500.00 from Invoices in your VisaStack workspace, online or another way.',
        'Questions about this invoice? Reply to any VisaStack billing email.',
        'VisaStack · vs.obsidianglobal.studio · Made on 30 Oct 2026, 14:05 (Bangladesh time) Page 1 of 1',
      ].join(' '),
    );
  });

  it('names a watched support address in the footer when there is one', async () => {
    const receipt = buildReceiptDocument(
      {
        receiptNumber: 41,
        kind: 'ONLINE',
        amountMinorUnits: 250000,
        currency: 'BDT',
        collectedDate: new Date('2026-10-12T00:00:00Z'),
        issuedAt: new Date('2026-10-13T05:30:00Z'),
        reference: 'VAL-9',
        invoiceRef: 'INV-7D3F9A2C-20260901',
        invoicedAmountMinorUnits: 250000,
        periodStart: new Date('2026-09-01T04:00:00Z'),
        periodEnd: new Date('2026-10-01T04:00:00Z'),
        planName: 'Agency Standard',
        organizationId: '7d3f9a2c-1111-4222-8333-444455556666',
        organizationName: 'Dhaka Visa Desk',
        billingEmail: null,
      },
      NOW,
    );
    const { text } = await readBack(
      await renderBillingDocumentPdf(receipt, { supportEmail: 'help@visastack.example' }, NOW),
    );
    expect(text).toContain('Receipt R-000041');
    expect(text).toContain('Status Paid');
    expect(text).toContain('Paid Online VAL-9 BDT 2,500.00');
    expect(text).toContain('Amount Received BDT 2,500.00');
    expect(text).toContain('Questions about this receipt? Write to help@visastack.example.');
    expect(text).toContain('It is not a tax document.');
  });

  it('carries VisaStack metadata only, and no library or machine name', async () => {
    const bytes = await renderBillingDocumentPdf(buildInvoiceDocument(facts(), NOW), {}, NOW);
    const raw = Buffer.from(bytes).toString('latin1');
    // Text strings in the document information are written as UTF-16 hex.
    const hex = (text: string) =>
      `<FEFF${[...text].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}>`;
    expect(raw).toContain(`/Producer ${hex('VisaStack')}`);
    expect(raw).toContain(`/Creator ${hex('VisaStack')}`);
    expect(raw).toContain(`/Title ${hex('Invoice INV-7D3F9A2C-20260901')}`);
    const info = raw.slice(raw.indexOf('/Title'), raw.indexOf('>>', raw.indexOf('/Title')));
    expect(info.match(/\/[A-Za-z]+ /g)).toEqual([
      '/Title ',
      '/Author ',
      '/Creator ',
      '/Producer ',
      '/CreationDate ',
      '/ModDate ',
    ]);
    expect(raw).not.toMatch(/pdf-lib|github\.com/i);
    expect(raw).not.toMatch(/\/JavaScript|\/OpenAction|\/Launch|\/EmbeddedFile/);
  });

  it('flows a long list onto further pages, each with the footer', async () => {
    const payments = Array.from({ length: 40 }, (_, n) => ({
      kind: 'ADMIN_RECORDED' as const,
      amountMinorUnits: 100,
      collectedDate: new Date('2026-10-12T00:00:00Z'),
      reference: `WIRE-${n + 1}`,
      receiptNumber: n + 1,
    }));
    const { text, pages } = await readBack(
      await renderBillingDocumentPdf(buildInvoiceDocument(facts({ payments }), NOW), {}, NOW),
    );
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text).toContain('WIRE-40');
  });

  it('draws text the font cannot show as "?", never failing the document', async () => {
    const { text } = await readBack(
      await renderBillingDocumentPdf(
        buildInvoiceDocument(facts({ organizationName: 'ঢাকা Visa Desk' }), NOW),
        {},
        NOW,
      ),
    );
    expect(text).toContain('???? Visa Desk');
  });
});

describe('a downloaded document never carries traveller data (S30)', () => {
  it('holds only billing facts, read back from the real PDF', async () => {
    const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const make = async (email: string) => {
      const made = await provisionAccount(db, { email });
      if (!isOk(made)) throw new Error('provision');
      return made.value;
    };
    const platform = await make('owner@platform.example');
    const granted = await grantPlatformRole(db, {
      actor: { accountId: platform.id, email: platform.email, bootstrapEmails: [platform.email] },
      targetAccountId: platform.id,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    const owner = await make('owner@agency.example');
    const org = await createOrganization(db, { actorAccountId: owner.id, name: 'Dhaka Visa Desk' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await make('reviewer@platform.example');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    const staff = await make('case.manager@agency.example');
    const added = await addMembership(db, {
      actorAccountId: owner.id,
      organizationId: org.value.id,
      accountId: staff.id,
      role: 'CASE_MANAGER',
    });
    if (!isOk(added)) throw new Error('member');

    const traveller = await make('nusrat.jahan@example.com');
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, {
        actorAccountId: traveller.id,
        accountId: traveller.id,
        type,
        granted: true,
      });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: traveller.id,
      ownerAccountId: traveller.id,
      displayName: 'Nusrat Jahan Chowdhury',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    const grant = await createGrant(db, {
      actorAccountId: traveller.id,
      applicantId: applicant.value.id,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'billing document test',
    });
    if (!isOk(grant)) throw new Error('grant');
    const accepted = await acceptGrant(db, { actorAccountId: owner.id, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    const mission = await createMission(db, {
      actorAccountId: traveller.id,
      applicantId: applicant.value.id,
      title: 'Passport EB0731946 renewal',
    });
    if (!isOk(mission)) throw new Error('mission');

    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('plan');
    const invoice = await createInvoice(db, {
      actor: { accountId: platform.id, email: platform.email, bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId: org.value.id,
      planId: plan.id,
      periodStart: new Date('2026-11-01T04:00:00Z'),
      periodEnd: new Date('2026-12-01T04:00:00Z'),
      invoiceRef: 'INV-DHAKA-1',
      invoicedAmountMinorUnits: 250000,
      currency: 'BDT',
      dueDate: new Date('2026-11-08T00:00:00Z'),
    });
    if (!isOk(invoice)) throw new Error('invoice');
    const paid = await db.transaction((tx) =>
      applyInvoiceCollection(tx, {
        invoiceId: invoice.value.id,
        amountMinorUnits: 250000,
        currency: 'BDT',
        kind: 'MANUAL_CLAIM',
        sourceId: randomUUID(),
        reference: 'BKASH-8H2K4Q',
        collectedDate: new Date('2026-11-03T00:00:00Z'),
        recordedByAccountId: platform.id,
      }),
    );
    if (!isOk(paid)) throw new Error('collect');
    const receiptRow = (
      await db
        .select({ id: schema.paymentReceipts.id })
        .from(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.invoiceId, invoice.value.id))
    )[0];
    if (!receiptRow) throw new Error('receipt');

    const reader = { actorAccountId: owner.id, organizationId: org.value.id, now: NOW };
    const docs = [
      await getInvoiceDocument(db, { ...reader, invoiceId: invoice.value.id }),
      await getReceiptDocument(db, { ...reader, receiptId: receiptRow.id }),
    ];
    for (const doc of docs) {
      if (!isOk(doc)) throw new Error('document');
      const bytes = await renderBillingDocumentPdf(doc.value, {}, NOW);
      const raw = Buffer.from(bytes).toString('latin1');
      const { text } = await readBack(bytes);
      expect(text).toContain('Dhaka Visa Desk');
      expect(text).toContain('BDT 2,500.00');
      for (const secret of [
        'Nusrat',
        'Chowdhury',
        'EB0731946',
        'nusrat.jahan@example.com',
        'case.manager@agency.example',
        'owner@platform.example',
        applicant.value.id,
        mission.value.id,
      ]) {
        expect(text).not.toContain(secret);
        expect(raw).not.toContain(secret);
      }
    }
  });
});
