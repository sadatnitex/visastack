/**
 * iPhone photo conversion (UX-B): turns an untrusted HEIC or HEIF upload into a brand-new JPEG
 * before anything is stored, so every later step (the safety checks, storage, previews, the
 * reading pipeline, sharing) only ever meets a format it already handles.
 *
 * The prebuilt image library (sharp) cannot decode HEIC: its HEIF support is the AV1 kind (AVIF)
 * only, because the HEVC codec is not part of its build. Decoding therefore uses libheif compiled
 * to WebAssembly (`libheif-js`): no native code, and the decoder runs inside the WebAssembly
 * sandbox's own memory, so a malformed file cannot reach the host process memory the way a
 * native decoder bug could. sharp then only encodes plain pixels.
 *
 * Isolation: every photo is decoded and encoded in a worker thread of its own (heic-worker.cjs),
 * started for that one photo and ended afterwards whatever happened:
 * - the request thread never runs the decoder, which is synchronous, so other requests carry on
 *   and the deadline below can stop a conversion part way through (`worker.terminate()`);
 * - ending the thread frees all the decoder's memory, so a failure part way through leaks nothing;
 * - the decoder's WebAssembly memory has a hard ceiling sized from the pixel budget, and the
 *   thread's JavaScript heap has its own limit (see heic-worker.cjs for exactly what bounds what).
 *
 * Limits, all checked before the expensive step they protect:
 * - the bytes must carry a HEIF file signature with a HEVC or HEIF brand;
 * - the primary image's declared size must fit the pixel budget before any pixel is decoded;
 * - one deadline covers the whole conversion, thread start included.
 * A crash, a heap or memory ceiling reached, or anything unexpected reads as `unreadable`; the
 * deadline reads as `too_slow`; a thread or decoder that cannot start reads as `unavailable`, and
 * the photo is refused (there is no fallback that decodes on the request thread).
 *
 * Nothing from the original is carried over: a fresh encode keeps only pixels, so EXIF (camera,
 * location), XMP and other metadata are dropped. The rotation is already applied by the decoder.
 * The original bytes are never written anywhere by this module.
 */

import { Worker } from 'node:worker_threads';

export interface HeicConversionInput {
  readonly bytes: Uint8Array;
  /** The largest picture accepted, in pixels (width times height). */
  readonly maxInputPixels: number;
}

export interface HeicConversionResult {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** How much memory the decoder had at the end, in bytes (a count, for checks and logs). */
  readonly decoderMemoryBytes: number;
}

/** Why a photo could not be converted, for the caller's plain message. */
export type HeicConversionFailure =
  | 'not_heic'
  | 'too_large'
  | 'unreadable'
  | 'too_slow'
  | 'unavailable';

export class HeicConversionError extends Error {
  constructor(
    readonly reason: HeicConversionFailure,
    /** How much memory the decoder had when it stopped, in bytes, when known. */
    readonly decoderMemoryBytes: number | null = null,
  ) {
    super(`heic conversion failed: ${reason}`);
  }
}

export interface HeicJpegConverterOptions {
  /** How long one photo may take before it is refused (default 20 seconds). */
  readonly timeoutMs?: number;
  /** JPEG quality, 1 to 100 (default 88: visually lossless for documents, about twice the HEIC size). */
  readonly quality?: number;
  /**
   * The most memory the decoder may use, in bytes. By default it is sized from the pixel budget
   * (`decoderMemoryCeiling`), so a crafted file can never make the decoder take more memory than
   * the largest photo that is accepted anyway.
   */
  readonly maxDecoderMemoryBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_QUALITY = 88;

/**
 * The decoder's memory ceiling for a pixel budget: what the decoder needs for its own code and
 * data (about 16 MB) plus room for one picture of the largest accepted size. Decoding needs about
 * 7.5 bytes per pixel (measured: 133 MB for 4096 x 4096, 381 MB for 8000 x 6000), so 10 bytes per
 * pixel plus 48 MB leaves headroom, and the 40 megapixel budget gives about 450 MB.
 */
export function decoderMemoryCeiling(maxInputPixels: number): number {
  return 48 * 1024 * 1024 + maxInputPixels * 10;
}

/**
 * The thread's own JavaScript heap. The decoder's memory and the pixels are outside it; these
 * only bound the JavaScript the thread runs (the decoder's glue code and a few small objects).
 */
const WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
} as const;

/**
 * Major brands of HEIF files holding HEVC pictures (and the generic HEIF ones iPhones and other
 * phones write). AVIF ("avif", "avis") is left out on purpose: it is not what phones send, and
 * the decoder here only reads HEVC.
 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * True when the bytes start like a HEIF file: an `ftyp` box at the very start whose major brand is
 * one of the HEIC or HEIF brands. Cheap, and never decodes anything.
 */
export function looksLikeHeic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (text(4, 8) !== 'ftyp') return false;
  return HEIF_BRANDS.has(text(8, 12));
}

interface WorkerOutcome {
  readonly ok: boolean;
  readonly reason?: unknown;
  readonly bytes?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly decoderMemoryBytes?: unknown;
}

const WORKER_REASONS: ReadonlySet<string> = new Set<HeicConversionFailure>([
  'too_large',
  'unreadable',
  'unavailable',
]);

// sharp must be loaded on the main thread before any worker thread loads it, so its shared
// libraries stay loaded until every thread has ended (sharp's own guidance for worker threads).
const loadSharp = async () => (await import('sharp')).default;
// The worker file's real path. The web build keeps this module out of its bundle, so the path is
// the deployed file's own, never a bundled copy.
const loadWorkerFile = async () => (await import('@visastack/adapters/heic-worker')).workerFile;

function outcomeOf(message: unknown): HeicConversionResult {
  const outcome = (typeof message === 'object' && message !== null ? message : {}) as WorkerOutcome;
  const memory =
    typeof outcome.decoderMemoryBytes === 'number' &&
    Number.isSafeInteger(outcome.decoderMemoryBytes)
      ? outcome.decoderMemoryBytes
      : null;
  if (
    outcome.ok === true &&
    outcome.bytes instanceof Uint8Array &&
    typeof outcome.width === 'number' &&
    typeof outcome.height === 'number' &&
    memory !== null
  ) {
    return {
      bytes: outcome.bytes,
      width: outcome.width,
      height: outcome.height,
      decoderMemoryBytes: memory,
    };
  }
  const reason =
    typeof outcome.reason === 'string' && WORKER_REASONS.has(outcome.reason)
      ? (outcome.reason as HeicConversionFailure)
      : 'unreadable';
  throw new HeicConversionError(reason, memory);
}

export class HeicJpegConverter {
  readonly name = 'heic-jpeg-converter';
  readonly version = '2.0.0';
  private readonly timeoutMs: number;
  private readonly quality: number;
  private readonly maxDecoderMemoryBytes: number | undefined;

  constructor(options: HeicJpegConverterOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.quality = options.quality ?? DEFAULT_QUALITY;
    this.maxDecoderMemoryBytes = options.maxDecoderMemoryBytes;
  }

  /** Convert a HEIC or HEIF photo to a new JPEG, or throw a `HeicConversionError`. */
  async convert(input: HeicConversionInput): Promise<HeicConversionResult> {
    if (!looksLikeHeic(input.bytes)) throw new HeicConversionError('not_heic');
    const startedAt = Date.now();
    let workerFile: string;
    try {
      [workerFile] = await Promise.all([loadWorkerFile(), loadSharp()]);
    } catch {
      throw new HeicConversionError('unavailable');
    }
    const remainingMs = this.timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw new HeicConversionError('too_slow');

    // A copy in a buffer of its own, handed to the thread without a second copy. The caller's
    // bytes may share a larger pooled buffer, which must never be handed over.
    const transferred = new Uint8Array(input.bytes);
    let worker: Worker;
    try {
      worker = new Worker(workerFile, {
        workerData: {
          heicWorker: true,
          input: transferred.buffer,
          maxInputPixels: input.maxInputPixels,
          maxDecoderMemoryBytes:
            this.maxDecoderMemoryBytes ?? decoderMemoryCeiling(input.maxInputPixels),
          quality: this.quality,
          encodeTimeoutSeconds: Math.max(1, Math.ceil(this.timeoutMs / 1000)),
        },
        transferList: [transferred.buffer],
        resourceLimits: WORKER_RESOURCE_LIMITS,
        // The decoder writes its own diagnostics to the console; they are dropped, not logged.
        stdout: true,
        stderr: true,
      });
    } catch {
      throw new HeicConversionError('unavailable');
    }
    worker.stdout.resume();
    worker.stderr.resume();

    return await new Promise<HeicConversionResult>((resolve, reject) => {
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settle();
        // Ending the thread frees all the decoder's memory, whatever state it is in.
        void worker.terminate().catch(() => undefined);
      };
      const timer = setTimeout(
        () => finish(() => reject(new HeicConversionError('too_slow'))),
        remainingMs,
      );
      // The thread says when the decoder has loaded. Before that, a failure means conversion
      // cannot run at all (`unavailable`); after it, the photo is what failed (`unreadable`).
      let ready = false;
      const stopped = () =>
        finish(() => reject(new HeicConversionError(ready ? 'unreadable' : 'unavailable')));
      worker.on('message', (message: unknown) => {
        if (!ready && typeof message === 'object' && message !== null && 'ready' in message) {
          ready = true;
          return;
        }
        finish(() => {
          try {
            resolve(outcomeOf(message));
          } catch (error) {
            reject(error);
          }
        });
      });
      // A crash, the heap limit reached (ERR_WORKER_OUT_OF_MEMORY) or an exit without an answer.
      worker.on('error', stopped);
      worker.on('exit', stopped);
    });
  }
}
