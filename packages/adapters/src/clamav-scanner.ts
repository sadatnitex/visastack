import { readdir, stat } from 'node:fs/promises';
import { type Socket, connect } from 'node:net';
import { join } from 'node:path';
import type { BlobStore, MalwareScannerPort, ScanResult } from '@visastack/services';
import { structuralCheck } from './scanner';

/**
 * Real malware-engine adapter (Commercial V1 SEC-05/EVI-02): a `MalwareScannerPort`
 * backed by a real ClamAV daemon (`clamd`), speaking its native `INSTREAM`
 * protocol directly over a Unix socket (same-host/sidecar isolated worker,
 * the deployment shape the directive's "one isolated worker deployment"
 * language describes) or TCP (a separately-hosted clamd service). No file
 * path is ever handed to clamd; bytes are streamed over the connection
 * instead, so this works identically regardless of whether clamd can see
 * this process's filesystem, and never depends on clamd's OS-level read
 * access to wherever the object store keeps bytes.
 *
 * Reuses `scanner.ts`'s `structuralCheck` (the same deny-list, DOCX
 * structural validation, and plain-text heuristic `BasicSafetyScanner`
 * uses) as a cheap first gate before ever contacting clamd, with one
 * deliberate difference: `allowPdf: true`. ADR-0012 permanently bans a
 * hand-rolled PDF content parser in this codebase, but it also names the
 * exact follow-up this file is: "a real malware-scanner adapter for PDF...
 * free to safely depend on a mature, battle-tested PDF-parsing library
 * rather than hand-rolled parsing." ClamAV's own PDF scanning (`ScanPDF`,
 * enabled by default) is that library; nothing in this file parses PDF
 * structure itself.
 *
 * Once structural pre-checks pass, EVERY file type is still sent to clamd
 * for a real scan, not just PDF: a real engine can catch content-level
 * threats structural checks were never designed to (embedded exploits in
 * an otherwise well-formed JPEG/PNG/DOCX), and EVI-02 requires a real scan
 * as its own pipeline step regardless of type.
 *
 * Never contacts any public malware-analysis service (SEC-05); every
 * connection this file opens is to `socketPath`/`host:port` supplied by
 * the caller's own configuration, nothing this code hardcodes or infers.
 */

const SCANNER_NAME = 'clamav';
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SIGNATURE_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DATABASE_DIRECTORY = '/var/lib/clamav';
const INSTREAM_CHUNK_SIZE = 1024 * 1024;

export interface ClamAvScannerOptions {
  readonly blobStore: BlobStore;
  /** Unix socket path to clamd. Mutually exclusive with host/port. */
  readonly socketPath?: string;
  /** TCP host to a network-reachable clamd. Mutually exclusive with socketPath. */
  readonly host?: string;
  readonly port?: number;
  /**
   * Deployed engine version, for the audit trail (`scanner.version`,
   * persisted on every scan result). This is operator-declared, not
   * self-discovered: clamd's `VERSION` command is disabled by default
   * (`EnableVersionCommand false`) since it is otherwise an unauthenticated
   * network information leak, and this adapter never asks a caller to
   * weaken that. Use `probeClamdVersion` separately, best-effort, if the
   * deployment explicitly opts in. Defaults to `'unknown'`, never
   * fabricating a plausible-looking version string.
   */
  readonly engineVersion?: string;
  /** Directory clamd loads signatures from, for freshness checking only (default `/var/lib/clamav`). */
  readonly databaseDirectory?: string;
  /** Deny release when the newest signature database is older than this (default 24h, per directive). */
  readonly maxSignatureAgeMs?: number;
  /**
   * Set false only for a test/dev fixture that intentionally has no
   * official signature database (e.g. a minimal EICAR-only test `.hdb`).
   * Refuses to construct with this false when `DEPLOYMENT_MODE=commercial`,
   * mirroring `LocalEnvelopeKeyProvider`'s `assertNotCommercialMode` guard.
   */
  readonly enforceSignatureFreshness?: boolean;
  /** Reject before ever contacting clamd if the object exceeds this size (default 25 MiB). */
  readonly maxBytes?: number;
  /** Socket connect/scan timeout (default 30s). A timeout is treated as scanner-unavailable, not a scan result. */
  readonly timeoutMs?: number;
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function assertNotCommercialMode(enforceSignatureFreshness: boolean): void {
  if (enforceSignatureFreshness) return;
  if (readEnv('DEPLOYMENT_MODE') === 'commercial') {
    throw new Error(
      'ClamAvScanner: enforceSignatureFreshness may never be false when DEPLOYMENT_MODE=commercial',
    );
  }
}

interface SignatureFreshness {
  readonly fresh: boolean;
  readonly ageMs: number | null;
  readonly detail: string;
}

/**
 * Freshness is judged only by the presence and mtime of official signed
 * databases (`.cvd`/`.cld`, the format `freshclam` writes). A test-only
 * custom database (`.hdb`/`.ndb`, hand-authored, no publisher signature or
 * build timestamp) never counts as fresh here, even if just written:
 * conflating "a file exists" with "real signatures are current" is exactly
 * the kind of false claim this programme does not make.
 */
export async function checkSignatureFreshness(
  databaseDirectory: string,
  maxAgeMs: number,
): Promise<SignatureFreshness> {
  let entries: string[];
  try {
    entries = await readdir(databaseDirectory);
  } catch (error) {
    return {
      fresh: false,
      ageMs: null,
      detail: `cannot read signature database directory ${databaseDirectory}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const officialDbFiles = entries.filter((f) => /\.(cvd|cld)$/i.test(f));
  if (officialDbFiles.length === 0) {
    return {
      fresh: false,
      ageMs: null,
      detail: 'no official (.cvd/.cld) signature database present',
    };
  }

  let newestMtimeMs = 0;
  for (const file of officialDbFiles) {
    const stats = await stat(join(databaseDirectory, file));
    if (stats.mtimeMs > newestMtimeMs) newestMtimeMs = stats.mtimeMs;
  }
  const ageMs = Date.now() - newestMtimeMs;
  const ageHours = Math.round(ageMs / (60 * 60 * 1000));
  return {
    fresh: ageMs <= maxAgeMs,
    ageMs,
    detail: `newest official signature database is ${ageHours}h old`,
  };
}

function openSocket(options: ClamAvScannerOptions): Socket {
  if (options.socketPath) return connect(options.socketPath);
  if (options.host && options.port) return connect(options.port, options.host);
  throw new Error('ClamAvScanner: either socketPath or host+port must be configured');
}

/**
 * Streams `bytes` to clamd over `INSTREAM` and returns its raw textual
 * response. No filesystem path is ever sent, so clamd never needs read
 * access to wherever the object store keeps the original bytes.
 */
function clamdInstreamScan(
  options: ClamAvScannerOptions,
  bytes: Uint8Array,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let socket: Socket;
    try {
      socket = openSocket(options);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const responseChunks: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`clamd scan timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function finishOk(raw: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(raw);
    }
    function finishErr(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      let offset = 0;
      while (offset < bytes.length) {
        const end = Math.min(offset + INSTREAM_CHUNK_SIZE, bytes.length);
        const chunk = bytes.subarray(offset, end);
        const lengthPrefix = Buffer.alloc(4);
        lengthPrefix.writeUInt32BE(chunk.length, 0);
        socket.write(lengthPrefix);
        socket.write(chunk);
        offset = end;
      }
      const zeroLength = Buffer.alloc(4);
      socket.write(zeroLength);
    });
    socket.on('data', (chunk) => responseChunks.push(chunk));
    socket.on('end', () => {
      finishOk(Buffer.concat(responseChunks).toString('utf8').replace(/\0/g, '').trim());
    });
    socket.on('error', (error) => finishErr(error));
  });
}

/**
 * Parses clamd's `INSTREAM` response line: `stream: OK`,
 * `stream: <signature name> FOUND`, or `stream: <message> ERROR`. Anything
 * that doesn't match one of those three shapes is treated as unsafe:
 * fail closed on an unrecognized response, never fail open.
 */
function parseClamdResponse(raw: string): { readonly safe: boolean; readonly detail: string } {
  const match = raw.match(/^stream:\s*(.*)$/);
  const body = (match?.[1] ?? raw).trim();
  if (body === 'OK') return { safe: true, detail: 'clamav: OK' };
  if (body.endsWith(' FOUND')) {
    const signature = body.slice(0, -' FOUND'.length).trim();
    return { safe: false, detail: `clamav: threat detected (${signature})` };
  }
  if (body.endsWith(' ERROR') || body === 'ERROR') {
    return { safe: false, detail: `clamav: scan error (${body})` };
  }
  return { safe: false, detail: `clamav: unrecognized response (${body || '<empty>'})` };
}

/**
 * Best-effort live engine-version probe via clamd's `VERSION` command.
 * Returns `undefined` (never a guess) when the command is disabled
 * (Ubuntu/Debian's packaged default) or the daemon is unreachable. Callers
 * decide whether to use the result, fall back to an operator-declared
 * `engineVersion`, or accept `'unknown'`; this function never throws.
 */
export async function probeClamdVersion(
  options: Pick<ClamAvScannerOptions, 'socketPath' | 'host' | 'port'>,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let socket: Socket;
    try {
      socket = openSocket(options as ClamAvScannerOptions);
    } catch {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(undefined);
    }, 5_000);
    function done(value: string | undefined): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    socket.on('connect', () => socket.write('zVERSION\0'));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      done(text.length > 0 && !text.includes('COMMAND UNAVAILABLE') ? text : undefined);
    });
    socket.on('error', () => done(undefined));
  });
}

export class ClamAvScanner implements MalwareScannerPort {
  readonly name = SCANNER_NAME;
  readonly version: string;
  private readonly options: ClamAvScannerOptions;
  private readonly blobStore: BlobStore;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly databaseDirectory: string;
  private readonly maxSignatureAgeMs: number;
  private readonly enforceSignatureFreshness: boolean;

  constructor(options: ClamAvScannerOptions) {
    if (!options.socketPath && !(options.host && options.port)) {
      throw new Error('ClamAvScanner: either socketPath or host+port must be configured');
    }
    this.enforceSignatureFreshness = options.enforceSignatureFreshness ?? true;
    assertNotCommercialMode(this.enforceSignatureFreshness);

    this.options = options;
    this.blobStore = options.blobStore;
    this.version = options.engineVersion ?? 'unknown';
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.databaseDirectory = options.databaseDirectory ?? DEFAULT_DATABASE_DIRECTORY;
    this.maxSignatureAgeMs = options.maxSignatureAgeMs ?? DEFAULT_MAX_SIGNATURE_AGE_MS;
  }

  async scan(input: { bucket: 'QUARANTINE' | 'CLEAN'; objectKey: string }): Promise<ScanResult> {
    const object = await this.blobStore.getObject(input.objectKey);
    if (!object) return { safe: false, detail: 'object bytes not found' };

    const structural = structuralCheck(object.bytes, object.contentType, {
      maxBytes: this.maxBytes,
      allowPdf: true,
    });
    if (!structural.accepted) return { safe: false, detail: structural.detail };

    if (this.enforceSignatureFreshness) {
      const freshness = await checkSignatureFreshness(
        this.databaseDirectory,
        this.maxSignatureAgeMs,
      );
      if (!freshness.fresh) {
        return { safe: false, detail: `scanner degraded: ${freshness.detail}` };
      }
    }

    try {
      const raw = await clamdInstreamScan(this.options, object.bytes, this.timeoutMs);
      const verdict = parseClamdResponse(raw);
      return { safe: verdict.safe, detail: `${structural.detail}; ${verdict.detail}` };
    } catch (error) {
      return {
        safe: false,
        detail: `scanner unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
