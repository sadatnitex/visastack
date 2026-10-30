#!/usr/bin/env node
/**
 * Proves the Render fallback image (apps/web/Dockerfile) can load and use the native pieces the
 * app needs, from the same place the server loads them: sharp (photo sizes and re-encoding),
 * @napi-rs/canvas (safe document previews) and the iPhone photo decoder (libheif-js, WebAssembly,
 * through @visastack/adapters/heic-worker). Each one is kept out of the server bundle
 * (next.config.mjs), so a missing file only shows up at run time; this finds it at build time.
 *
 * Run inside the image: node apps/web/scripts/container-self-test.mjs
 * Prints one line per check and exits 1 if any fails. Reads no settings and makes no request.
 */
import { createRequire } from 'node:module';

// Resolve exactly as the server does: from apps/web, where server.js lives.
const require = createRequire(new URL('../server.js', import.meta.url));

const checks = [
  [
    'sharp makes a small PNG',
    async () => {
      const sharp = require('sharp');
      const png = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer();
      return png.length > 0;
    },
  ],
  [
    '@napi-rs/canvas draws a small PNG',
    async () => {
      const { createCanvas } = require('@napi-rs/canvas');
      const canvas = createCanvas(4, 4);
      canvas.getContext('2d').fillRect(0, 0, 4, 4);
      return (await canvas.encode('png')).length > 0;
    },
  ],
  [
    'the iPhone photo decoder compiles with its memory ceiling',
    async () => {
      const worker = require('@visastack/adapters/heic-worker');
      const decoder = await worker.limitedDecoderModule(64 * 1024 * 1024);
      const fromWorker = createRequire(worker.workerFile);
      fromWorker.resolve('libheif-js/libheif-wasm/libheif.js');
      return decoder instanceof WebAssembly.Module;
    },
  ],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    const ok = await check();
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? 'ok' : 'FAILED'} - ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAILED - ${name}: ${error instanceof Error ? error.message : error}\n`);
  }
}
process.exit(failed === 0 ? 0 : 1);
