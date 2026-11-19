import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import sharp from 'sharp';

/**
 * R1 gate: the built Home page matches the owner-approved reference, chapter by chapter.
 *
 * Every chapter of the reference (eight, in order) is checked on the page itself at 1440x900 and
 * 390x844: it is there, its tone is right, its headline and its parts are there, the pictures
 * show their finished state, nothing is cut off, and a pinned chapter is centred and sized by its
 * content (no half-empty stage). At 1440x900 this runs twice: with motion (a chapter at its end,
 * scrolled to) and with reduced motion (finished and still).
 *
 * With R1_SHOTS=<folder> the same run also saves a small picture of each chapter, so they can be
 * set side by side with the reference rendered the same way (docs/upgrades/programme/pub/R1-records.md).
 */

/** Variable-keyed env read, as playwright.config.ts does (index-signature rule). */
function getEnv(name: string): string | undefined {
  return process.env[name];
}

const SHOTS = getEnv('R1_SHOTS');

interface Chapter {
  readonly key: string;
  readonly tone: 'dark' | 'light';
  /** The element that holds the chapter (a scene, or a plain chapter). */
  readonly root: string;
  readonly heading: string;
  readonly headline: RegExp;
  readonly pinned: boolean;
  /** The picture or part that must be whole on screen. */
  readonly visual: string;
  readonly parts: (page: Page) => Promise<void>;
  /**
   * MOB1 (19 Nov 2026, owner approved the phone mock "phn mock okay for now"): below 760 px the page
   * shows a leaner chapter. Where it does, these replace `visual` and `parts` on a phone only;
   * a computer is still measured by `visual` and `parts`.
   */
  readonly phoneVisual?: string;
  readonly phoneParts?: (page: Page) => Promise<void>;
}

const CHAPTERS: readonly Chapter[] = [
  {
    key: 'hero',
    tone: 'dark',
    root: '[data-scene="hero"]',
    heading: '#hs-hero-title',
    headline: /One record\.\s*Every visa\./,
    pinned: true,
    visual: '.kit-deck',
    parts: async (page) => {
      await expect(page.locator('.kit-deck-doc')).toHaveCount(5);
      await expect(page.locator('.kit-deck-doc[data-slot="hero"] img')).toHaveAttribute(
        'src',
        '/pictures/passport-bd.png',
      );
      await expect(page.locator('.hs-hero .kit-ring-svg .kit-seg')).toHaveCount(8 * 6);
      await expect(page.locator('.hs-hero .pub-button')).toHaveCount(2);
      await expect(
        page.locator('.hs-hero').getByText('Example. Completeness only. Not an approval.'),
      ).toBeVisible();
    },
    phoneVisual: '.hs-phone-passport',
    phoneParts: async (page) => {
      // A phone shows the passport cover alone with one Example tag: no fan, no ring, no note. The
      // approved mock keeps "Completeness only. Not an approval." once, in the checklist chapter.
      await expect(page.locator('.hs-hero .pub-button')).toHaveCount(2);
      await expect(page.locator('.hs-phone-passport img')).toHaveAttribute(
        'src',
        '/pictures/passport-bd.png',
      );
      await expect(page.locator('.hs-phone-passport .pub-example')).toBeVisible();
      await expect(page.locator('.hs-hero .kit-deck')).toBeHidden();
      await expect(page.locator('.hs-hero .hs-hero-cap')).toBeHidden();
    },
  },
  {
    key: 'add',
    tone: 'dark',
    root: '[data-scene="add"]',
    heading: '#hs-add-title',
    headline: /Add it once\.\s*Confirm what it reads\./,
    pinned: true,
    visual: '.kit-phone',
    parts: async (page) => {
      for (const step of ['Add', 'Read', 'Confirm'])
        await expect(
          page.locator('.hs-step-text b', { hasText: new RegExp(`^${step}$`) }),
        ).toBeVisible();
      for (const field of ['Surname', 'Passport Ends', 'Nationality'])
        await expect(page.locator('.kit-phone').getByText(field, { exact: true })).toBeVisible();
      await expect(page.locator('.kit-phone').getByText('Example record.')).toBeVisible();
    },
    phoneVisual: '.kit-phone',
    phoneParts: async (page) => {
      for (const step of ['Add', 'Read', 'Confirm'])
        await expect(
          page.locator('.hs-step-text b', { hasText: new RegExp(`^${step}$`) }),
        ).toBeVisible();
      // Two fields and the Example tag alone: the third field and "Example record." are for larger screens.
      for (const field of ['Surname', 'Passport Ends'])
        await expect(page.locator('.kit-phone').getByText(field, { exact: true })).toBeVisible();
      await expect(
        page.locator('.kit-phone').getByText('Nationality', { exact: true }),
      ).toBeHidden();
      await expect(page.locator('.kit-phone .pub-example')).toBeVisible();
      await expect(page.locator('.kit-phone').getByText('Example record.')).toBeHidden();
    },
  },
  {
    key: 'ready',
    tone: 'light',
    root: '[data-scene="ready"]',
    heading: '#hs-ready-title',
    headline: /Ready for\s*every trip\./,
    pinned: true,
    visual: '.kit-panel',
    parts: async (page) => {
      for (const country of ['Singapore', 'Germany', 'Japan'])
        await expect(page.locator('.kit-panel .kit-tab', { hasText: country })).toHaveCount(1);
      await expect(page.locator('.kit-rows .kit-row')).toHaveCount(8);
      await expect(page.locator('.kit-tag:visible', { hasText: 'Reused' }).first()).toBeVisible();
      await expect(page.locator('.kit-tag:visible', { hasText: 'To Add' }).first()).toBeVisible();
      await expect(page.locator('.kit-panel .pub-example')).toBeVisible();
    },
  },
  {
    key: 'journey',
    tone: 'light',
    root: '[data-scene="journey"]',
    heading: '#hs-journey-title',
    headline: /Know where\s*it stands\./,
    pinned: true,
    visual: '.kit-journey',
    parts: async (page) => {
      await expect(page.locator('.kit-track .kit-node')).toHaveCount(7);
      await expect(page.locator('.kit-stage:visible .kit-who li')).toHaveText([
        'You',
        'Agency',
        'Embassy',
      ]);
      await expect(page.locator('.kit-stage:visible .kit-who-on')).toHaveCount(1);
      await expect(page.locator('.kit-journey .pub-example')).toBeVisible();
    },
  },
  {
    key: 'share',
    tone: 'dark',
    root: '[data-scene="share"]',
    heading: '#hs-share-title',
    headline: /You decide\s*who sees what\./,
    pinned: true,
    visual: '.kit-sheet',
    parts: async (page) => {
      await expect(page.locator('.kit-share-row')).toHaveCount(3);
      // At the very end of the run the sheet says Access Ended; otherwise it shows who can see what.
      const ended = page.locator('.kit-ended:visible');
      if ((await ended.count()) > 0) await expect(ended).toContainText('Access Ended');
      else {
        await expect(page.locator('.kit-sheet').getByText('Share with Agency')).toBeVisible();
        await expect(page.locator('.kit-sheet .kit-see-chip:visible').first()).toBeVisible();
      }
    },
  },
  {
    key: 'rules',
    tone: 'light',
    root: '#sources',
    heading: '#hs-rules-title',
    headline: /Every rule shows\s*its source\./,
    pinned: false,
    visual: '.hs-cards',
    parts: async (page) => {
      await expect(page.locator('.hs-card')).toHaveCount(3);
      for (const title of ['Source Shown', 'Checked Date', 'Changes Flagged'])
        await expect(page.locator('.hs-card-title', { hasText: title })).toBeVisible();
    },
    phoneVisual: '.hs-swipe',
    phoneParts: async (page) => {
      // The three cards sit in one swipe row: the row fits the screen, every card is whole inside
      // its scroll box (the row scrolls to the others), and the section carries its Example tag.
      await expect(page.locator('.hs-card')).toHaveCount(3);
      for (const title of ['Source Shown', 'Checked Date', 'Changes Flagged'])
        await expect(page.locator('.hs-card-title', { hasText: title })).toBeVisible();
      const row = await page.locator('.hs-swipe').evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(row.scroll, 'the row scrolls sideways').toBeGreaterThan(row.client);
      const cards = await page
        .locator('.hs-card')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetWidth));
      for (const width of cards) expect(width).toBeLessThanOrEqual(row.client);
      await expect(page.locator('#sources .pub-example')).toBeVisible();
    },
  },
  {
    key: 'agencies',
    tone: 'light',
    root: '#for-agencies',
    heading: '#hs-agencies-title',
    headline: /Built for\s*agencies too\./,
    pinned: false,
    visual: '.kit-cases',
    parts: async (page) => {
      await expect(page.locator('.kit-case')).toHaveCount(3);
      await expect(page.locator('.kit-cases .pub-example')).toBeVisible();
      await expect(page.locator('#for-agencies a[href="/for-agencies"]')).toBeVisible();
    },
    phoneVisual: '#for-agencies .hs-copy',
    phoneParts: async (page) => {
      // One line and the button: the cases list (and so its Example tag, there is no picture left
      // to label) is for larger screens.
      await expect(page.locator('#for-agencies .kit-cases')).toBeHidden();
      await expect(page.locator('#for-agencies .pub-example')).toBeHidden();
      await expect(page.locator('#for-agencies .kit-sub')).toHaveText(
        'Clients keep their own record.',
        { useInnerText: true },
      );
      await expect(page.locator('#for-agencies a[href="/for-agencies"]')).toBeVisible();
    },
  },
  {
    key: 'closing',
    tone: 'dark',
    root: '#start',
    heading: '#pub-closing-title',
    headline: /Start with\s*your passport\./,
    pinned: false,
    visual: '.kit-closing-passport',
    parts: async (page) => {
      await expect(page.locator('#start .pub-button')).toHaveCount(2);
      await expect(page.locator('#start .kit-closing-passport img')).toHaveAttribute(
        'src',
        '/pictures/passport-bd.png',
      );
    },
  },
];

const RUNS = [
  { name: 'desktop, motion on', width: 1440, height: 900, motion: 'on' },
  { name: 'desktop, motion off', width: 1440, height: 900, motion: 'off' },
  { name: 'phone, motion off', width: 390, height: 844, motion: 'off' },
] as const;

/** Scrolls so the chapter shows at its end: a pinned scene near the end of its run, else its top. */
async function showChapterEnd(page: Page, chapter: Chapter, live: boolean): Promise<void> {
  await page.evaluate(
    ({ root, pinned, live }) => {
      const el = document.querySelector(root) as HTMLElement;
      const box = el.getBoundingClientRect();
      const top = box.top + window.scrollY;
      const stage = el.querySelector<HTMLElement>('.pub-scene-stage');
      const line = stage ? Number.parseFloat(getComputedStyle(stage).top) || 0 : 0;
      const travel = box.height - (window.innerHeight - line);
      const y = pinned && live && travel > 0 ? top + travel * 0.97 : top - 90;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, Math.max(0, y));
    },
    { root: chapter.root, pinned: chapter.pinned, live },
  );
  await page.waitForTimeout(1000);
}

async function save(page: Page, run: (typeof RUNS)[number], chapter: Chapter): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const raw = await page.screenshot();
  const small = await sharp(raw)
    .resize({ width: run.width > 600 ? 720 : 390 })
    .png({ palette: true, quality: 70, compressionLevel: 9 })
    .toBuffer();
  const tag = `${run.width > 600 ? 'desktop' : 'phone'}${run.motion === 'on' ? '-motion' : ''}`;
  writeFileSync(join(SHOTS, `app-${tag}-${chapter.key}.png`), small);
}

for (const run of RUNS) {
  test.describe(`Home against the approved reference: ${run.name}`, () => {
    test.use({
      viewport: { width: run.width, height: run.height },
      contextOptions: { reducedMotion: run.motion === 'off' ? 'reduce' : 'no-preference' },
    });

    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#hs-hero-title')).toBeVisible();
      if (run.motion === 'on')
        await expect(page.locator('html')).toHaveAttribute('data-scenes', 'live');
      // Reduced motion is the gentle mode (owner, 18 Nov 2026): the steps play as fades, nothing pins.
      else await expect(page.locator('html')).toHaveAttribute('data-scenes', 'gentle');
    });

    test('has the eight chapters in the reference order, dark and light as approved', async ({
      page,
    }) => {
      const tones = await page.evaluate(() =>
        [...document.querySelectorAll('.hs > section')].map((section) =>
          section.getAttribute('data-tone'),
        ),
      );
      expect(tones).toEqual(CHAPTERS.map((chapter) => chapter.tone));
    });

    for (const chapter of CHAPTERS) {
      test(`chapter ${chapter.key} matches`, async ({ page }) => {
        const live = run.motion === 'on';
        await showChapterEnd(page, chapter, live);
        // Gentle mode plays a scene once when it comes into view: wait until it rests finished
        // (its step equals its finished step), never a fixed time.
        if (!live)
          await page.waitForFunction((root) => {
            const scenes = [
              ...document.querySelectorAll(`${root}[data-scene], ${root} [data-scene]`),
            ];
            return scenes.every(
              (el) => el.getAttribute('data-step') === el.getAttribute('data-rest'),
            );
          }, chapter.root);
        const heading = page.locator(chapter.heading);
        await expect(heading).toHaveText(chapter.headline);
        const viewport = page.viewportSize();
        const width = viewport?.width ?? run.width;
        const height = viewport?.height ?? run.height;
        // The headline is on screen, whole.
        const h = await heading.boundingBox();
        expect(h, 'headline box').not.toBeNull();
        expect(h?.y ?? -1).toBeGreaterThanOrEqual(0);
        expect((h?.y ?? 0) + (h?.height ?? 0)).toBeLessThanOrEqual(height);
        // The chapter's picture is whole across the width: nothing cut off on either side.
        const phone = width < 760;
        const visual = page.locator((phone && chapter.phoneVisual) || chapter.visual).first();
        const v = await visual.boundingBox();
        expect(v, 'picture box').not.toBeNull();
        expect(v?.x ?? -1).toBeGreaterThanOrEqual(-1);
        expect((v?.x ?? 0) + (v?.width ?? 0)).toBeLessThanOrEqual(width + 1);
        await ((phone && chapter.phoneParts) || chapter.parts)(page);
        // A pinned chapter on a computer is centred and sized by what it shows: no empty half.
        if (chapter.pinned && live) {
          const gaps = await page.evaluate((root) => {
            const stage = document.querySelector(`${root} .pub-scene-stage`) as HTMLElement;
            const box = stage.getBoundingClientRect();
            let top = Number.POSITIVE_INFINITY;
            let bottom = Number.NEGATIVE_INFINITY;
            for (const element of stage.querySelectorAll('*')) {
              const r = element.getBoundingClientRect();
              if (r.width < 2 || r.height < 2) continue;
              if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
                continue;
              if (element.closest('svg.hs-arcs')) continue;
              top = Math.min(top, r.top);
              bottom = Math.max(bottom, r.bottom);
            }
            return {
              above: (top - box.top) / box.height,
              below: (box.bottom - bottom) / box.height,
              clipped: stage.scrollHeight > stage.clientHeight + 1,
            };
          }, chapter.root);
          expect(gaps.clipped, 'stage clips its content').toBe(false);
          expect(gaps.above, 'empty stretch above').toBeLessThan(0.3);
          expect(gaps.below, 'empty stretch below').toBeLessThan(0.3);
        }
        await save(page, run, chapter);
      });
    }

    test('no sideways scroll, and the page is within its height budget', async ({ page }) => {
      const result = await page.evaluate(() => ({
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        screens: document.documentElement.scrollHeight / window.innerHeight,
      }));
      expect(result.sideways).toBeLessThanOrEqual(0);
      expect(result.screens).toBeLessThanOrEqual(run.width > 600 ? 12 : 6 * 0.98);
    });
  });
}
