import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import {
  type ComponentProps,
  type FunctionComponent,
  type ReactElement,
  createElement as h,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingRow } from '../../src/app/app/account/plan/billing/billing-row';
import { expectWithinBudget } from './support';

/**
 * WP-SB9: the billing lists (a traveller's Billing History, an agency's Invoices, the owner's
 * Plans and an organization's invoices) with worst-case data, at a phone and a desktop. The
 * signed-in pages cannot be opened by the no-secret build, so this draws the real compact row
 * (`BillingRow`) on the server, with the same kind of content those pages put inside it, on the
 * site's own stylesheet. The page tests pin the real pages' caps, links and reads.
 */

const TASK_SCREENS = 3;

/** The real row, typed so its children can be passed the way createElement passes them. */
const Row = BillingRow as unknown as FunctionComponent<
  Omit<ComponentProps<typeof BillingRow>, 'children'>
>;

const facts = (pairs: readonly (readonly [string, string])[]) =>
  h(
    'dl',
    { className: 'invoice-facts' },
    ...pairs.map(([term, value]) =>
      h('div', { key: term }, h('dt', null, term), h('dd', null, value)),
    ),
  );

const badge = (text: string) => h('span', { className: 'badge badge-success' }, text);

/** A traveller purchase with its receipts, refund request and PDF link: the fullest a row gets. */
function purchaseBody(index: number): ReactElement {
  return h(
    'div',
    null,
    h('h2', { className: 'sr-only' }, `TP-A1B2C3D4-${index}`),
    h('p', { className: 'invoice-note' }, 'Paid. Your plan covers the period shown.'),
    facts([
      ['Plan', 'Traveller Plus Yearly With A Long Name'],
      ['Amount', 'BDT 4,990.00'],
      ['Period', '30 Oct 2026 to 29 Oct 2027'],
      ['Paid On', '30 Oct 2026'],
    ]),
    h(
      'section',
      { className: 'invoice-section', 'aria-label': `Receipts for TP-A1B2C3D4-${index}` },
      h('h3', { className: 'invoice-subhead' }, 'Receipts'),
      h(
        'ul',
        { className: 'invoice-list' },
        ...[1, 2, 3].map((n) =>
          h(
            'li',
            { key: n, className: 'invoice-list-item' },
            h('span', null, `Receipt R-00000${n}`),
            h('span', null, 'BDT 1,663.33 on 30 Oct 2026'),
            h('a', { className: 'invoice-link', href: '#' }, 'Download Receipt (PDF)'),
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'billing-documents' },
      h('a', { className: 'btn btn-secondary', href: '#' }, 'Download Invoice (PDF)'),
    ),
  );
}

/** An agency invoice that still asks for money: its facts and the report form. */
function invoiceBody(index: number): ReactElement {
  const field = (id: string, label: string) =>
    h(
      'div',
      { key: id, className: 'field-row' },
      h('label', { className: 'field-label', htmlFor: `${id}-${index}` }, label),
      h('input', { id: `${id}-${index}`, className: 'input' }),
    );
  return h(
    'div',
    null,
    facts([
      ['Invoiced', 'BDT 12,500.50'],
      ['Paid So Far', 'BDT 0.00'],
      ['Still Owed', 'BDT 12,500.50'],
      ['Due', '1 Dec 2026'],
    ]),
    h(
      'form',
      { className: 'field-list form-narrow' },
      field('amount', 'Amount Paid'),
      field('reference', 'Payment Reference'),
      field('paid-on', 'Paid On'),
      h('button', { type: 'button', className: 'btn btn-primary' }, 'Report the Payment'),
    ),
  );
}

function showMore(noun: string): ReactElement {
  return h(
    'div',
    { className: 'show-more', id: `${noun}-more` },
    h('output', { className: 'show-more-count muted u-fs-085' }, `Showing the first 10 ${noun}.`),
    h('a', { className: 'btn btn-secondary u-btn-sm show-more-link', href: '#' }, 'Show More'),
  );
}

function list(
  title: string,
  count: number,
  body: (index: number) => ReactElement,
  noun: string,
): string {
  return renderToStaticMarkup(
    h(
      'section',
      { className: 'section container' },
      h('h1', null, title),
      h(
        'div',
        { className: 'billing-rows' },
        ...Array.from({ length: count }, (_, index) =>
          h(
            Row,
            {
              key: index,
              id: `row-${index}`,
              open: index === 0,
              title: `REFERENCE-WITH-A-LONG-CODE-${2026_000 + index}`,
              line: 'BDT 12,500.50, due 1 Dec 2026',
              badges: h('span', null, badge('Waiting for Payment'), ' ', badge('Overdue')),
            },
            body(index),
          ),
        ),
        count >= 10 ? showMore(noun) : null,
      ),
    ),
  );
}

/** The site's stylesheet (from its front page, with its scripts blocked), then the given body. */
async function draw(page: Page, html: string): Promise<void> {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'script' ? route.abort() : route.continue(),
  );
  await page.goto('/');
  await page.evaluate((markup) => {
    const main = document.createElement('main');
    main.className = 'scroll-fixture';
    main.id = 'main';
    main.innerHTML = markup;
    document.body.replaceChildren(main);
  }, html);
  await page.locator('main.scroll-fixture .billing-row').first().waitFor();
}

test.describe('WP-SB9 billing lists with worst-case data', () => {
  test("a traveller's Billing History: 10 purchases, the newest open, within 3 screens", async ({
    page,
  }) => {
    await draw(page, list('Billing History', 10, purchaseBody, 'purchases'));
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: TASK_SCREENS, viewport, mode: 'enforce' });
    }
    // A closed row still says the reference, the amount and the state.
    const closed = page.locator('details.billing-row:not([open])').first();
    await expect(closed.locator('summary')).toContainText('REFERENCE-WITH-A-LONG-CODE');
    await expect(closed.locator('summary')).toContainText('BDT 12,500.50');
    await expect(closed.locator('summary')).toContainText('Waiting for Payment');
    await expect(closed.getByText('Receipt R-000001')).toBeHidden();
  });

  test("an agency's Invoices: 10 invoices, one open with its form, within 3 screens", async ({
    page,
  }) => {
    await draw(page, list('Invoices', 10, invoiceBody, 'invoices'));
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: TASK_SCREENS, viewport, mode: 'enforce' });
    }
  });

  test('the Plans page: 12 plans as closed rows within 3 screens', async ({ page }) => {
    const html = list('Plans', 12, purchaseBody, 'plans').replace(
      'id="row-0" open=""',
      'id="row-0"',
    );
    await draw(page, html);
    await expect(page.locator('details.billing-row[open]')).toHaveCount(0);
    for (const viewport of ['phone', 'desktop'] as const) {
      await expectWithinBudget(page, { screens: TASK_SCREENS, viewport, mode: 'enforce' });
    }
  });

  test('a row opens from the keyboard and keeps a 44px target, with no serious accessibility issue', async ({
    page,
  }) => {
    await draw(page, list('Invoices', 10, invoiceBody, 'invoices'));
    await page.setViewportSize({ width: 390, height: 844 });
    const second = page.locator('#row-1');
    const summary = second.locator('summary');
    expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('open', '');
    await expect(second.getByLabel('Amount Paid')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('the guard fails when every row is open (proof the budget check can go red)', async ({
    page,
  }) => {
    const html = list('Billing History', 10, purchaseBody, 'purchases').replaceAll(
      '<details class="billing-row" id="row-',
      '<details open class="billing-row" id="row-',
    );
    await draw(page, html);
    await expect(
      expectWithinBudget(page, { screens: TASK_SCREENS, viewport: 'phone', mode: 'enforce' }),
    ).rejects.toThrow(/page height at phone/);
  });
});
