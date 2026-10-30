import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The download routes of the Invoice and Receipt PDFs (S30): who is asked about, what a refusal
 * looks like, and the headers a document is sent with. The service decides who may read
 * (billing-documents.test.ts in services); these tests pin how the routes call it.
 */

const SIGN_IN = new Error('NEXT_REDIRECT /auth/sign-in');
const mocks = vi.hoisted(() => ({
  getInvoiceDocument: vi.fn(),
  getReceiptDocument: vi.fn(),
  isPlatformOwnerAccount: vi.fn(),
  render: vi.fn(),
  signedIn: true,
}));
vi.mock('@visastack/services', () => ({
  getInvoiceDocument: mocks.getInvoiceDocument,
  getReceiptDocument: mocks.getReceiptDocument,
}));
vi.mock('@visastack/adapters', () => ({ renderBillingDocumentPdf: mocks.render }));
vi.mock('./admin', () => ({
  isPlatformOwnerAccount: mocks.isPlatformOwnerAccount,
  bootstrapAdminEmails: () => ['boot@example.test'],
}));
vi.mock('./session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string; email: string }) => unknown) => {
    if (!mocks.signedIn) throw SIGN_IN;
    return fn({ db: {}, accountId: 'acct-1', email: 'person@example.test' });
  },
}));

const agencyInvoice = await import('../app/app/agency/[orgId]/plan/invoices/[invoiceId]/pdf/route');
const agencyReceipt = await import(
  '../app/app/agency/[orgId]/plan/invoices/receipts/[receiptId]/pdf/route'
);
const adminInvoice = await import(
  '../app/app/admin/organizations/[orgId]/invoices/[invoiceId]/pdf/route'
);
const { billingDocumentIssuer } = await import('./billing-documents');

const ORG = '11111111-2222-4333-8444-555555555555';
const DOC = '66666666-7777-4888-8999-000000000000';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const MODEL = { fileName: 'VisaStack-Invoice-INV-1.pdf', number: 'INV-1' };

const invoiceCall = (orgId: string, invoiceId: string) =>
  agencyInvoice.GET(new Request('https://example.test/x'), {
    params: Promise.resolve({ orgId, invoiceId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedIn = true;
  mocks.isPlatformOwnerAccount.mockResolvedValue(false);
  mocks.render.mockResolvedValue(PDF);
});

describe('the agency invoice PDF route', () => {
  it('needs a signed-in person and reads nothing otherwise', async () => {
    mocks.signedIn = false;
    await expect(invoiceCall(ORG, DOC)).rejects.toBe(SIGN_IN);
    expect(mocks.getInvoiceDocument).not.toHaveBeenCalled();
  });

  it('asks about exactly this agency and invoice, for this person, with no staff standing', async () => {
    mocks.getInvoiceDocument.mockResolvedValue({ ok: true, value: MODEL });
    const response = await invoiceCall(ORG, DOC);
    const input = mocks.getInvoiceDocument.mock.calls[0]?.[1];
    expect(input).toMatchObject({ actorAccountId: 'acct-1', organizationId: ORG, invoiceId: DOC });
    expect(input).not.toHaveProperty('actorEmail');
    expect(input).not.toHaveProperty('bootstrapEmails');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="VisaStack-Invoice-INV-1.pdf"',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  it('answers every refusal and every malformed id with the same 404, rendering nothing', async () => {
    mocks.getInvoiceDocument.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'document not found' },
    });
    const refused = await invoiceCall(ORG, DOC);
    const malformed = await invoiceCall(ORG, '../../etc');
    const badOrg = await invoiceCall('x', DOC);
    for (const response of [refused, malformed, badOrg]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('not found');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    expect(mocks.getInvoiceDocument).toHaveBeenCalledTimes(1);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('never sends a file name it did not build itself', async () => {
    mocks.getInvoiceDocument.mockResolvedValue({
      ok: true,
      value: { ...MODEL, fileName: 'a"; filename=evil.html' },
    });
    const response = await invoiceCall(ORG, DOC);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="VisaStack.pdf"',
    );
  });
});

describe('the agency receipt PDF route', () => {
  it('asks about exactly this agency and receipt, and 404s a refusal', async () => {
    mocks.getReceiptDocument.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'document not found' },
    });
    const response = await agencyReceipt.GET(new Request('https://example.test/x'), {
      params: Promise.resolve({ orgId: ORG, receiptId: DOC }),
    });
    expect(response.status).toBe(404);
    const input = mocks.getReceiptDocument.mock.calls[0]?.[1];
    expect(input).toMatchObject({ actorAccountId: 'acct-1', organizationId: ORG, receiptId: DOC });
    expect(input).not.toHaveProperty('actorEmail');
  });
});

describe('the platform invoice PDF route', () => {
  const call = () =>
    adminInvoice.GET(new Request('https://example.test/x'), {
      params: Promise.resolve({ orgId: ORG, invoiceId: DOC }),
    });

  it('refuses anyone who is not a platform owner without asking for the document', async () => {
    const response = await call();
    expect(response.status).toBe(404);
    expect(mocks.getInvoiceDocument).not.toHaveBeenCalled();
  });

  it('passes the platform standing for a platform owner', async () => {
    mocks.isPlatformOwnerAccount.mockResolvedValue(true);
    mocks.getInvoiceDocument.mockResolvedValue({ ok: true, value: MODEL });
    const response = await call();
    expect(response.status).toBe(200);
    expect(mocks.getInvoiceDocument.mock.calls[0]?.[1]).toMatchObject({
      actorAccountId: 'acct-1',
      organizationId: ORG,
      invoiceId: DOC,
      actorEmail: 'person@example.test',
      bootstrapEmails: ['boot@example.test'],
    });
  });
});

describe('who issues the document', () => {
  it('names the product address and a watched support inbox only when they are set up', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    expect(billingDocumentIssuer(env({}))).toEqual({});
    expect(
      billingDocumentIssuer(
        env({
          NEXT_PUBLIC_APP_URL: 'https://vs.obsidianglobal.studio',
          SUPPORT_EMAIL: 'help@x.io',
        }),
      ),
    ).toEqual({ website: 'vs.obsidianglobal.studio', supportEmail: 'help@x.io' });
    expect(billingDocumentIssuer(env({ SUPPORT_EMAIL: 'not an address' }))).toEqual({});
  });
});
