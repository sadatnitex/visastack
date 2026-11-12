import { type Locator, type Page, type TestInfo, expect, test } from '@playwright/test';
import type { AnswerJourneyProps } from '../fixtures/answer-journey.fixture';
import { renderFixture } from '../scroll-budget/support';
import { expectNoAxeViolations, expectNoSidewaysScroll, tabStops } from './support';

/**
 * Tier 1a measurement of one journey (docs/operations/staging-journeys.md): "send the three answers
 * that can be sent", a passport, a bank statement and one photo, when a second, unrelated agency
 * asks a traveller for six things (a passport, a bank statement, a photo, a national identity card
 * whose copy has expired, an employment letter that is not saved, and one detail).
 *
 * Two views are driven by real clicks over the same made-up scenario:
 * - `before`: the Requests page as it is today: open a request, choose a copy where there is a
 *   choice, press that request's own Send button, and (on a phone) press Back to reach the next one;
 * - `after`: the Answer from Your Records review: the ready answers are ticked, one choice is made,
 *   and one Send button sends all three.
 *
 * Each run counts what a person has to do and writes one `MEASURE {...}` line, so a regression is
 * seen. The stand-in server action answers "nothing was changed", so every count ends at the press.
 * This is a measurement of how the screens read and respond with made-up data. It proves nothing
 * about sign-in, who may see what, stored data, or that a send reaches an agency.
 */

// Each fixture is bundled from the real product code the first time it is opened in a worker.
test.describe.configure({ timeout: 90_000 });

const AGENCY = 'TEST Agency Unrelated';
const SIZES = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

type SizeName = (typeof SIZES)[number]['name'];

/** The counts a regression would move. Changing one is a decision, not an accident. */
const EXPECTED = {
  before: {
    desktop: { actions: 7, sends: 3, opens: 3, chooses: 1, backs: 0 },
    phone: { actions: 9, sends: 3, opens: 3, chooses: 1, backs: 2 },
  },
  after: {
    desktop: { actions: 2, sends: 1, opens: 0, chooses: 1, backs: 0 },
    phone: { actions: 2, sends: 1, opens: 0, chooses: 1, backs: 0 },
  },
} as const;

/** What each view shows without a single click. */
const SEEN = {
  before: { agencyNamed: false, expiredChosenInAdvance: true, missingLetterVisible: false },
  after: { agencyNamed: true, expiredChosenInAdvance: false, missingLetterVisible: true },
} as const;

interface Counts {
  opens: number;
  chooses: number;
  sends: number;
  backs: number;
}
const actionsOf = (c: Counts) => c.opens + c.chooses + c.sends + c.backs;

async function open(page: Page, view: AnswerJourneyProps['view'], size: (typeof SIZES)[number]) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await renderFixture(page, 'answer-journey', { view }, { standInServerActions: true });
}

/** What the screen shows before anything is clicked. Nothing here is a click, so nothing is counted. */
async function seenAtFirst(page: Page, view: AnswerJourneyProps['view']) {
  const agencyNamed = await page.getByText(AGENCY).first().isVisible();
  const missingLetterVisible = await page
    .getByText(/Nothing of this kind is saved|No copy of this document type/)
    .first()
    .isVisible();
  // A copy is "chosen in advance" when its choice is already ticked. The expired national identity
  // card is the only copy of its kind. Before, its (still closed) panel holds a ticked radio; after,
  // it has no choice at all, only a link.
  const expiredChosenInAdvance = await page.evaluate((current) => {
    const scope =
      current === 'before'
        ? document.querySelector('#lp-pane-req-national-id')
        : [...document.querySelectorAll('label')].find((label) =>
            (label.textContent ?? '').includes('National'),
          );
    return scope
      ? [
          ...scope.querySelectorAll<HTMLInputElement>(
            'input[type="radio"], input[type="checkbox"]',
          ),
        ].some((input) => input.checked)
      : false;
  }, view);
  return { agencyNamed, expiredChosenInAdvance, missingLetterVisible };
}

/** Presses a Send button (a real click) and waits for the stand-in server to answer. */
async function press(button: Locator, counts: Counts, scope: Locator) {
  await button.click();
  counts.sends += 1;
  await expect(scope.getByText(/Test fixture: nothing was changed/).first()).toBeVisible();
}

async function journeyBefore(page: Page, size: SizeName): Promise<Counts> {
  const counts: Counts = { opens: 0, chooses: 0, sends: 0, backs: 0 };
  const steps = [
    { row: 'Document: Passport', pick: null },
    { row: 'Document: Bank Statement', pick: null },
    { row: 'Document: Photo', pick: /Photo New\.jpg/ },
  ] as const;
  for (const [index, step] of steps.entries()) {
    await page.getByRole('link', { name: step.row, exact: true }).click();
    counts.opens += 1;
    const pane = page.getByRole('region', { name: step.row });
    await expect(pane).toBeVisible();
    if (step.pick) {
      await pane.getByRole('radio', { name: step.pick }).click();
      counts.chooses += 1;
    }
    // Whatever is chosen when the button is pressed is what goes: say which copy that is.
    await expect(pane.getByRole('radio', { checked: true })).toHaveCount(1);
    await press(pane.getByRole('button', { name: /^Send to the Agency/ }), counts, pane);
    if (size === 'phone' && index < steps.length - 1) {
      await page.getByRole('link', { name: 'Back to Requests' }).click();
      counts.backs += 1;
    }
  }
  return counts;
}

async function journeyAfter(page: Page): Promise<Counts> {
  const counts: Counts = { opens: 0, chooses: 0, sends: 0, backs: 0 };
  const form = page.locator('form');
  // The passport and the bank statement are ticked already, and the person only has to pick a photo.
  await expect(form.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await form.getByRole('radio', { name: /Photo New\.jpg/ }).click();
  counts.chooses += 1;
  const send = form.getByRole('button', { name: `Send 3 Answers to ${AGENCY}` });
  await expect(send).toBeVisible();
  await press(send, counts, form);
  return counts;
}

function report(testInfo: TestInfo, line: Record<string, unknown>) {
  const text = `MEASURE ${JSON.stringify(line)}`;
  process.stdout.write(`${text}\n`);
  return testInfo.attach('measure', { body: text, contentType: 'text/plain' });
}

for (const view of ['before', 'after'] as const) {
  for (const size of SIZES) {
    test(`${view}: send the three answers that can be sent at ${size.width}px (${size.name})`, async ({
      page,
    }, testInfo) => {
      await open(page, view, size);
      await expectNoSidewaysScroll(page);
      const seen = await seenAtFirst(page, view);
      const counts =
        view === 'before' ? await journeyBefore(page, size.name) : await journeyAfter(page);
      const measured = { ...counts, actions: actionsOf(counts) };
      await report(testInfo, {
        view,
        width: size.width,
        actions: measured.actions,
        sends: counts.sends,
        opens: counts.opens,
        chooses: counts.chooses,
        backs: counts.backs,
        agencyNamedBeforePress: seen.agencyNamed,
        expiredChosenInAdvance: seen.expiredChosenInAdvance,
        missingLetterVisibleWithoutOpening: seen.missingLetterVisible,
      });
      expect(measured).toEqual(EXPECTED[view][size.name]);
      expect(seen).toEqual(SEEN[view]);
    });
  }
}

for (const size of SIZES) {
  test.describe(`the review at ${size.width}px (${size.name})`, () => {
    test('has no WCAG 2.2 AA violation and no sideways scroll', async ({ page }) => {
      await open(page, 'after', size);
      await expectNoSidewaysScroll(page);
      await expectNoAxeViolations(page);
    });

    test('is used by keyboard alone: Tab reaches every control in reading order, with a visible mark', async ({
      page,
    }) => {
      await open(page, 'after', size);
      const stops = await tabStops(page, 10);
      const starts = (name: string, text: string) => name.startsWith(text);
      const expected = [
        'Document: Passport',
        'Document: Bank Statement',
        // The choice between photos is one stop for the whole group, on the choice already made.
        'Do Not Send Now',
        'Open This Request: Document: National Id',
        'Add Documents: Document: Employment Letter',
        'Open This Request: Document: Employment Letter',
        'Open This Request: Detail: Passport Number',
        'About These Items',
        `Send 2 Answers to ${AGENCY}`,
        'About Sending',
      ];
      stops.forEach((stop, index) => {
        expect(
          starts(stop.name, expected[index] ?? '(none)'),
          `stop ${index + 1}: ${stop.name}`,
        ).toBe(true);
      });
      expect(
        stops.filter((stop) => !stop.marked).map((stop) => stop.name),
        'stops with no focus mark',
      ).toEqual([]);
    });

    test('Space ticks and unticks an answer, and the one button follows', async ({ page }) => {
      await open(page, 'after', size);
      const send = (count: number) =>
        page.getByRole('button', {
          name: count === 1 ? `Send 1 Answer to ${AGENCY}` : `Send ${count} Answers to ${AGENCY}`,
        });
      await expect(send(2)).toBeVisible();
      await page.keyboard.press('Tab');
      const passport = page.getByRole('checkbox', { name: 'Document: Passport', exact: true });
      await expect(passport).toBeFocused();
      await page.keyboard.press('Space');
      await expect(passport).not.toBeChecked();
      await expect(send(1)).toBeVisible();
      await page.keyboard.press('Space');
      await expect(passport).toBeChecked();
      await expect(send(2)).toBeVisible();
    });

    test('Enter on the button sends, and the answer comes back where it can be read', async ({
      page,
    }) => {
      await open(page, 'after', size);
      const send = page.getByRole('button', { name: `Send 2 Answers to ${AGENCY}` });
      // Reach it with the keyboard alone: Tab from the top until the button has focus.
      for (let step = 0; step < 15; step += 1) {
        await page.keyboard.press('Tab');
        if (await send.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(send).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('alert').filter({ hasText: 'Test fixture: nothing was changed' }),
      ).toBeVisible();
    });
  });
}
