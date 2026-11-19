import { type Page, expect, test } from '@playwright/test';

/**
 * MOT1 (owner decisions, 18 Nov 2026, ADR 0029 amendment): phones, short windows and zoomed windows
 * get light "reveal" motion instead of still pictures: each scene plays its steps once as it comes
 * into view, never pins and never adds page height. Reduced motion gets the "gentle" mode (fades,
 * moves of 8 px or less), data saver never stops motion, and wide, tall screens keep the pinned
 * scroll scenes.
 */

const SCENES = ['hero', 'add', 'ready', 'journey', 'share'] as const;
/** The step each Home scene rests on, finished. */
const FINAL: Record<(typeof SCENES)[number], string> = {
  hero: '5',
  add: '2',
  ready: '2',
  journey: '0',
  share: '3',
};
/** Where each scene ends after playing in reveal mode: the journey plays on to its last stage (PUBFIX2 P2-7). */
const PLAYED_TO: Record<(typeof SCENES)[number], string> = { ...FINAL, journey: '6' };

const html = (page: Page) => page.locator('html');

async function openHome(page: Page, width = 390, height = 844): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('#hs-hero-title')).toBeVisible();
}

/** Waits for the page to paint two frames, so the observers have seen the new scroll position. */
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/** Scrolls 0.7 of a screen at a time to the bottom, one painted frame after each jump. */
async function scrollThrough(page: Page): Promise<void> {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => window.innerHeight * 0.7);
  for (let y = 0; y < total; y += step) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await frames(page);
  }
}

/** Waits (on attributes) until every scene on screen rests: nothing playing, nothing about to play. */
async function inViewRests(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const share = (el: Element) => {
      const box = el.getBoundingClientRect();
      const shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
      return box.height > 0 ? Math.max(0, shown) / box.height : 0;
    };
    return ![...document.querySelectorAll('[data-scene]')].some((el) => {
      if (share(el) === 0) return false;
      const state = el.getAttribute('data-reveal');
      if (state === null || state === 'playing') return true;
      if (state === 'ready') return share(el) >= 0.25;
      return el.getAttribute('data-step') !== el.getAttribute('data-rest');
    });
  });
}

test.describe('phone, 390 x 844, motion welcome', () => {
  test('marks the page revealing and pins nothing', async ({ page }) => {
    await openHome(page);
    await expect(html(page)).toHaveAttribute('data-scenes', 'reveal');
    await expect(html(page)).toHaveAttribute('data-scene-mode', 'reveal');
    for (const name of SCENES) {
      const stage = page.locator(`[data-scene="${name}"] .pub-scene-stage`);
      await expect(stage, name).not.toHaveCSS('position', 'sticky');
    }
  });

  test('each scene plays its steps once as it comes into view and rests finished', async ({
    page,
  }) => {
    await openHome(page);
    // The hero is on screen at once: it plays by itself.
    const hero = page.locator('[data-scene="hero"]');
    await expect(hero).toHaveAttribute('data-reveal', 'done', { timeout: 8000 });
    await expect(hero).toHaveAttribute('data-step', FINAL.hero);
    // A scene far below keeps the server's finished step until it is near.
    const share = page.locator('[data-scene="share"]');
    await expect(share).not.toHaveAttribute('data-reveal', /playing|done/);
    await share.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const el = document.querySelector('[data-scene="share"]') as HTMLElement;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120);
    });
    await expect(share).toHaveAttribute('data-reveal', /playing|done/, { timeout: 4000 });
    await expect(share).toHaveAttribute('data-reveal', /^(done|snapped)$/, { timeout: 8000 });
    await expect(share).toHaveAttribute('data-step', FINAL.share);
    // Once: leaving and coming back never plays it again.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await frames(page);
    await share.scrollIntoViewIfNeeded();
    await expect(share).toHaveAttribute('data-reveal', /^(done|snapped)$/);
    await expect(share).toHaveAttribute('data-step', FINAL.share);
  });

  test('every scene ends finished after a scroll through the page, and nothing is left half drawn', async ({
    page,
  }) => {
    await openHome(page);
    await scrollThrough(page);
    for (const name of SCENES) {
      const scene = page.locator(`[data-scene="${name}"]`);
      await expect(scene, name).toHaveAttribute('data-reveal', /^(done|snapped)$/);
      await expect(scene, name).toHaveAttribute('data-step', PLAYED_TO[name]);
      expect(await scene.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--p'))).toBe(
        '',
      );
    }
  });

  test('stays within the phone page budget (6 screens) and never scrolls sideways', async ({
    page,
  }) => {
    await openHome(page);
    await scrollThrough(page);
    const size = await page.evaluate(() => ({
      screens: document.documentElement.scrollHeight / window.innerHeight,
      wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    expect(size.screens).toBeLessThanOrEqual(6);
    expect(size.wide).toBe(false);
  });

  test('adds no layout shift while scenes play (CLS under 0.05)', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
        }>)
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await openHome(page);
    await scrollThrough(page);
    await inViewRests(page);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.05);
  });

  test('plain meaning tiles on How It Works stay plain finished content, nothing to press', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/how-it-works');
    await expect(html(page)).toHaveAttribute('data-scenes', 'reveal');
    await expect(page.locator('.hk-flip-grid button')).toHaveCount(0);
    const tiles = page.locator('.hk-flip-static');
    expect(await tiles.count()).toBeGreaterThan(0);
    await expect(tiles.first()).toBeVisible();
  });
});

test.describe('other screens that now reveal', () => {
  test('a short desktop window reveals instead of staying still', async ({ page }) => {
    await openHome(page, 1280, 560);
    await expect(html(page)).toHaveAttribute('data-scene-mode', 'reveal');
    await expect(page.locator('[data-scene="hero"]')).toHaveAttribute('data-reveal', 'done', {
      timeout: 8000,
    });
    await expect(page.locator('[data-scene="hero"] .pub-scene-stage')).not.toHaveCSS(
      'position',
      'sticky',
    );
  });

  test('a tall desktop window keeps the pinned scroll scenes', async ({ page }) => {
    await openHome(page, 1280, 800);
    await expect(html(page)).toHaveAttribute('data-scenes', 'live');
    await expect(html(page)).toHaveAttribute('data-scene-mode', 'pinned');
    await expect(page.locator('[data-scene="hero"] .pub-scene-stage')).toHaveCSS(
      'position',
      'sticky',
    );
  });
});

test.describe('gentle: reduced motion (owner, 18 Nov 2026: "what\'s best for user experience ,if that\'s gentle fading, do that")', () => {
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    test(`plays the same steps as fades at ${width} x ${height}, never pins and ends finished`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openHome(page, width, height);
      await expect(html(page)).toHaveAttribute('data-scenes', 'gentle');
      await expect(html(page)).toHaveAttribute('data-scene-mode', 'gentle');
      await scrollThrough(page);
      for (const name of SCENES) {
        const scene = page.locator(`[data-scene="${name}"]`);
        await expect(scene, name).toHaveAttribute('data-reveal', /^(done|snapped)$/, {
          timeout: 8000,
        });
        await expect(scene, name).toHaveAttribute('data-step', FINAL[name]);
        await expect(scene, name).toHaveAttribute('data-rest', FINAL[name]);
        for (const position of ['sticky', 'fixed'])
          await expect(scene.locator('.pub-scene-stage'), name).not.toHaveCSS('position', position);
      }
    });
  }

  test('fades with opacity and colour only: no sliding progress, transitions of at most 0.4 s', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page, 390, 844);
    await page.evaluate(() => {
      const add = document.querySelector('[data-scene="add"]') as HTMLElement;
      window.scrollTo({
        top: add.getBoundingClientRect().top + window.scrollY - 70,
        behavior: 'instant',
      });
    });
    const seen = await page.evaluate(async () => {
      const progress: string[] = [];
      const durations = new Set<string>();
      const properties = new Set<string>();
      const hero = document.querySelector('[data-scene="add"]') as HTMLElement;
      const end = Date.now() + 4500;
      while (Date.now() < end) {
        progress.push(hero.style.getPropertyValue('--p'));
        for (const el of hero.querySelectorAll<HTMLElement>('.kit-field, .kit-switch, .kit-tab')) {
          const style = getComputedStyle(el);
          durations.add(style.transitionDuration);
          properties.add(style.transitionProperty);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { progress, durations: [...durations], properties: [...properties] };
    });
    // Gentle mode never writes the progress that slides or scales pictures.
    expect(seen.progress.filter((value) => value !== '')).toEqual([]);
    // The global reduced-motion rule is overridden for these parts only: fades, 0.4 s at most.
    for (const list of seen.durations)
      for (const part of list.split(',')) expect(Number.parseFloat(part)).toBeLessThanOrEqual(0.4);
    expect(seen.durations.join()).toContain('0.4s');
    for (const list of seen.properties)
      expect(list).not.toMatch(/transform|all|width|height|top|left|margin/);
  });

  test('changes a scene at most three times a second', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const w = window as unknown as { __steps: Array<{ at: number; scene: string }> };
      w.__steps = [];
      new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target as Element;
          if (record.attributeName === 'data-step' && target.hasAttribute('data-reveal'))
            w.__steps.push({ at: Date.now(), scene: target.getAttribute('data-scene') ?? '' });
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-step'] });
    });
    await openHome(page, 390, 844);
    await scrollThrough(page);
    for (const name of SCENES)
      await expect(page.locator(`[data-scene="${name}"]`), name).toHaveAttribute(
        'data-reveal',
        /^(done|snapped)$/,
      );
    const changes = await page.evaluate(
      () => (window as unknown as { __steps: Array<{ at: number; scene: string }> }).__steps,
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const name of SCENES) {
      const times = changes.filter((change) => change.scene === name).map((change) => change.at);
      for (let at = 0; at + 3 < times.length; at++)
        // Any four changes of one scene take at least one second: never more than three a second.
        expect((times[at + 3] ?? 0) - (times[at] ?? 0), name).toBeGreaterThanOrEqual(1000);
    }
  });
});

test.describe('data saver never stops motion (owner, 18 Nov 2026)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
    });
  });

  test('a phone still reveals and plays', async ({ page }) => {
    await openHome(page);
    await expect(html(page)).toHaveAttribute('data-scenes', 'reveal');
    await expect(page.locator('[data-scene="hero"]')).toHaveAttribute('data-reveal', 'done', {
      timeout: 8000,
    });
  });

  test('a big screen still pins', async ({ page }) => {
    await openHome(page, 1280, 800);
    await expect(html(page)).toHaveAttribute('data-scenes', 'live');
    await expect(page.locator('[data-scene="hero"] .pub-scene-stage')).toHaveCSS(
      'position',
      'sticky',
    );
  });
});

test('switching between pinned and reveal on resize or rotation needs no reload and leaves nothing half drawn', async ({
  page,
}) => {
  await openHome(page, 1280, 800);
  await expect(html(page)).toHaveAttribute('data-scene-mode', 'pinned');
  // Wait until the scroll engine has really started (it writes the progress), so this is a switch
  // of a running page and not the first start at the new size.
  await expect
    .poll(() =>
      page
        .locator('[data-scene="hero"]')
        .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--p')),
    )
    .not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(html(page)).toHaveAttribute('data-scene-mode', 'reveal');
  await expect(html(page)).toHaveAttribute('data-scenes', 'reveal');
  for (const name of SCENES) {
    const scene = page.locator(`[data-scene="${name}"]`);
    // Scenes already on screen or passed rest finished and never replay. A scene still below the
    // screen is finished, or waits at its first step ("ready", off screen) until it comes into
    // view. None is ever left part way.
    const state = await scene.evaluate((el) => ({
      step: el.getAttribute('data-step'),
      reveal: el.getAttribute('data-reveal'),
      onScreen: el.getBoundingClientRect().top < window.innerHeight,
    }));
    if (state.reveal === 'ready') {
      expect(state.step, `${name} waiting`).toBe('0');
      expect(state.onScreen, `${name} waiting on screen`).toBe(false);
    } else expect(state.step, name).toBe(FINAL[name]);
    await expect(scene.locator('.pub-scene-stage'), name).not.toHaveCSS('position', 'sticky');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(html(page)).toHaveAttribute('data-scene-mode', 'pinned');
  await expect(html(page)).toHaveAttribute('data-scenes', 'live');
  await expect(page.locator('[data-scene="hero"]')).not.toHaveAttribute('data-reveal', /.*/);
  await expect(page.locator('[data-scene="hero"] .pub-scene-stage')).toHaveCSS(
    'position',
    'sticky',
  );
});

for (const [width, height] of [
  [390, 844],
  [1280, 800],
] as const)
  test(`the Privacy and Trust page shifts nothing while its hero plays (CLS under 0.05) at ${width} x ${height}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{
          value: number;
          hadRecentInput: boolean;
        }>)
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.setViewportSize({ width, height });
    await page.goto('/trust');
    // The Pause button is in the markup from the start, idle; it becomes usable once the page is alive.
    const pause = page.getByRole('button', { name: 'Pause the Animation' });
    await expect(pause).toBeVisible();
    // The loop moves on by itself (a step change, never a fixed time).
    await expect(page.locator('.tr-share-live .kit-sheet')).not.toHaveAttribute(
      'data-kit-step',
      '0',
      {
        timeout: 6000,
      },
    );
    await scrollThrough(page);
    await frames(page);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.05);
  });
