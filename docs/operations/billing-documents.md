# Billing documents: Invoice and Receipt PDFs (S30)

Added 30 Oct 2026. What the downloadable Invoice and Receipt are, who can get them, and how to check them.

## What people see

- Agency owners and admins: **Download Invoice (PDF)** on every invoice card on Invoices, and **Download Receipt (PDF)** next to every receipt and on the receipt page.
- Platform owner: **Download Invoice (PDF)** under each invoice on the organization's admin page.
- Members, other agencies and anyone signed out never see the buttons, and the addresses answer "not found".

## Addresses

| Address | Who | Read through |
|---|---|---|
| `/app/agency/{orgId}/plan/invoices/{invoiceId}/pdf` | the agency's active owners and admins | `getInvoiceDocument` (services) |
| `/app/agency/{orgId}/plan/invoices/receipts/{receiptId}/pdf` | the agency's active owners and admins | `getReceiptDocument` |
| `/app/admin/organizations/{orgId}/invoices/{invoiceId}/pdf` | platform owners (checked by the route, then by the service) | `getInvoiceDocument` with the platform standing |

Every refusal (not signed in sends to sign-in first), an unknown id, a malformed id and another agency's document all get the same 404. Answers carry `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="VisaStack-Invoice-{number}.pdf"` (letters, digits and hyphens only), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`.

The middleware puts the page policy on every `/app` response. For these three addresses it puts the same strict document policy instead (enforced, never report-only), so the stricter policy holds whichever header Next.js keeps (`isDocumentDownloadPath` in `apps/web/src/lib/csp.ts`, tested in `csp-middleware.test.ts`). The links on the screens are plain links with no `download` attribute: the server's `Content-Disposition` makes the download.

## How a document is made

1. The service reads the invoice (or receipt), its plan, the agency's name, the agency's earliest active owner's email (Billed To), its ledger rows and receipt numbers, and builds a finished view model in words (`packages/services/src/billing-documents.ts`).
2. The adapter draws one A4 page from that model (`packages/adapters/src/billing-document-pdf.ts`, pdf-lib 1.17.1 with @pdf-lib/fontkit 1.1.1). Long payment lists continue on further pages. The PDF library, its font engine and the font data load only when a document is drawn (dynamic imports); the decoded fonts are kept for the life of the server instance. Fonts are embedded whole, not subset: fontkit 1.1.1's subsetter fails on these glyph tables, and each Latin-1 file is about 31 KB.
3. Nothing is stored. Every download is made fresh, in a few hundred milliseconds.

The font is Inter (the product's own, SIL Open Font License 1.1), embedded from `packages/adapters/src/billing-document-fonts.ts`; the commands that made it are in that file. A character the font cannot draw (for example Bangla in an agency's name) prints as "?" rather than failing the document.

## What a document holds

Invoice: number, issue date, due date (not on a cancelled or refunded invoice), period (with its last day included: a 30-day period starting 1 Nov reads "1 Nov 2026 to 30 Nov 2026"; `formatBillingPeriod` in @visastack/core), status stamp (Open, Overdue, Partly Paid, Paid, Partly Refunded, Refunded, Cancelled), Billed To (agency name, Agency Code, billing email), the plan line, Invoiced, Paid So Far (or Kept After Refunds), Refunded, Still Owed, Payments Received (date, how it was paid, reference, receipt number, amount), Refunds, a plain note, the footer.

Receipt: receipt number, issue date, payment date, invoice, status Paid, how it was paid, reference, invoice amount, amount received, the invoice's plan and period, "It is not a tax document."

Never: a traveller, a case, a document, a staff account, an amount in any email, or anything secret. Dates use the Bangladesh calendar ("8 Nov 2026"); amounts read "BDT 2,500.00".

The PDF asks readers to show its title (for example "Invoice INV-...") in the window. Long Billed To lines wrap within their column. The footer names `SUPPORT_EMAIL` when it is set (the same helper as the Help page, `apps/web/src/lib/support-email.ts`) ("Questions about this invoice? Write to ..."), otherwise "Reply to any VisaStack billing email". The website shown is the app's own address (`NEXT_PUBLIC_APP_URL` or the Vercel production address).

## Checking after a deployment

1. Sign in as an agency owner with an invoice, open Invoices, choose Download Invoice (PDF): the file opens, the amounts match the card.
2. Sign in as a member of the same agency and open the same address: "not found".
3. On the platform page, Download Invoice (PDF) under any invoice.

No migration and no new environment variable are needed.
