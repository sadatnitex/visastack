import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lists which screens changed between two captures made by capture.mjs on the same machine.
 *
 *   node scripts/ui-baseline/compare.mjs /tmp/ui/before /tmp/ui/after
 *
 * Exit 0: every screen is the same (a rare wobble of a few pixels is counted as the same).
 * Exit 1: the changed, added and removed screens are listed with how many pixels differ, and a
 * person looks at each pair. A change is not a failure of the change; an unexpected change on a
 * screen the work was not meant to touch is.
 *
 * UI_BASELINE_TOLERANCE sets how many differing pixels still count as the same (default 300).
 */

export function hashes(directory) {
  const result = new Map();
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.png'))) {
    result.set(
      name,
      createHash('sha256')
        .update(readFileSync(join(directory, name)))
        .digest('hex'),
    );
  }
  return result;
}

export function diff(before, after) {
  const changed = [];
  const added = [];
  const removed = [];
  for (const [name, hash] of after) {
    if (!before.has(name)) added.push(name);
    else if (before.get(name) !== hash) changed.push(name);
  }
  for (const name of before.keys()) if (!after.has(name)) removed.push(name);
  return { changed, added, removed };
}

/** Counts pixels that differ by more than a small amount in any colour channel. */
export function pixelDifference(page, beforeBytes, afterBytes) {
  return page.evaluate(
    async ([a, b]) => {
      const load = (data) =>
        new Promise((resolveImage, reject) => {
          const image = new Image();
          image.onload = () => resolveImage(image);
          image.onerror = reject;
          image.src = `data:image/png;base64,${data}`;
        });
      const [first, second] = await Promise.all([load(a), load(b)]);
      if (first.width !== second.width || first.height !== second.height)
        return { pixels: -1, size: [first.width, first.height, second.width, second.height] };
      const read = (image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const x = read(first);
      const y = read(second);
      let pixels = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (
          Math.abs(x[i] - y[i]) > 24 ||
          Math.abs(x[i + 1] - y[i + 1]) > 24 ||
          Math.abs(x[i + 2] - y[i + 2]) > 24
        )
          pixels += 1;
      }
      return { pixels };
    },
    [beforeBytes.toString('base64'), afterBytes.toString('base64')],
  );
}

async function main(beforeDirectory, afterDirectory) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
  const tolerance = Number(process.env.UI_BASELINE_TOLERANCE ?? 300);
  const { changed, added, removed } = diff(hashes(beforeDirectory), hashes(afterDirectory));
  const real = [];
  let wobble = 0;
  if (changed.length) {
    const executablePath = process.env.UI_BASELINE_CHROMIUM ?? '/opt/pw-browsers/chromium';
    const browser = await chromium
      .launch({ executablePath, args: ['--no-sandbox'] })
      .catch(() => chromium.launch());
    const page = await browser.newPage();
    for (const name of changed) {
      const result = await pixelDifference(
        page,
        readFileSync(join(beforeDirectory, name)),
        readFileSync(join(afterDirectory, name)),
      );
      if (result.pixels === -1) real.push(`${name} (size changed: ${result.size.join(' x ')})`);
      else if (result.pixels > tolerance) real.push(`${name} (${result.pixels} pixels differ)`);
      else wobble += 1;
    }
    await browser.close();
  }
  const same = !real.length && !added.length && !removed.length;
  for (const [label, list] of [
    ['Changed', real],
    ['Added', added],
    ['Removed', removed],
  ])
    if (list.length) process.stdout.write(`${label} (${list.length}):\n  ${list.join('\n  ')}\n`);
  if (wobble)
    process.stdout.write(
      `${wobble} screen(s) differed by only a few pixels and count as the same\n`,
    );
  process.stdout.write(same ? 'All screens match\n' : '');
  process.exitCode = same ? 0 : 1;
}

const [beforeDirectory, afterDirectory] = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (beforeDirectory && afterDirectory) await main(beforeDirectory, afterDirectory);
  else {
    console.error(
      'Usage: node scripts/ui-baseline/compare.mjs <before-directory> <after-directory>',
    );
    process.exitCode = 2;
  }
}
