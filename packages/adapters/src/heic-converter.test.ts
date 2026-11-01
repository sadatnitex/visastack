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
import {
  decodePrimary,
  initialMemoryPages,
  limitModuleMemory,
  limitedDecoderModule,
} from './heic-worker.cjs';

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
  startedWorkers: { count: 0, mostAtOnce: 0 },
}));
vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:worker_threads')>();
  class TrackedWorker extends original.Worker {
    constructor(...args: ConstructorParameters<typeof original.Worker>) {
      super(...args);
      liveWorkers.add(this);
      startedWorkers.count += 1;
      startedWorkers.mostAtOnce = Math.max(startedWorkers.mostAtOnce, liveWorkers.size);
      this.once('exit', () => liveWorkers.delete(this));
    }
  }
  return { ...original, default: { ...original, Worker: TrackedWorker }, Worker: TrackedWorker };
});

/**
 * Wait until no conversion is running: the slot is given back only once the last thread has
 * ended, a moment after its answer arrived.
 */
async function idle(): Promise<void> {
  await vi.waitFor(() => expect(liveWorkers.size).toBe(0), { timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

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
    await idle();
    const converter = new HeicJpegConverter({ timeoutMs: 1 });
    expect(
      await refusal(converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: PIXELS })),
    ).toBe('too_slow');
  });

  it(
    'runs off the request thread: other work carries on while a large photo is decoded',
    { timeout: 120_000 },
    async () => {
      // What decoding this photo on the request thread costs, measured here on this machine: the
      // decode is one synchronous call, so it blocks this thread for its whole length.
      const require = createRequire(import.meta.url);
      const glue = require('libheif-js/libheif-wasm/libheif.js') as (options: object) => {
        ready: Promise<unknown>;
      };
      const inThread = glue({
        wasmBinary: readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm')),
        print: () => undefined,
        printErr: () => undefined,
      });
      await inThread.ready;
      const blockStart = Date.now();
      decodePrimary(inThread, MADE_UP_HEIC_HUGE, HUGE_PIXELS);
      const inThreadBlock = Date.now() - blockStart;
      expect(inThreadBlock).toBeGreaterThan(100);

      const converter = new HeicJpegConverter({ timeoutMs: 60_000 });
      // Warm up first, so loading the libraries is not counted.
      await converter.convert({ bytes: MADE_UP_HEIC_SMALL, maxInputPixels: PIXELS });
      let last = Date.now();
      let longestPause = 0;
      const ticker = setInterval(() => {
        const now = Date.now();
        longestPause = Math.max(longestPause, now - last);
        last = now;
      }, 5);
      try {
        const converted = await converter.convert({
          bytes: MADE_UP_HEIC_HUGE,
          maxInputPixels: HUGE_PIXELS,
        });
        expect([converted.width, converted.height]).toEqual([4096, 4096]);
      } finally {
        clearInterval(ticker);
      }
      // Off the request thread the timers keep running; on it, they would stop for at least the
      // whole decode measured above. Compared on the same machine in the same test, so a slow or
      // busy machine slows both alike.
      expect(longestPause).toBeLessThan(inThreadBlock / 2);
    },
  );

  it(
    'stops a decode part way through when the time limit passes, and ends its thread',
    { timeout: 120_000 },
    async () => {
      // How long a whole conversion of the large photo takes here, and how long one takes to get
      // going (thread start, decoder load) with a tiny photo.
      const whole = Date.now();
      await new HeicJpegConverter({ timeoutMs: 60_000 }).convert({
        bytes: MADE_UP_HEIC_HUGE,
        maxInputPixels: HUGE_PIXELS,
      });
      const wholeConversion = Date.now() - whole;
      const warmStart = Date.now();
      await new HeicJpegConverter({ timeoutMs: 60_000 }).convert({
        bytes: MADE_UP_HEIC_SMALL,
        maxInputPixels: PIXELS,
      });
      const startup = Date.now() - warmStart;
      // The limit passes while the large photo is being decoded: it is refused then, well before
      // the conversion would have finished.
      const timeoutMs = startup + 50;
      const startedAt = Date.now();
      expect(
        await refusal(
          new HeicJpegConverter({ timeoutMs }).convert({
            bytes: MADE_UP_HEIC_HUGE,
            maxInputPixels: HUGE_PIXELS,
          }),
        ),
      ).toBe('too_slow');
      expect(Date.now() - startedAt).toBeLessThan(wholeConversion);
      expect(startedWorkers.count).toBeGreaterThan(1);
      await vi.waitFor(() => expect(liveWorkers.size).toBe(0), { timeout: 10_000 });
    },
  );

  it(
    'converts one photo at a time per process; one waiting past its time limit is refused',
    { timeout: 120_000 },
    async () => {
      await idle();
      startedWorkers.mostAtOnce = 0;
      const converter = new HeicJpegConverter({ timeoutMs: 60_000 });
      const both = await Promise.all([
        converter.convert({ bytes: MADE_UP_HEIC_HUGE, maxInputPixels: HUGE_PIXELS }),
        converter.convert({ bytes: MADE_UP_HEIC_SMALL, maxInputPixels: PIXELS }),
        converter.convert({ bytes: MADE_UP_HEIC_LARGE, maxInputPixels: PIXELS }),
      ]);
      expect(both.map((c) => c.width)).toEqual([4096, 64, 1200]);
      expect(startedWorkers.mostAtOnce).toBe(1);

      // A second photo whose own limit passes while the first is still converting is refused
      // without ever starting, and the first carries on.
      const startedBefore = startedWorkers.count;
      const first = converter.convert({ bytes: MADE_UP_HEIC_HUGE, maxInputPixels: HUGE_PIXELS });
      const second = await refused(
        new HeicJpegConverter({ timeoutMs: 50 }).convert({
          bytes: MADE_UP_HEIC_SMALL,
          maxInputPixels: PIXELS,
        }),
      );
      expect(second.reason).toBe('unavailable');
      expect((await first).width).toBe(4096);
      // Only the first photo's thread was ever started.
      expect(startedWorkers.count).toBe(startedBefore + 1);
      expect(startedWorkers.mostAtOnce).toBe(1);
    },
  );

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
      limitedDecoderModule,
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

  // Compiling the whole decoder twice is CPU-bound and slow while other suites run beside it: an
  // explicit timeout (CLAUDE.md, heavy tests). The assertions are unchanged.
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
  }, 180_000);

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

describe('reading the decoded picture', () => {
  /** A stand-in for libheif-js that decodes to whatever plane it is given. */
  function fakeLibheif(
    declared: [number, number],
    plane: { width: number; height: number; stride: number; data: Uint8Array } | null,
    /** The size the decoded image itself reports, when it differs from its pixel plane. */
    imageSize?: [number, number],
  ) {
    const released: unknown[] = [];
    const interleaved = { name: 'interleaved' };
    const image = { name: 'decoded image' };
    return {
      released,
      libheif: {
        heif_colorspace: { heif_colorspace_RGB: 1 },
        heif_chroma: { heif_chroma_interleaved_RGBA: 2 },
        heif_channel: { heif_channel_interleaved: interleaved },
        heif_image_release: (img: unknown) => released.push(img),
        heif_js_decode_image2: () =>
          plane === null
            ? { code: 1, subcode: 1, message: 'failed' }
            : {
                image,
                width: imageSize?.[0] ?? plane.width,
                height: imageSize?.[1] ?? plane.height,
                channels: [{ id: interleaved, ...plane }],
              },
        HeifDecoder: class {
          decode() {
            return [
              {
                handle: 'primary',
                is_primary: () => true,
                get_width: () => declared[0],
                get_height: () => declared[1],
              },
            ];
          }
        },
      },
    };
  }

  const reasonOf = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return (error as { reason?: string }).reason;
    }
    return 'accepted';
  };

  it('refuses a decoded picture of another size than the declared one, and always lets it go', () => {
    const bigger = fakeLibheif([2, 2], {
      width: 3,
      height: 3,
      stride: 12,
      data: new Uint8Array(36),
    });
    expect(reasonOf(() => decodePrimary(bigger.libheif, new Uint8Array(1), 100))).toBe(
      'unreadable',
    );
    expect(bigger.released).toHaveLength(1);

    // The image says it has the declared size, but its pixel plane is larger.
    const planeBigger = fakeLibheif(
      [2, 2],
      { width: 3, height: 3, stride: 12, data: new Uint8Array(36) },
      [2, 2],
    );
    expect(reasonOf(() => decodePrimary(planeBigger.libheif, new Uint8Array(1), 100))).toBe(
      'unreadable',
    );
    expect(planeBigger.released).toHaveLength(1);

    const shortPlane = fakeLibheif([2, 2], {
      width: 2,
      height: 2,
      stride: 8,
      data: new Uint8Array(8),
    });
    expect(reasonOf(() => decodePrimary(shortPlane.libheif, new Uint8Array(1), 100))).toBe(
      'unreadable',
    );

    const failed = fakeLibheif([2, 2], null);
    expect(reasonOf(() => decodePrimary(failed.libheif, new Uint8Array(1), 100))).toBe(
      'unreadable',
    );
  });

  it('copies a decoded picture row by row, skipping the padding at the end of each row', () => {
    // Two rows of two pixels, each row padded to 12 bytes.
    const data = new Uint8Array(24);
    data.set([1, 1, 1, 1, 2, 2, 2, 2], 0);
    data.set([3, 3, 3, 3, 4, 4, 4, 4], 12);
    const padded = fakeLibheif([2, 2], { width: 2, height: 2, stride: 12, data });
    const pixels = decodePrimary(padded.libheif, new Uint8Array(1), 100);
    expect(Array.from(pixels.data)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
    expect(padded.released).toHaveLength(1);
  });
});

describe('the compiled decoder module', () => {
  it('is compiled once per ceiling and shared by every conversion', async () => {
    const first = await limitedDecoderModule(64 * MB);
    expect(await limitedDecoderModule(64 * MB)).toBe(first);
    expect(await limitedDecoderModule(128 * MB)).not.toBe(first);
    await expect(limitedDecoderModule(0)).rejects.toThrow(RangeError);
  });
});
