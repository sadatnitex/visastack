import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The download routes of a traveller's own Invoice and Receipt PDFs (ADR 0025 T5): signed-in only,
 * asked with the session's own scope and nothing else, every refusal the same 404, and the same
 * private download headers as the agency documents. The services decide whose rows may be read
 * (person-billing-history.test.ts); these tests pin how the routes call them.
 */

const SIGN_IN = new Error('NEXT_REDIRECT /auth/sign-in');
const SELF = { kind: 'self-scope-stand-in' };
const mocks = vi.hoisted(() => ({
  ownInvoiceDocument: vi.fn(),
  ownReceiptDocument: vi.fn(),
  render: vi.fn(),
  signedIn: true,
}));
vi.mock('@visastack/services', () => ({
  ownInvoiceDocument: mocks.ownInvoiceDocument,
  ownReceiptDocument: mocks.ownReceiptDocument,
  isUuid: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
}));
vi.mock('@visastack/adapters', () => ({ renderBillingDocumentPdf: mocks.render }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: object) => unknown) => {
    if (!mocks.signedIn) throw SIGN_IN;
    return fn({ db: {}, accountId: 'acct-1', email: 'person@example.test', self: SELF });
  },
}));

const invoiceRoute = await import('./invoices/[invoiceId]/pdf/route');
const receiptRoute = await import('./receipts/[receiptId]/pdf/route');

const DOC = '66666666-7777-4888-8999-000000000000';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const NOT_FOUND = { ok: false, error: { code: 'not_found', message: 'document not found' } };

const invoiceCall = (invoiceId: string) =>
  invoiceRoute.GET(new Request('https://example.test/x'), {
    params: Promise.resolve({ invoiceId }),
  });
const receiptCall = (receiptId: string) =>
  receiptRoute.GET(new Request('https://example.test/x'), {
    params: Promise.resolve({ receiptId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedIn = true;
  mocks.render.mockResolvedValue(PDF);
});

describe("a traveller's own invoice PDF route", () => {
  it('needs a signed-in person and reads nothing otherwise', async () => {
    mocks.signedIn = false;
    await expect(invoiceCall(DOC)).rejects.toBe(SIGN_IN);
    expect(mocks.ownInvoiceDocument).not.toHaveBeenCalled();
  });

  it("asks for exactly this invoice with the session's own scope, and sends a private download", async () => {
    mocks.ownInvoiceDocument.mockResolvedValue({
      ok: true,
      value: { fileName: 'VisaStack-Invoice-TP-A1B2C3D4-1.pdf', number: 'TP-A1B2C3D4-1' },
    });
    const response = await invoiceCall(DOC);
    const [db, scope, invoiceId, now] = mocks.ownInvoiceDocument.mock.calls[0] ?? [];
    expect(db).toEqual({});
    expect(scope).toBe(SELF);
    expect(invoiceId).toBe(DOC);
    expect(now).toBeInstanceOf(Date);
    expect(mocks.ownInvoiceDocument.mock.calls[0]).toHaveLength(4);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="VisaStack-Invoice-TP-A1B2C3D4-1.pdf"',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; sandbox allow-downloads",
    );
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  it("answers another person's invoice and a malformed id with the same 404, rendering nothing", async () => {
    mocks.ownInvoiceDocument.mockResolvedValue(NOT_FOUND);
    const refused = await invoiceCall(DOC);
    const malformed = await invoiceCall('../../etc');
    for (const response of [refused, malformed]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('not found');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    expect(mocks.ownInvoiceDocument).toHaveBeenCalledTimes(1);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});

describe("a traveller's own receipt PDF route", () => {
  it("asks for exactly this receipt with the session's own scope", async () => {
    mocks.ownReceiptDocument.mockResolvedValue({
      ok: true,
      value: { fileName: 'VisaStack-Receipt-R-000001.pdf', number: 'R-000001' },
    });
    const response = await receiptCall(DOC);
    const [, scope, receiptId] = mocks.ownReceiptDocument.mock.calls[0] ?? [];
    expect(scope).toBe(SELF);
    expect(receiptId).toBe(DOC);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="VisaStack-Receipt-R-000001.pdf"',
    );
  });

  it('404s a refusal and a malformed id, and needs a signed-in person', async () => {
    mocks.ownReceiptDocument.mockResolvedValue(NOT_FOUND);
    expect((await receiptCall(DOC)).status).toBe(404);
    expect((await receiptCall('not-an-id')).status).toBe(404);
    expect(mocks.ownReceiptDocument).toHaveBeenCalledTimes(1);
    mocks.signedIn = false;
    await expect(receiptCall(DOC)).rejects.toBe(SIGN_IN);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
