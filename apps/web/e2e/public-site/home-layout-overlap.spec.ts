import { type Page, expect, test } from '@playwright/test';

/**
 * WP-HOT1: no words on a public page may sit on top of each other, be cut off by their container,
 * or push the page sideways. Text is measured per line with Range.getClientRects on the text nodes
 * (not by element boxes), so wrapped words are measured where they really are. Only pictures marked
 * aria-hidden are left out (their layers overlap on purpose); size is never a reason to skip one.
 */

const SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

const MOTION = ['live', 'reduced'] as const;

type Problem = { kind: string; detail: string };

/**
 * Pictures whose layers are drawn to overlap or to be cropped by a rotated frame. The page marks
 * none of them aria-hidden (each is a labelled figure), so they are named here, one by one, never
 * by size: the hero phone (a tilted, cropped screen, frozen Harbor C1 art) and the pictures inside
 * the feature cards (cropped by their card on purpose).
 */
const LAYERED_PICTURES = ['.c1-devices', '.c1-feature > [class*="c1-card-art"], .c1-shot'] as const;

/** Runs in the page: returns every overlap, clipped line and sideways overflow it finds. */
async function measure(page: Page): Promise<Problem[]> {
  return page.evaluate(
    (layered) => {
      const TOLERANCE = 1;
      const problems: { kind: string; detail: string }[] = [];
      const boxes: { el: Element; text: string; r: DOMRect }[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const label = (el: Element) =>
        `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;

      function visible(el: Element): boolean {
        // Closed disclosures, hidden or see-through parts are not on screen.
        if (
          !el.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
            contentVisibilityAuto: true,
          })
        ) {
          return false;
        }
        for (let node: Element | null = el; node; node = node.parentElement) {
          if (node.closest('[aria-hidden="true"]') || node.closest(layered.join(','))) return false;
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          // Words read aloud but not drawn (1 px clipped) are not on screen.
          if (style.clipPath !== 'none' && style.clipPath.startsWith('inset(50%')) return false;
        }
        return true;
      }

      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
        if (!visible(el)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width < 1 || r.height < 1) continue;
          boxes.push({ el, text, r });
        }
      }

      // 1. Text from different elements must not intersect by more than the tolerance.
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (!a || !b || a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > TOLERANCE && h > TOLERANCE) {
            problems.push({
              kind: 'overlap',
              detail: `"${a.text.slice(0, 30)}" (${label(a.el)}) over "${b.text.slice(0, 30)}" (${label(b.el)}) by ${Math.round(w)}x${Math.round(h)}`,
            });
          }
        }
      }

      // 2. No line may be cut off by an ancestor that clips (hidden or clip), unless it scrolls.
      for (const { el, text, r } of boxes) {
        for (
          let node = el.parentElement;
          node && node !== document.documentElement;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          // A box the person scrolls (a swipe row) holds its words: what lies beyond is reachable.
          if (['auto', 'scroll'].includes(style.overflowX)) break;
          const clipsX = ['hidden', 'clip'].includes(style.overflowX);
          const clipsY = ['hidden', 'clip'].includes(style.overflowY);
          if (!clipsX && !clipsY) continue;
          const c = node.getBoundingClientRect();
          const cutX = clipsX && (r.left < c.left - TOLERANCE || r.right > c.right + TOLERANCE);
          const cutY = clipsY && (r.top < c.top - TOLERANCE || r.bottom > c.bottom + TOLERANCE);
          if (cutX || cutY) {
            problems.push({
              kind: 'clipped',
              detail: `"${text.slice(0, 30)}" (${label(el)}) cut off by ${label(node)}`,
            });
            break;
          }
        }
      }

      // 3. The page never scrolls sideways.
      const root = document.scrollingElement ?? document.documentElement;
      if (root.scrollWidth > window.innerWidth) {
        problems.push({
          kind: 'sideways',
          detail: `scrollWidth ${root.scrollWidth} > innerWidth ${window.innerWidth}`,
        });
      }
      return problems;
    },
    [...LAYERED_PICTURES],
  );
}

async function openAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Walk the page once so scroll-driven scenes and lazy parts reach their finished state.
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight / 2));
    const end = document.documentElement.scrollHeight;
    for (let y = 0; y <= end; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  // Let the header and any scroll-driven part come to rest at the top before measuring.
  await page.waitForTimeout(600);
}

for (const motion of MOTION) {
  for (const size of SIZES) {
    test.describe(`Home overlaps, ${motion} motion, ${size.width}x${size.height}`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
      });

      test('no words overlap, none are cut off, the page never scrolls sideways', async ({
        page,
      }) => {
        await openAndSettle(page, '/');
        const problems = await measure(page);
        expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
      });
    });
  }
}

// Baseline only: other public pages are measured and reported, not fixed here (HOT1 scope).
// Set HOT1_BASELINE=1 to run it; it prints findings and never fails.
const BASELINE_PAGES = ['/trust', '/privacy', '/terms'] as const;
for (const path of BASELINE_PAGES) {
  test.describe(`Baseline overlaps on ${path}`, () => {
    test.skip(
      !Object.hasOwn(process.env, 'HOT1_BASELINE'),
      'report-only baseline, run with HOT1_BASELINE=1',
    );
    for (const size of SIZES) {
      test(`${path} at ${size.width}x${size.height}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await openAndSettle(page, path);
        const problems = await measure(page);
        process.stdout.write(
          `BASELINE ${path} ${size.width}x${size.height}: ${JSON.stringify(problems)}\n`,
        );
      });
    }
  });
}
