import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  HeicConversionError,
  HeicJpegConverter,
  decoderMemoryCeiling,
  looksLikeHeic,
} from './heic-converter';
import { MADE_UP_HEIC_HUGE, MADE_UP_HEIC_LARGE, MADE_UP_HEIC_SMALL } from './heic-fixtures';
import { initialMemoryPages, limitModuleMemory } from './heic-worker.cjs';

const PIXELS = 40_000_000;

async function refused(promise: Promise<unknown>): Promise<HeicConversionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HeicConversionError) return error;
    throw error;
  }
  throw new Error('the conversion was expected to be refused');
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  return (await refused(promise)).reason;
}

const MB = 1024 * 1024;
const HUGE_PIXELS = 4096 * 4096;

/** The same bytes with the size the container declares (its `ispe` box) changed. */
function declaringSize(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const copy = Buffer.from(bytes);
  const at = copy.indexOf('ispe');
  expect(at).toBeGreaterThan(0);
  copy.writeUInt32BE(width, at + 8);
  copy.writeUInt32BE(height, at + 12);
  return new Uint8Array(copy);
}

// Every worker thread the converter starts, kept until it has exited, to show none outlives its
// conversion.
const { liveWorkers, startedWorkers } = vi.hoisted(() => ({
  liveWorkers: new Set<object>(),
  startedWorkers: { count: 0 },
}));
vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:worker_threads')>();
  class TrackedWorker extends original.Worker {
    constructor(...args: ConstructorParameters<typeof original.Worker>) {
      super(...args);
      liveWorkers.add(this);
      startedWorkers.count += 1;
      this.once('exit', () => liveWorkers.delete(this));
    }
  }
  return { ...original, default: { ...original, Worker: TrackedWorker }, Worker: TrackedWorker };
});

describe('iPhone photo (HEIC) conversion', () => {
  it('recognises a HEIC file by its signature and nothing else', () => {
    expect(looksLikeHeic(MADE_UP_HEIC_SMALL)).toBe(true);
    expect(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]))).toBe(
      false,
    );
    // An AVIF picture uses the same container with another brand; it is not taken for a HEIC.
    const avif = new Uint8Array(MADE_UP_HEIC_SMALL);
    avif.set([0x61, 0x76, 0x69, 0x66], 8);
    expect(looksLikeHeic(avif)).toBe(false);
    expect(looksLikeHeic(new Uint8Array(8))).toBe(false);
  });

  it('makes a new JPEG with the same picture, the same size and none of the original metadata', async () => {
    const converted = await new HeicJpegConverter().convert({
      bytes: MADE_UP_HEIC_SMALL,
      maxInputPixels: PIXELS,
    });
    expect([converted.width, converted.height]).toEqual([64, 48]);
    expect(Array.from(converted.bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);

    const metadata = await sharp(converted.bytes).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(Buffer.from(converted.bytes).includes('MadeUpCam')).toBe(false);
    expect(Buffer.from(MADE_UP_HEIC_SMALL).includes('MadeUpCam')).toBe(true);

    // The four quarters keep their colours: red, green, blue and white.
    const { data, info } = await sharp(converted.bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    };
    const near = (actual: number[], expected: number[]) =>
      actual.every((value, i) => Math.abs(value - (expected[i] ?? 0)) < 40);
    expect(near(at(8, 8), [220, 20, 20])).toBe(true);
    expect(near(at(56, 8), [20, 180, 20])).toBe(true);
    expect(near(at(8, 40), [20, 20, 220])).toBe(true);
    expect(near(at(56, 40), [255, 255, 255])).toBe(true);
  });

  it('refuses a photo above the pixel budget before decoding it', async () => {
    const converter = new HeicJpegConverter();
    expect(
      await refusal(converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: 1_000_000 })),
    ).toBe('too_large');
    const fits = await converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: 1_200_000 });
    expect([fits.width, fits.height]).toEqual([1200, 1000]);
  });

  it('refuses anything that is not a readable HEIC, without throwing anything else', async () => {
    const converter = new HeicJpegConverter();
    expect(
      await refusal(converter.convert({ bytes: new Uint8Array(64), maxInputPixels: PIXELS })),
    ).toBe('not_heic');
    // The right signature in front of nonsense: the decoder cannot read it.
    const broken = new Uint8Array(MADE_UP_HEIC_SMALL.subarray(0, 40));
    expect(await refusal(converter.convert({ bytes: broken, maxInputPixels: PIXELS }))).toBe(
      'unreadable',
    );
    // A cut-off file: the container reads but the picture data is gone.
    const truncated = new Uint8Array(
      MADE_UP_HEIC_SMALL.subarray(0, MADE_UP_HEIC_SMALL.byteLength - 300),
    );
    expect(await refusal(converter.convert({ bytes: truncated, maxInputPixels: PIXELS }))).toBe(
      'unreadable',
    );
  });

  it('gives up when a conversion runs past its time limit', async () => {
    const converter = new HeicJpegConverter({ timeoutMs: 1 });
    expect(
      await refusal(converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: PIXELS })),
    ).toBe('too_slow');
  });

  it('runs off the request thread: other work carries on while a large photo is decoded', async () => {
    const converter = new HeicJpegConverter();
    // Warm up first, so loading the libraries is not counted.
    await converter.convert({ bytes: MADE_UP_HEIC_SMALL, maxInputPixels: PIXELS });
    let last = Date.now();
    let longestPause = 0;
    const ticker = setInterval(() => {
      const now = Date.now();
      longestPause = Math.max(longestPause, now - last);
      last = now;
    }, 5);
    const startedAt = Date.now();
    try {
      const converted = await converter.convert({
        bytes: MADE_UP_HEIC_HUGE,
        maxInputPixels: HUGE_PIXELS,
      });
      expect([converted.width, converted.height]).toEqual([4096, 4096]);
    } finally {
      clearInterval(ticker);
    }
    // Decoding 16.8 megapixels takes far longer than this; on the request thread it froze the
    // timers for the whole decode.
    expect(Date.now() - startedAt).toBeGreaterThan(longestPause);
    expect(longestPause).toBeLessThan(200);
  });

  it('stops a decode part way through when the time limit passes, and ends its thread', async () => {
    // How long a conversion takes to get going (thread start, decoder load) with a tiny photo.
    const warmStart = Date.now();
    await new HeicJpegConverter().convert({ bytes: MADE_UP_HEIC_SMALL, maxInputPixels: PIXELS });
    const startup = Date.now() - warmStart;
    // The limit passes while the large photo is being decoded, which alone takes over half a
    // second; a decode on the request thread could only be refused once it had finished.
    const timeoutMs = startup + 100;
    const startedAt = Date.now();
    expect(
      await refusal(
        new HeicJpegConverter({ timeoutMs }).convert({
          bytes: MADE_UP_HEIC_HUGE,
          maxInputPixels: HUGE_PIXELS,
        }),
      ),
    ).toBe('too_slow');
    expect(Date.now() - startedAt).toBeLessThan(timeoutMs + 250);
    expect(startedWorkers.count).toBeGreaterThan(1);
    await vi.waitFor(() => expect(liveWorkers.size).toBe(0), { timeout: 5_000 });
  });

  it('caps the memory the decoder may take, so a decode past the ceiling is refused', async () => {
    const fits = await new HeicJpegConverter().convert({
      bytes: MADE_UP_HEIC_HUGE,
      maxInputPixels: HUGE_PIXELS,
    });
    expect(fits.decoderMemoryBytes).toBeGreaterThan(64 * MB);
    expect(fits.decoderMemoryBytes).toBeLessThanOrEqual(decoderMemoryCeiling(HUGE_PIXELS));

    const capped = await refused(
      new HeicJpegConverter({ maxDecoderMemoryBytes: 64 * MB }).convert({
        bytes: MADE_UP_HEIC_HUGE,
        maxInputPixels: HUGE_PIXELS,
      }),
    );
    expect(capped.reason).toBe('unreadable');
    expect(capped.decoderMemoryBytes).toBeGreaterThan(0);
    expect(capped.decoderMemoryBytes).toBeLessThanOrEqual(64 * MB);
  });

  it('refuses a picture larger than the size its container declares, before decoding it', async () => {
    // The container says 64 x 48 (inside any budget); the picture inside is 4096 x 4096.
    const crafted = declaringSize(MADE_UP_HEIC_HUGE, 64, 48);
    const error = await refused(
      new HeicJpegConverter().convert({ bytes: crafted, maxInputPixels: 1_000_000 }),
    );
    expect(error.reason).toBe('unreadable');
    // No room was ever made for the real picture (it needs over 100 MB).
    expect(error.decoderMemoryBytes).toBeLessThan(32 * MB);
  });

  it('a decoder that cannot start refuses the photo instead of converting it some other way', async () => {
    vi.resetModules();
    vi.doMock('@visastack/adapters/heic-worker', () => ({
      workerFile: '/nowhere/heic-worker.cjs',
    }));
    try {
      const fresh = await import('./heic-converter');
      const error = await fresh.HeicJpegConverter.prototype.convert
        .call(new fresh.HeicJpegConverter(), { bytes: MADE_UP_HEIC_SMALL, maxInputPixels: PIXELS })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(fresh.HeicConversionError);
      expect((error as InstanceType<typeof fresh.HeicConversionError>).reason).toBe('unavailable');
    } finally {
      vi.doUnmock('@visastack/adapters/heic-worker');
      vi.resetModules();
    }
  });
});

// The WebAssembly global, typed here because this package's settings leave out browser types.
const wasm = (
  globalThis as unknown as { WebAssembly: { Module: new (bytes: Uint8Array) => object } }
).WebAssembly;

describe('the decoder memory ceiling', () => {
  const require = createRequire(import.meta.url);
  const binary = new Uint8Array(
    readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm')),
  );

  it('rewrites only the memory maximum, and the module still loads with the lower ceiling', () => {
    const initial = initialMemoryPages(binary);
    expect(initial).toBeGreaterThan(0);
    const limited = limitModuleMemory(binary, initial + 100);
    expect(limited.byteLength).toBe(binary.byteLength);
    const changed = limited.reduce((count, byte, i) => count + (byte === binary[i] ? 0 : 1), 0);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(3);
    // Still a valid module, now with the lower maximum.
    expect(() => new wasm.Module(limited)).not.toThrow();
    expect(limitModuleMemory(limited, initial + 200)).toEqual(limited);
    expect(limitModuleMemory(limited, initial + 50)).not.toEqual(limited);
    // The original is left as it was.
    expect(limitModuleMemory(binary, 65_536)).toEqual(binary);
  });

  it('never sets a ceiling below what the module starts with, or outside WebAssembly limits', () => {
    const initial = initialMemoryPages(binary);
    expect(() => limitModuleMemory(binary, initial - 1)).toThrow(RangeError);
    expect(() => limitModuleMemory(binary, 0)).toThrow(RangeError);
    expect(() => limitModuleMemory(binary, 65_537)).toThrow(RangeError);
    expect(() => limitModuleMemory(new Uint8Array(16), initial)).toThrow();
  });

  it('is sized from the pixel budget', () => {
    expect(decoderMemoryCeiling(40_000_000)).toBe(48 * MB + 400_000_000);
    expect(decoderMemoryCeiling(1)).toBeGreaterThan(16 * MB);
  });
});
