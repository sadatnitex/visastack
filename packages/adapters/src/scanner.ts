import { inflateSync } from 'node:zlib';
import type { BlobStore, MalwareScannerPort, ScanResult } from '@visastack/services';
import { validateDocxStructure } from './docx-validation';

/**
 * Built-in structural safety scanner (ADR-0011).
 *
 * A dependency-free `MalwareScannerPort` for when no antivirus service is wired. It
 * reads the stored bytes and enforces a positive allow-list: the content must
 * either begin with the magic bytes of an expected binary document type
 * (PDF/PNG/JPEG/DOCX — DOCX additionally passing real structural validation,
 * PDF additionally screened for active-content markers; see below), or pass
 * a plain-text heuristic (TXT/MD — these have no magic bytes), and be within
 * the size limit; executables and everything unrecognized are rejected.
 *
 * IMPORTANT: this is NOT antivirus. It stops type-spoofing, structurally
 * invalid/hostile-shaped documents, and obvious executable/malware-shaped
 * uploads, but not signature-based threats. It is paired with the human-
 * approval gate (documents never auto-promote to shared without owner
 * confirmation). Swap in a real ClamAV adapter behind this same port to
 * close the AV gate — no domain changes.
 *
 * DOCX shares its ZIP magic bytes with XLSX/PPTX/generic ZIP archives, so a
 * magic-byte match alone is never sufficient — `validateDocxStructure`
 * (`docx-validation.ts`) reads the ZIP central directory to confirm the real
 * OOXML Word-document shape (and reject macro-enabled/encrypted/oversized/
 * zip-bomb-shaped/path-traversing archives) before this scanner calls a
 * zip-shaped upload safe. `mammoth` (`text-extraction.ts`) remains a second,
 * independent check at extraction time.
 *
 * SECURITY: the plain-text path is deliberately gated to the exact declared
 * content types the upload UI/extraction layer support (`text/plain`,
 * `text/markdown`) — NOT "anything that decodes as clean UTF-8". HTML and
 * SVG source are both ordinary UTF-8 text with no control characters, so a
 * heuristic that accepted any such content would let a caller who bypasses
 * the file picker (a raw Server Action call) mark `text/html`/`image/svg+xml`
 * content "safe", which `/api/blob/[key]` would later serve inline under the
 * app's own origin — a stored-XSS vector via SVG script execution or
 * HTML-sniffing. Gating on the declared type closes that: an upload
 * declaring `text/html` is rejected here regardless of its byte content.
 */

const SCANNER_NAME = 'basic-structural-scanner';
const SCANNER_VERSION = '2.0.0';

const PDF_MAGIC: readonly number[] = [0x25, 0x50, 0x44, 0x46]; // %PDF
const DOCX_ZIP_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

// PDF and DOCX get their own structural checks below (magic bytes alone are
// not sufficient for either); everything else here is magic-byte-only.
const MAGIC_ALLOW: ReadonlyArray<{ readonly label: string; readonly bytes: readonly number[] }> = [
  { label: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
];

const MAGIC_DENY: ReadonlyArray<{ readonly label: string; readonly bytes: readonly number[] }> = [
  { label: 'dos/pe executable', bytes: [0x4d, 0x5a] }, // MZ
  { label: 'elf executable', bytes: [0x7f, 0x45, 0x4c, 0x46] }, // \x7FELF
  { label: 'mach-o executable', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { label: 'shell script', bytes: [0x23, 0x21] }, // #!
];

/**
 * Object-dictionary keys a PDF uses to run embedded JavaScript, auto-launch
 * an external action on open/close, or carry an embedded file. A byte-level
 * substring heuristic, not a real PDF object parse — bounded, cheap, and
 * deliberately conservative (a real applicant document essentially never
 * contains these); paired with `unpdf`'s independent parse at extraction
 * time. Full sanitization (CDR) is tracked, not implemented here.
 * `/AA` (Additional Actions) added alongside `/OpenAction` (Codex review,
 * PR-B3, finding #9) — the same risk category, triggered by other document
 * events (page open/close, focus, etc.) rather than just document-open.
 */
const ACTIVE_PDF_CONTENT_MARKERS: readonly string[] = [
  '/JavaScript',
  '/JS',
  '/OpenAction',
  '/AA',
  '/Launch',
  '/EmbeddedFile',
];

/**
 * PDF "name object" syntax lets any byte be written as `#XX` (2 hex
 * digits) instead of literally — a legitimate escape for names containing
 * special characters, but also a trivial way to spell `/Open#41ction`
 * instead of `/OpenAction` and slip past a plain substring search entirely
 * (Codex review, PR-B3, finding #9). Decoding every `#XX` occurrence before
 * matching closes this — unescaping can only ever reveal a marker that a
 * plain search would otherwise miss, never hide one that's already there in
 * plain text.
 */
function decodePdfNameEscapes(text: string): string {
  return text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function findActiveMarkerIn(text: string): string | undefined {
  const unescaped = decodePdfNameEscapes(text);
  return ACTIVE_PDF_CONTENT_MARKERS.find((marker) => unescaped.includes(marker));
}

const MAX_STREAMS_SCANNED = 200;
/** Generous for any legitimate compressed object/content stream, tight enough to bound a decompression-bomb attempt. */
const MAX_STREAM_INFLATED_BYTES = 10 * 1024 * 1024;

/**
 * Best-effort extraction of `FlateDecode` stream bodies for the same bounded,
 * dependency-free scan (Codex review, PR-B3, finding #9) — a PDF can hide an
 * entire compressed *object stream* (`/Type /ObjStm`) whose decompressed
 * content is itself PDF syntax (indirect objects, name-keyed dictionaries,
 * possibly `/OpenAction` etc.), which never appears as a matchable literal
 * substring anywhere in the raw file bytes.
 *
 * Not a real PDF parser: locates `stream`/`endstream` keyword pairs
 * directly rather than resolving `/Length` (frequently an indirect object
 * reference a bounded scanner can't safely chase).
 *
 * **Governing invariant** (restated after round 1 caught three distinct
 * ways a first draft broke it): a byte range is only ever reported
 * "nothing found here" once its compression status AND content have been
 * POSITIVELY confirmed. Anything this heuristic cannot positively confirm
 * is `undecodable` — never silently treated as absent, plain, or
 * irrelevant. Three consequences of restating it that way, not three
 * independent patches:
 *
 * - The stream-keyword delimiter matches all three PDF-legal end-of-line
 *   conventions (CRLF, lone LF, lone CR) via `STREAM_KEYWORD_PATTERN` —
 *   matching only CRLF/LF silently failed to even recognize a
 *   lone-CR-delimited stream as a stream at all, so nothing about it
 *   (compressed or not) was ever examined.
 * - The `/Filter` lookback runs from the END of the PREVIOUS stream (or
 *   start of file) up to THIS stream's keyword — unbounded by a fixed byte
 *   count, bounded instead by the file's own structure, since a stream's
 *   governing dictionary can never extend past the previous stream's own
 *   `endstream`. A fixed-size window can be out-run by an unusually large
 *   dictionary and silently miss a genuine `/Filter /FlateDecode`
 *   declaration; this can't be out-run the same way, and no later stream's
 *   search window can ever see an earlier stream's own dictionary (each
 *   window starts strictly after the previous stream's close).
 * - A stream with no matching `endstream` anywhere in the rest of the
 *   file, or hitting `MAX_STREAMS_SCANNED` while a stream keyword still
 *   remains further on, both now mark the WHOLE result undecodable rather
 *   than silently stopping and reporting only what was found so far as if
 *   it were the complete picture.
 *
 * **Codex review, PR-B3, round 2, caught a fourth issue on this same
 * mechanism** — a stream declared with a *chained* filter array (e.g.
 * `/Filter [/FlateDecode /ASCIIHexDecode]`) was still detected as
 * "declares Flate", inflated once, and the single-inflate result treated
 * as the final decoded content — silently ignoring that a real decoder
 * would need to apply the *rest* of the chain too, leaving a marker
 * hidden in whatever the remaining filter(s) encode undetected by either
 * the raw scan or the post-inflate scan. `classifyFilterDeclaration` now
 * only ever treats a stream as positively decodable when its filter is
 * *exactly* a lone `FlateDecode` (bare, or a single-element array) — a
 * chain that merely *mentions* FlateDecode alongside another filter is
 * `flate-in-chain`, marked undecodable rather than partially decoded.
 * Deliberately NOT extended to flag every multi-filter chain, or every
 * single non-Flate filter, as undecodable: real-world PDFs routinely
 * carry ordinary image streams (`/DCTDecode` for JPEG, `/CCITTFaxDecode`
 * for fax-compressed scans) that this scanner was never chasing markers
 * inside before this fix and has no reason to start rejecting now — an
 * image codec's output isn't parsed as further PDF object syntax by any
 * viewer, so it can't smuggle an executable marker the way a chained
 * *text*-oriented filter over an object stream could. This keeps the
 * fix scoped to the mechanism Codex actually found broken (a filter
 * declaration that mentions FlateDecode but isn't only FlateDecode)
 * without turning routine scanned-document uploads into false positives.
 *
 * **Codex review, PR-B3, round 3, caught three more issues — a 5th, 6th
 * and 7th distinct finding on this one mechanism across 3 rounds, deep
 * past the structural-escalation threshold.** Rather than three more
 * patches, this is the third ground-up pass at the same invariant, and
 * this time it goes to the actual root cause common to all three: the
 * previous two drafts searched a whole inter-stream *window* of text for
 * a `/Filter` declaration instead of first identifying the *exact*
 * dictionary that structurally governs this specific stream.
 * `findGoverningDictionary` now does that precisely — depth-tracked
 * bracket matching finds the top-level `<<...>>` pair ending immediately
 * before `stream` (only whitespace between), nested sub-dictionaries
 * (`/DecodeParms << ... >>`) correctly treated as part of it rather than
 * as boundary noise, and any *earlier*, unrelated object's dictionary
 * sitting in the same inter-stream window (however its own `/Filter`
 * mention was spelled) is structurally excluded rather than merely
 * hoped not to collide with a regex. Three direct consequences:
 * - (round 3, finding 1) The filter declaration is now read from the one
 *   dictionary that actually owns this stream, not the first `/Filter`
 *   token anywhere between here and the previous `endstream`.
 * - (round 3, finding 2) `classifyFilterDeclaration` decodes `#XX` name
 *   escapes across the governing dictionary before matching — the same
 *   escape scheme `findActiveMarkerIn` already unescapes applies to
 *   every PDF name token, not just active-content markers, so `/Filter`
 *   itself (or `/FlateDecode`) could be partially escaped and slip past
 *   a plain-text match.
 * - (round 3, finding 3) `hasNontrivialPredictor` rejects a sole-Flate
 *   stream whose dictionary declares `/DecodeParms` with a `/Predictor`
 *   other than 1 (PNG predictors 10-15, TIFF predictor 2) as undecodable
 *   — `inflateSync` alone only reverses the Flate layer; a predictor is a
 *   SECOND, row-differencing encoding on top of it, and treating the raw
 *   inflate output as final content would search still-differenced bytes
 *   for a marker that predictor differencing can conceal. Implementing
 *   predictor reversal is deliberately out of scope (same reasoning as
 *   round 2's chained-filter decision): predictors are a pixel/row
 *   technique essentially never used for the compressed *object* streams
 *   this scanner actually cares about, only for image/xref streams, so
 *   failing closed here costs nothing on the real attack surface.
 *
 * **Codex review, PR-B3, round 4, caught three more issues — an 8th, 9th
 * and 10th distinct finding on this mechanism across 4 rounds.** All
 * three, like round 3's, trace back to gaps the *previous* redesign's own
 * simplifications left open, so this restates the invariant once more
 * rather than adding three narrow patches:
 * - (round 4, finding 1) round 2's "leave every non-Flate filter alone"
 *   decision assumed a non-Flate filter meant an image stream, but that's
 *   only true in practice, never structurally — `/ASCIIHexDecode` or
 *   `/ASCII85Decode` alone (no Flate at all) can just as easily wrap a
 *   compressed *object* stream as a hex/base85-encoded PDF-syntax payload,
 *   and `classifyFilterDeclaration` was treating that identically to a
 *   genuine `/DCTDecode` image. The classifier now positively enumerates
 *   the handful of filters that are true pixel/binary codecs whose output
 *   is never further PDF syntax (`IMAGE_ONLY_FILTERS`) as the only case
 *   safe to leave alone; every other filter this scanner doesn't decode
 *   itself — including an indirect `/Filter N G R` reference it can't
 *   resolve — is now `undecidable`, not silently skipped.
 * - (round 4, finding 2) a PDF `%`-comment inside the governing dictionary
 *   (legal syntax) containing its own, decoy `/Filter` mention could be
 *   matched by the classifier's plain-text regex ahead of the real,
 *   active key. `findGoverningDictionary` now strips comments from the
 *   window before any bracket-matching or filter-classification runs
 *   against it, so a commented-out token can no longer masquerade as
 *   active syntax (and can no longer desynchronize the bracket depth
 *   count either, if a comment happened to contain a literal `<<`/`>>`).
 * - (round 4, finding 3) `hasNontrivialPredictor`'s regex only recognized
 *   an inline `<<...>>`/`[...]` `/DecodeParms` value — an indirect
 *   reference (`/DecodeParms 7 0 R`, pointing at another object this
 *   bounded scanner has no way to resolve) matched nothing and returned
 *   "no predictor," even though a conforming reader would still resolve
 *   and apply it. An unresolved reference is now treated the same as a
 *   confirmed-nontrivial predictor: undecidable rather than assumed clear.
 *
 * **Codex review, PR-B3, round 5, caught three more issues — an 11th,
 * 12th and 13th distinct finding on this mechanism across 5 rounds.**
 * - (round 5, finding 1) round 4's `IMAGE_ONLY_FILTERS` allowlist trusted
 *   the filter NAME alone as proof the decoded bytes are never re-parsed
 *   as PDF syntax, but a stream whose dictionary ALSO declares
 *   `/Type /ObjStm` is, by definition, meant to decode to further object
 *   syntax regardless of which filter is used — a real image codec is
 *   just as invertible as Flate, so attacker-authored compressed bytes
 *   could in principle be built to decode to any chosen output, the same
 *   way Flate can. `classifyFilterDeclaration` now also checks the
 *   governing dictionary for `/Type /ObjStm`; when present, the
 *   image-only exemption is suppressed and even a nominally-safe image
 *   codec becomes `undecidable`.
 * - (round 5, finding 2) the `/Predictor` regex only matched a bare digit
 *   string, missing PDF's legal optional leading sign, so
 *   `/Predictor +12` fell through to "no predictor found" instead of
 *   being parsed as the nontrivial value 12. The regex now captures an
 *   optional leading sign and compares the *parsed* numeric value, not
 *   the raw digit string.
 * - (round 5, finding 3) `MAX_STREAM_INFLATED_BYTES` was enforced
 *   independently per stream with no aggregate cap, so up to
 *   `MAX_STREAMS_SCANNED` streams each inflating to just under that limit
 *   could retain roughly 2 GiB of decompressed data simultaneously — a
 *   genuine resource-exhaustion concern, not a false-negative evasion.
 *   `MAX_TOTAL_INFLATED_BYTES` now tracks a budget across the whole PDF,
 *   shrinking each stream's own `maxOutputLength` to whatever remains;
 *   once exhausted, remaining streams are undecidable. `extractFlateStreams`
 *   was also restructured to scan each stream's decoded text for a marker
 *   and discard it immediately rather than accumulating every stream's
 *   decoded text in an array, bounding peak memory to roughly one stream
 *   at a time regardless of how many streams a PDF contains.
 *
 * **Codex review, PR-B3, round 6, caught a 14th distinct finding on this
 * mechanism across 6 rounds**: a PDF literal string `(...)` may legally
 * contain unescaped `<`, `>`, or `%` as ordinary content bytes (e.g.
 * `/Foo (>> <<)`, or `/Note (50%)`), with balanced, unescaped parentheses
 * even allowed to nest inside it. Neither the bracket-depth matcher below
 * nor comment-stripping had any awareness of string syntax, so a
 * dictionary value's own bytes could be mistaken for a dictionary
 * delimiter or a comment start. Masking blanked out (space-filled,
 * length- and position-preserving) the content of every literal string
 * and hex string `<...>` before either comment-stripping or bracket
 * matching ran — applied once, up front, so both mechanisms (and,
 * since the masked text is what's returned and handed on to
 * `classifyFilterDeclaration`/`hasNontrivialPredictor`, their own keyword
 * regexes too) could never mistake a string's bytes for real syntax,
 * closing the reported `<<`/`>>` case and the same-root-cause
 * `%`-inside-a-string and decoy-`/Filter`-inside-a-string cases together.
 *
 * **Codex review, PR-B3, round 7, caught two more issues — a 15th and
 * 16th distinct finding on this mechanism across 7 rounds.**
 * - (round 7, finding 1) `hasNontrivialPredictor`'s `/DecodeParms` value
 *   was captured with a flat regex (`<<[^>]*>>`) that stops at the FIRST
 *   `>>`, so a value containing its own nested sub-dictionary (e.g.
 *   `/DecodeParms << /Foo << /Bar 1 >> /Predictor 12 >>`) was captured
 *   only through the inner `>>`, excluding the real `/Predictor` key —
 *   the exact "a regex assumes no nesting" mistake round 3 already fixed
 *   for the OUTER stream dictionary, just never applied to this INNER
 *   value. `extractBalanced` below factors that same depth-tracking
 *   technique out into a small, generic matcher for either `<<...>>` or
 *   `[...]`, reused here instead of a second, unbalanced regex for the
 *   same class of syntax. This one is a clean, purely additive fix: it
 *   only ever widens what a value's true extent is found to be, and only
 *   affects a dictionary already positively identified as governing a
 *   real stream, so it carries none of the risk described below.
 * - (round 7, finding 2) the OUTER `stream`/`endstream` keyword search in
 *   `extractFlateStreams` scanned the raw, unmasked file text directly —
 *   a comment literally containing the text `stream\n` (legal PDF) is
 *   indistinguishable from a real stream keyword to a plain regex, has no
 *   governing dictionary of its own, and was marking the WHOLE PDF
 *   undecidable (a false-positive rejection of a benign upload, not a
 *   missed marker, but the same root cause nonetheless: a raw regex scan
 *   with no awareness that comments and strings can contain arbitrary
 *   bytes that merely *look* like structural syntax).
 *
 * Finding 2's first fix attempt made a serious mistake worth recording:
 * it masked the ENTIRE file ONCE, up front, and threaded that single
 * masked view through both the keyword locator and
 * `findGoverningDictionary`. That is unsound. Masking rules are only ever
 * valid for genuine PDF *syntax* — comments and strings are a syntax-level
 * concept — but roughly half of every PDF containing streams is *not*
 * syntax at all: it's the streams' own opaque, high-entropy compressed
 * bytes. Interpreted as text, those bytes routinely contain a `(` or `<`
 * or `%` with no matching closer anywhere nearby (compressed data looks
 * like noise), so masking logic applied across a whole file can "open" an
 * unterminated string or comment inside one stream's body and never
 * cleanly close it again -- silently blanking everything from that point
 * to the end of the file, including every subsequent real `endstream`,
 * dictionary, and `stream` keyword. In local testing this reliably broke
 * every existing test that depended on finding a marker inside a
 * genuinely compressed stream (caught before ever reaching Codex, by this
 * PR's own non-vacuousness discipline -- every new redesign is run
 * against the full existing suite before being considered done). The
 * fix that survived: masking state must never be allowed to persist
 * *across* a stream body boundary. `findGoverningDictionary` keeps doing
 * exactly what round 6 already had it do -- masking only its own small,
 * local window (`dictionaryStart` up to the stream keyword it's already
 * been told about), never anything past it. The keyword locator itself
 * gets a purpose-built scanner, `findNextStreamKeyword`, that walks
 * forward tracking string/comment state *inline* and returns the instant
 * it finds a real, unmasked `stream` keyword -- it never continues
 * scanning into (or past) the body that follows, so a stream's own noise
 * can never be reached, let alone corrupt anything. The `endstream`
 * search stays a plain, unmasked `indexOf`: it always runs *inside* a
 * stream's own opaque body, where "comment" and "string" are not PDF
 * concepts at all, so masking never applied there in the first place.
 */
function maskPdfNoise(text: string): string {
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '%') {
      while (i < chars.length && chars[i] !== '\r' && chars[i] !== '\n') {
        chars[i] = ' ';
        i++;
      }
      continue;
    }
    if (chars[i] === '(') {
      let depth = 1;
      chars[i] = ' ';
      i++;
      while (i < chars.length && depth > 0) {
        if (chars[i] === '\\' && i + 1 < chars.length) {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (chars[i] === '(') depth++;
        else if (chars[i] === ')') depth--;
        chars[i] = ' ';
        i++;
      }
      continue;
    }
    if (chars[i] === '<') {
      if (chars[i + 1] === '<') {
        i += 2; // a genuine '<<' dictionary delimiter -- leave untouched
        continue;
      }
      chars[i] = ' ';
      i++;
      while (i < chars.length && chars[i] !== '>') {
        chars[i] = ' ';
        i++;
      }
      if (i < chars.length) {
        chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

/**
 * Generic depth-tracked matcher: given a position where a balanced
 * `open`/`close` construct is expected to start, returns its full extent
 * once depth returns to zero, or `undefined` if `open` isn't there at all
 * or it never balances. Used for any PDF value that can legally nest a
 * construct of its own kind (`<<...>>` dictionaries nesting sub-
 * dictionaries; `[...]` arrays nesting sub-arrays) — the same technique
 * `findGoverningDictionary` already used inline for the outer stream
 * dictionary, factored out so `hasNontrivialPredictor` can reuse it for a
 * `/DecodeParms` value too (Codex review, PR-B3, round 7).
 */
function extractBalanced(
  text: string,
  start: number,
  open: string,
  close: string,
): string | undefined {
  if (!text.startsWith(open, start)) return undefined;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text.startsWith(open, i)) {
      depth++;
      i += open.length;
      continue;
    }
    if (text.startsWith(close, i)) {
      depth--;
      i += close.length;
      if (depth === 0) return text.slice(start, i);
      continue;
    }
    i++;
  }
  return undefined; // never closed
}

/**
 * Sticky (`y`): tested only at an EXACT position via `lastIndex`, never
 * searched forward -- `findNextStreamKeyword` below relies on this to
 * check "does a real stream keyword start right here" one position at a
 * time, without ever slicing/re-scanning from scratch.
 */
const STREAM_KEYWORD_PATTERN = /stream(?:\r\n|\r|\n)/y;

type StreamKeywordSearchResult =
  | { readonly kind: 'found'; readonly streamKeywordStart: number; readonly dataStart: number }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unterminated' };

/**
 * Scans forward from `from` for the next real `stream` keyword, skipping
 * over every literal string, hex string, and `%` comment along the way --
 * comment/string-aware, but critically, it STOPS the instant it finds a
 * real match rather than continuing to scan (Codex review, PR-B3, round
 * 7, finding 2: a comment literally containing the text `stream\n` was
 * previously indistinguishable from a real stream keyword to a plain,
 * unmasked regex search). This is NOT the same as "mask the whole file,
 * then regex-search it" -- an earlier draft of this fix did exactly that
 * and it was unsound (see the long comment above `maskPdfNoise`): masking
 * state must never be carried across a stream's own opaque, high-entropy
 * body, which this function guarantees simply by never scanning into one
 * -- it returns as soon as a real keyword is found, before the body that
 * follows it is ever examined.
 *
 * Distinguishes 'not-found' (genuinely confirmed no real keyword exists
 * from `from` to the true end of the file) from 'unterminated' (a literal
 * or hex string opened but never closed before end of file -- per the
 * governing invariant, this is NOT the same as confirming nothing
 * follows it; it's unclear, so the caller must treat it as undecodable
 * rather than silently concluding "no more streams").
 */
function findNextStreamKeyword(text: string, from: number): StreamKeywordSearchResult {
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '%') {
      while (i < text.length && text[i] !== '\r' && text[i] !== '\n') i++;
      continue; // a comment running to genuine EOF is unambiguous, not unterminated
    }
    if (ch === '(') {
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === '\\' && i + 1 < text.length) {
          i += 2;
          continue;
        }
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        i++;
      }
      if (depth > 0) return { kind: 'unterminated' };
      continue;
    }
    if (ch === '<') {
      if (text[i + 1] === '<') {
        i += 2;
        continue;
      }
      i++;
      while (i < text.length && text[i] !== '>') i++;
      if (i >= text.length) return { kind: 'unterminated' };
      i++;
      continue;
    }
    STREAM_KEYWORD_PATTERN.lastIndex = i;
    const match = STREAM_KEYWORD_PATTERN.exec(text);
    if (match) return { kind: 'found', streamKeywordStart: i, dataStart: i + match[0].length };
    i++;
  }
  return { kind: 'not-found' };
}

function findGoverningDictionary(
  text: string,
  searchFrom: number,
  streamKeywordStart: number,
): string | undefined {
  let end = streamKeywordStart;
  while (end > searchFrom && /\s/.test(text.charAt(end - 1))) end--;

  const window = maskPdfNoise(text.slice(searchFrom, end));
  const tokens = /<<|>>/g;
  let depth = 0;
  let topLevelStart = -1;
  let lastTopLevelStart = -1;
  let lastTopLevelEnd = -1;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec-loop idiom
  while ((match = tokens.exec(window))) {
    if (match[0] === '<<') {
      if (depth === 0) topLevelStart = match.index;
      depth++;
    } else {
      depth--;
      if (depth < 0) return undefined; // stray '>>' with no matching '<<'
      if (depth === 0) {
        lastTopLevelStart = topLevelStart;
        lastTopLevelEnd = match.index + 2;
      }
    }
  }
  if (depth !== 0) return undefined; // a '<<' that never closed
  if (lastTopLevelEnd !== window.length) return undefined; // doesn't end right at `stream`
  return window.slice(lastTopLevelStart, lastTopLevelEnd);
}

/** True pixel/binary codecs: their output is raw image data, never further PDF object syntax, so no viewer ever parses it as such. */
const IMAGE_ONLY_FILTERS: ReadonlySet<string> = new Set([
  '/DCTDecode',
  '/CCITTFaxDecode',
  '/JPXDecode',
  '/JBIG2Decode',
]);

function classifyFilterDeclaration(
  dictText: string,
): 'sole-flate' | 'flate-in-chain' | 'skip' | 'undecidable' {
  const unescaped = decodePdfNameEscapes(dictText);
  if (!/\/Filter\b/.test(unescaped)) return 'skip'; // no /Filter key at all -- plain content, already covered by the raw scan
  const match = /\/Filter\s*(\/[A-Za-z0-9]+|\[[^\]]*\])/.exec(unescaped);
  const value = match?.[1];
  if (!value) return 'undecidable'; // /Filter key present but its value isn't a recognizable name/array (e.g. an indirect reference)
  if (value === '/FlateDecode') return 'sole-flate';
  // An object stream's decoded content is always further PDF object syntax
  // by definition (Codex review, PR-B3, round 5) -- the image-only
  // exemption below only holds when the decoded bytes are genuinely never
  // re-parsed as PDF syntax, which is false for /Type /ObjStm regardless
  // of which filter happens to be declared (a real image codec can, in
  // principle, be driven by attacker-authored compressed bytes to decode
  // to any chosen output, the same way Flate can).
  const isObjectStream = /\/Type\s*\/ObjStm\b/.test(unescaped);
  if (!value.startsWith('[')) {
    return !isObjectStream && IMAGE_ONLY_FILTERS.has(value) ? 'skip' : 'undecidable';
  }
  const names: string[] = value.match(/\/[A-Za-z0-9]+/g) ?? [];
  if (!isObjectStream && names.length > 0 && names.every((name) => IMAGE_ONLY_FILTERS.has(name))) {
    return 'skip';
  }
  if (!names.includes('/FlateDecode')) return 'undecidable';
  return names.length === 1 ? 'sole-flate' : 'flate-in-chain';
}

function hasNontrivialPredictor(dictText: string): boolean {
  const unescaped = decodePdfNameEscapes(dictText);
  const keyMatch = /\/DecodeParms\b\s*/.exec(unescaped);
  if (!keyMatch) return false; // no /DecodeParms key at all
  const valueStart = keyMatch.index + keyMatch[0].length;
  // A flat "<<[^>]*>>" regex stops at the FIRST '>>', truncating a value
  // that nests its own sub-dictionary before the real /Predictor key
  // (Codex review, PR-B3, round 7) -- extractBalanced finds the value's
  // true extent instead, the same depth-tracked technique
  // findGoverningDictionary already uses for the outer stream dictionary.
  const value =
    extractBalanced(unescaped, valueStart, '<<', '>>') ??
    extractBalanced(unescaped, valueStart, '[', ']');
  if (value === undefined) return true; // unresolved/unbalanced (e.g. an indirect reference) -- can't confirm it's trivial
  // PDF integers may carry an optional leading sign (Codex review, PR-B3,
  // round 5) -- comparing the parsed numeric value, not the raw digit
  // string, so "+1" is still recognized as trivial and "+12"/"-2" as not.
  const predictorMatch = /\/Predictor\s+([+-]?\d+)/.exec(value);
  if (!predictorMatch?.[1]) return false;
  return Number.parseInt(predictorMatch[1], 10) !== 1;
}

/**
 * Aggregate cap across every stream in one PDF (Codex review, PR-B3,
 * round 5) -- `MAX_STREAM_INFLATED_BYTES` alone only bounds a SINGLE
 * stream; up to `MAX_STREAMS_SCANNED` of them each inflating to just
 * under that limit could otherwise retain far more decompressed data in
 * memory at once than the PDF's own (much smaller) input size would
 * suggest. Each stream's decoded text is also scanned for a marker and
 * discarded immediately rather than accumulated in an array, so peak
 * memory stays bounded by one stream at a time, not the whole PDF's worth.
 */
const MAX_TOTAL_INFLATED_BYTES = 64 * 1024 * 1024;

function extractFlateStreams(text: string): {
  readonly marker: string | undefined;
  readonly undecodable: boolean;
} {
  let undecodable = false;
  let cursor = 0;
  let dictionaryStart = 0;
  let scanned = 0;
  let totalInflatedBytes = 0;
  for (; scanned < MAX_STREAMS_SCANNED; scanned++) {
    const found = findNextStreamKeyword(text, cursor);
    if (found.kind === 'not-found') break;
    if (found.kind === 'unterminated') {
      // An unclosed string/comment before any further real stream keyword
      // -- per the governing invariant, can't positively confirm nothing
      // more follows it.
      undecodable = true;
      break;
    }
    const { streamKeywordStart, dataStart } = found;
    // `endstream` is searched for in the RAW, unmasked text -- this search
    // always runs INSIDE a stream's own opaque compressed body, where
    // "comment" and "string" aren't PDF concepts at all, so masking never
    // applies here (see the long comment above `maskPdfNoise`).
    const endIndex = text.indexOf('endstream', dataStart);
    if (endIndex === -1) {
      // Malformed/truncated — whatever follows this point is unexamined.
      undecodable = true;
      break;
    }

    const governingDict = findGoverningDictionary(text, dictionaryStart, streamKeywordStart);
    if (governingDict === undefined) {
      // Can't positively identify which dictionary governs this stream —
      // per the governing invariant, unclear is undecidable, never "no filter".
      undecodable = true;
    } else {
      const filterClass = classifyFilterDeclaration(governingDict);
      if (filterClass === 'flate-in-chain' || filterClass === 'undecidable') {
        // A chained filter leaves real content still encoded after a single
        // inflate; an unrecognized filter (including one this scanner
        // can't decode itself, or an unresolved indirect reference) can't
        // be positively confirmed either way. Not attempting the rest of a
        // chain, or a filter this stays a bounded, dependency-free scanner
        // rather than a full PDF filter pipeline: undecidable, never
        // silently "decoded" or silently "nothing to find here".
        undecodable = true;
      } else if (filterClass === 'sole-flate') {
        const remainingBudget = MAX_TOTAL_INFLATED_BYTES - totalInflatedBytes;
        if (remainingBudget <= 0) {
          // Already spent the whole aggregate inflation budget on earlier
          // streams in this same PDF -- can't positively confirm this one.
          undecodable = true;
          break;
        }
        if (hasNontrivialPredictor(governingDict)) {
          undecodable = true;
        } else {
          // A trailing EOL before "endstream" is formatting, not stream
          // data — same three PDF-legal conventions as STREAM_KEYWORD_PATTERN.
          const raw = text.slice(dataStart, endIndex).replace(/(?:\r\n|\r|\n)$/, '');
          try {
            const inflated = inflateSync(Buffer.from(raw, 'latin1'), {
              maxOutputLength: Math.min(MAX_STREAM_INFLATED_BYTES, remainingBudget),
            });
            totalInflatedBytes += inflated.length;
            const marker = findActiveMarkerIn(inflated.toString('latin1'));
            if (marker) return { marker, undecodable: false };
          } catch {
            undecodable = true;
          }
        }
      }
    }
    cursor = endIndex + 'endstream'.length;
    dictionaryStart = cursor;
  }
  if (scanned === MAX_STREAMS_SCANNED && findNextStreamKeyword(text, cursor).kind !== 'not-found') {
    // Either a real stream keyword genuinely remains unscanned, or an
    // unclosed string/comment makes it impossible to positively confirm
    // one doesn't -- both are undecidable, never silently "done".
    undecodable = true;
  }
  return { marker: undefined, undecodable };
}

type PdfContentCheck =
  | { readonly kind: 'clean' }
  | { readonly kind: 'active-marker'; readonly marker: string }
  | { readonly kind: 'undecidable' };

function checkPdfContent(bytes: Uint8Array): PdfContentCheck {
  // latin1 is byte-transparent (1 char <-> 1 byte) — exactly what a raw
  // marker search over binary PDF bytes needs, with no UTF-8 decode risk.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const directMarker = findActiveMarkerIn(text);
  if (directMarker) return { kind: 'active-marker', marker: directMarker };

  const { marker, undecodable } = extractFlateStreams(text);
  if (marker) return { kind: 'active-marker', marker };
  if (undecodable) return { kind: 'undecidable' };
  return { kind: 'clean' };
}

/** Declared content types the plain-text path accepts — nothing else, regardless of byte shape. */
const PLAIN_TEXT_CONTENT_TYPES: ReadonlySet<string> = new Set(['text/plain', 'text/markdown']);

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Plain-text heuristic for TXT/MD (no magic bytes exist for them): the file
 * must decode as strict, well-formed UTF-8 with no NUL bytes and no control
 * characters other than tab/newline/carriage-return. This is the same
 * "reject anything binary-shaped" posture as the magic-byte deny list, just
 * applied to content that has no header signature to check instead.
 *
 * Decodes the WHOLE (already size-bounded) byte array rather than an
 * arbitrary sample — decoding a fixed-length prefix can split a multi-byte
 * UTF-8 sequence at the boundary and reject a perfectly valid file.
 */
function looksLikePlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (isControl || code === 0x7f) return false;
  }
  return true;
}

export interface BasicSafetyScannerOptions {
  readonly blobStore: BlobStore;
  /** Reject anything larger than this many bytes (default 25 MiB). */
  readonly maxBytes?: number;
}

export class BasicSafetyScanner implements MalwareScannerPort {
  readonly name = SCANNER_NAME;
  readonly version = SCANNER_VERSION;
  private readonly blobStore: BlobStore;
  private readonly maxBytes: number;

  constructor(options: BasicSafetyScannerOptions) {
    this.blobStore = options.blobStore;
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  }

  async scan(input: { bucket: 'QUARANTINE' | 'CLEAN'; objectKey: string }): Promise<ScanResult> {
    const object = await this.blobStore.getObject(input.objectKey);
    if (!object) return { safe: false, detail: 'object bytes not found' };
    const { bytes } = object;

    if (bytes.byteLength === 0) return { safe: false, detail: 'empty file' };
    if (bytes.byteLength > this.maxBytes) return { safe: false, detail: 'file exceeds size limit' };

    for (const deny of MAGIC_DENY) {
      if (startsWith(bytes, deny.bytes)) {
        return { safe: false, detail: `rejected: ${deny.label}` };
      }
    }

    if (startsWith(bytes, PDF_MAGIC)) {
      const check = checkPdfContent(bytes);
      if (check.kind === 'active-marker') {
        return { safe: false, detail: `rejected: active PDF content (${check.marker})` };
      }
      if (check.kind === 'undecidable') {
        return {
          safe: false,
          detail: 'rejected: pdf contains an encoded stream that could not be verified clean',
        };
      }
      return { safe: true, detail: 'pdf' };
    }

    if (startsWith(bytes, DOCX_ZIP_MAGIC)) {
      const structure = validateDocxStructure(bytes);
      if (!structure.valid) {
        return { safe: false, detail: `rejected: invalid docx structure (${structure.reason})` };
      }
      return { safe: true, detail: 'docx (zip)' };
    }

    for (const allow of MAGIC_ALLOW) {
      if (startsWith(bytes, allow.bytes)) return { safe: true, detail: allow.label };
    }
    if (PLAIN_TEXT_CONTENT_TYPES.has(object.contentType) && looksLikePlainText(bytes)) {
      return { safe: true, detail: 'text' };
    }
    return { safe: false, detail: 'unrecognized file type' };
  }
}
