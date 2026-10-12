import { type Td3Result, parseTd3 } from './mrz';

/**
 * Rules-based deterministic document classification (master directive §11).
 *
 * A small, honestly-scoped first set. Below `CONFIDENCE_THRESHOLD`, the
 * result is `classifiedType: null` — "Review required" — never a guessed
 * type. Extending this list never requires a schema change (`classifiedType`
 * is free text), only adding a rule here.
 */

export const CONFIDENCE_THRESHOLD = 60;

export interface ClassificationResult {
  /** null when confidence did not clear the threshold — never a guess. */
  readonly classifiedType: string | null;
  /** 0-100. */
  readonly confidence: number;
  readonly reviewRequired: boolean;
  readonly rationale: string;
  /** Present only for PASSPORT, when a valid TD3 MRZ block was found. */
  readonly mrz?: Td3Result;
}

/** Find two adjacent 44-character MRZ-shaped lines anywhere in the text. */
function findTd3Lines(text: string): readonly [string, string] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/[ \t]/g, ''))
    .filter((l) => l.length > 0);
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i] ?? '';
    const l2 = lines[i + 1] ?? '';
    if (l1.length === 44 && l2.length === 44 && /^[A-Z0-9<]+$/.test(l1 + l2)) {
      return [l1, l2];
    }
  }
  return null;
}

interface KeywordRule {
  readonly type: string;
  readonly keywords: readonly RegExp[];
  /** Minimum distinct keyword hits required before this rule can fire at all. */
  readonly minHits: number;
}

const KEYWORD_RULES: readonly KeywordRule[] = [
  {
    type: 'BANK_STATEMENT',
    minHits: 2,
    keywords: [
      /account\s+statement/i,
      /statement\s+of\s+account/i,
      /opening\s+balance/i,
      /closing\s+balance/i,
      /transaction\s+history/i,
      /account\s+number/i,
    ],
  },
  {
    type: 'EMPLOYMENT_CERTIFICATE',
    minHits: 2,
    keywords: [
      /certify\s+that/i,
      /is\s+employed/i,
      /employment\s+certificate/i,
      /to\s+whom\s+it\s+may\s+concern/i,
      /(monthly|annual)\s+salary/i,
      /date\s+of\s+joining/i,
    ],
  },
];

/**
 * Every document type this platform's deterministic classifier can ever
 * produce (Part 8 AI-01 item 2, "document type suggestion") -- PASSPORT is
 * MRZ-derived rather than a `KEYWORD_RULES` entry, so it is named explicitly
 * rather than derived from that list alone. The AI classify port's own
 * allowed-type list (`ai.ts`) reads from this SAME export, so the model is
 * never able to propose a type this deterministic system could not itself
 * have produced, and the two vocabularies can never silently drift apart.
 */
export const CLASSIFIABLE_DOCUMENT_TYPES: readonly string[] = [
  'PASSPORT',
  ...KEYWORD_RULES.map((rule) => rule.type),
];

/**
 * Classify extracted document text. Passport detection is fully deterministic
 * (a valid TD3 MRZ with matching ICAO check digits) — everything else is a
 * confidence-scored keyword match that must clear `CONFIDENCE_THRESHOLD` or
 * else defers to human review.
 */
export function classifyDocumentText(text: string): ClassificationResult {
  const td3 = findTd3Lines(text);
  if (td3) {
    const parsed = parseTd3(td3);
    if (parsed.ok && parsed.value.checksValid) {
      return {
        classifiedType: 'PASSPORT',
        confidence: 100,
        reviewRequired: false,
        rationale: 'valid TD3 MRZ block found with matching ICAO check digits',
        mrz: parsed.value,
      };
    }
  }

  let best: { type: string; hits: number; total: number } | null = null;
  for (const rule of KEYWORD_RULES) {
    const hits = rule.keywords.filter((re) => re.test(text)).length;
    if (hits >= rule.minHits && (!best || hits > best.hits)) {
      best = { type: rule.type, hits, total: rule.keywords.length };
    }
  }

  if (!best) {
    return {
      classifiedType: null,
      confidence: 0,
      reviewRequired: true,
      rationale: 'no deterministic rule matched with enough confidence',
    };
  }

  const confidence = Math.round((best.hits / best.total) * 100);
  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      classifiedType: null,
      confidence,
      reviewRequired: true,
      rationale: `${best.type} rule matched ${best.hits}/${best.total} keywords, below the ${CONFIDENCE_THRESHOLD}% threshold`,
    };
  }

  return {
    classifiedType: best.type,
    confidence,
    reviewRequired: false,
    rationale: `${best.type} rule matched ${best.hits}/${best.total} keywords`,
  };
}
