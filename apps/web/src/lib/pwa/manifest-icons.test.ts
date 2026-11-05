import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import manifest from '../../app/manifest';

/**
 * Owner, 5 Nov 2026: the installed app's icon showed the tile on a white disc. A launcher that does
 * not use the maskable icon draws any transparent pixel on white, so every icon in the manifest
 * is a full-bleed, opaque square, and a maskable one exists at both sizes.
 */

const publicDir = join(__dirname, '..', '..', '..', 'public');

describe('the app manifest icons', () => {
  const icons = manifest().icons ?? [];

  it('lists each icon at its real size, and a maskable pair', () => {
    const purposes = icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(purposes).toContain('192x192:maskable');
    expect(purposes).toContain('512x512:maskable');
    expect(purposes).toContain('192x192:any');
    expect(purposes).toContain('512x512:any');
  });

  for (const icon of icons) {
    it(`${icon.src} has no transparent pixel and the size it says`, async () => {
      const file = readFileSync(join(publicDir, icon.src));
      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(`${info.width}x${info.height}`).toBe(icon.sizes);
      let transparent = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) transparent += 1;
      expect(transparent, 'transparent pixels').toBe(0);
    });
  }
});
