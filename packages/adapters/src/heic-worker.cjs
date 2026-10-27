'use strict';

/**
 * iPhone photo conversion, the isolated half (UX-B). heic-converter.ts starts this file in its own
 * worker thread for every photo; nothing else ever runs here and the thread is ended after one
 * photo, whatever happened.
 *
 * Plain CommonJS on purpose: Node runs it as it is in tests, in scripts and in the deployed
 * function. The web build keeps `@visastack/adapters/heic-worker` out of its bundle
 * (apps/web/next.config.mjs), so the deployed function requires this real file, and the output
 * file tracing follows its own requires (libheif-js, sharp) from here.
 *
 * Why a thread of its own:
 * - libheif (the HEIC decoder, built to WebAssembly) decodes synchronously. On the request thread
 *   that froze every other request and no deadline could stop it; here the request thread stays
 *   free and its deadline ends this thread with `worker.terminate()`, part way through if needed.
 * - Ending the thread frees everything the decoder held (its WebAssembly memory, its handles),
 *   including after a failure part way through, so nothing can leak between photos.
 *
 * What bounds the memory here:
 * - The decoder's WebAssembly memory has a hard ceiling. The module ships allowing growth to 2 GB;
 *   before it is started its memory maximum is rewritten (`limitModuleMemory`) to the ceiling the
 *   caller sends, sized from the pixel budget. Past it every allocation fails and the decode stops
 *   with an error, so a crafted file can never make the decoder take more memory than the largest
 *   photo that is accepted anyway. This holds whatever the picture data claims, including picture
 *   sizes the container does not declare.
 * - Before decoding, the size the container declares must fit the pixel budget. libheif itself
 *   also reads the picture size from the HEVC settings stored in the container and refuses a
 *   frame larger than the declared size before decoding it ("Security limit exceeded"), and a
 *   decoded frame of any other size than the declared one is refused.
 * - The thread's JavaScript heap is capped by the caller (`resourceLimits`); the decoded pixels
 *   (width x height x 4 bytes, inside the budget) and sharp's work are outside that heap and are
 *   bounded by the pixel budget (sharp also has its own pixel limit and time limit).
 */

const { readFileSync } = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');

const WASM_PAGE_BYTES = 65_536;
/** WebAssembly memory is addressed in 64 KiB pages; 32-bit modules stop at 65536 pages (4 GiB). */
const MAX_WASM_PAGES = 65_536;

/**
 * Where a WebAssembly module declares its own memory: the initial size and the maximum, in pages,
 * and the byte range holding the maximum. Throws when the module has no memory of its own with a
 * maximum (this build always has one: 260 pages to start, 32768 at most).
 */
function readMemoryLimits(bytes) {
  const magic = [0x00, 0x61, 0x73, 0x6d];
  if (bytes.byteLength < 8 || magic.some((byte, i) => bytes[i] !== byte)) {
    throw new Error('not a WebAssembly module');
  }
  let at = 8;
  const readUnsigned = () => {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (at >= bytes.byteLength || shift > 28) throw new Error('malformed WebAssembly module');
      const byte = bytes[at++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
  };
  while (at < bytes.byteLength) {
    const id = bytes[at++];
    const size = readUnsigned();
    const end = at + size;
    if (id === 5) {
      if (readUnsigned() !== 1) throw new Error('expected exactly one memory');
      // Bit 0: has a maximum. Shared (bit 1) or 64-bit (bit 2) memories are not expected here.
      if (bytes[at++] !== 1) throw new Error('memory has no maximum to lower');
      const initial = readUnsigned();
      const maxStart = at;
      const max = readUnsigned();
      return { initial, max, maxStart, maxWidth: at - maxStart };
    }
    at = end;
  }
  throw new Error('module has no memory of its own');
}

/** The initial size of a module's own memory, in pages (a ceiling is never set below it). */
function initialMemoryPages(binary) {
  return readMemoryLimits(new Uint8Array(binary)).initial;
}

/**
 * A copy of a WebAssembly module whose own memory may grow to at most `maxPages`. Only the memory
 * section's maximum changes, written in the same number of bytes (WebAssembly reads padded LEB128
 * numbers), so every other byte and offset is untouched. A ceiling above the module's own
 * maximum leaves the module as it is.
 */
function limitModuleMemory(binary, maxPages) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_WASM_PAGES) {
    throw new RangeError('memory ceiling out of range');
  }
  const bytes = new Uint8Array(binary);
  const limits = readMemoryLimits(bytes);
  if (maxPages < limits.initial) throw new RangeError('memory ceiling below the initial memory');
  if (maxPages >= limits.max) return bytes;
  let rest = maxPages;
  for (let i = 0; i < limits.maxWidth; i++) {
    bytes[limits.maxStart + i] = (rest & 0x7f) | (i < limits.maxWidth - 1 ? 0x80 : 0);
    rest = Math.floor(rest / 128);
  }
  return bytes;
}

class Refusal extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** Decode the primary picture to RGBA pixels inside the WebAssembly ceiling. */
async function decodePrimary(libheif, input, maxInputPixels) {
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(input);
  if (!Array.isArray(images) || images.length === 0) throw new Refusal('unreadable');
  const primary = images.find((image) => image.is_primary()) ?? images[0];
  const width = primary.get_width();
  const height = primary.get_height();
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Refusal('unreadable');
  }
  if (width * height > maxInputPixels) throw new Refusal('too_large');
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const decoded = await new Promise((resolve) => {
    try {
      primary.display(target, (result) => resolve(result));
    } catch {
      resolve(null);
    }
  });
  if (!decoded || decoded.width !== width || decoded.height !== height) {
    throw new Refusal('unreadable');
  }
  return target;
}

async function convert(data) {
  let libheif;
  let sharp;
  let binary;
  try {
    const glue = require('libheif-js/libheif-wasm/libheif.js');
    binary = readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm'));
    sharp = require('sharp');
    const ceilingPages = Math.max(
      initialMemoryPages(binary),
      Math.min(MAX_WASM_PAGES, Math.ceil(data.maxDecoderMemoryBytes / WASM_PAGE_BYTES)),
    );
    libheif = glue({
      wasmBinary: limitModuleMemory(binary, ceilingPages),
      print: () => undefined,
      printErr: () => undefined,
    });
    await libheif.ready;
  } catch {
    return { ok: false, reason: 'unavailable', decoderMemoryBytes: 0 };
  }
  // Everything has loaded: from here on, a failure is about the photo, not the thread.
  parentPort.postMessage({ ready: true });
  const memoryBytes = () => libheif.HEAPU8?.buffer?.byteLength ?? 0;
  try {
    const input = new Uint8Array(data.input);
    const pixels = await decodePrimary(libheif, input, data.maxInputPixels);
    const raw = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
    const { data: jpeg, info } = await sharp(raw, {
      raw: { width: pixels.width, height: pixels.height, channels: 4 },
      limitInputPixels: data.maxInputPixels,
    })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: data.quality, mozjpeg: true })
      .timeout({ seconds: data.encodeTimeoutSeconds })
      .toBuffer({ resolveWithObject: true });
    // A fresh buffer of its own, so it can be handed over without copying.
    const output = new Uint8Array(jpeg.byteLength);
    output.set(jpeg);
    return {
      ok: true,
      bytes: output,
      width: info.width,
      height: info.height,
      decoderMemoryBytes: memoryBytes(),
    };
  } catch (error) {
    const reason = error instanceof Refusal ? error.reason : 'unreadable';
    return { ok: false, reason, decoderMemoryBytes: memoryBytes() };
  }
}

module.exports = { workerFile: __filename, limitModuleMemory, initialMemoryPages };

if (parentPort && workerData && workerData.heicWorker === true) {
  convert(workerData).then(
    (outcome) => {
      parentPort.postMessage(outcome, outcome.ok ? [outcome.bytes.buffer] : []);
    },
    () => {
      parentPort.postMessage({ ok: false, reason: 'unreadable', decoderMemoryBytes: 0 });
    },
  );
}
