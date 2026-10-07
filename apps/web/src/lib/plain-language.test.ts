import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { visibleText } from './visible-text.test-support';

/**
 * Owner instruction (2026-10-05): no engineering talk to the public unless it is
 * really needed. The public pages, the banner every page carries and the screens a
 * person lands on when something goes wrong are written for someone who has never
 * heard of the tools behind the product. This reads the text a visitor can see in
 * those files and fails if engineering vocabulary or tool names come back.
 *
 * It guards the words, not the meaning: a sentence can still be unclear. When a test
 * here fails, say the thing the way you would to a traveller, not by adding the word
 * to an allowance list.
 */

const WEB_SRC = fileURLToPath(new URL('..', import.meta.url));

/** Built from the code point so no tool rewrites it into the character itself. */
const EM_DASH = String.fromCharCode(0x2014);

/** What a visitor can read without signing in, and the screens shown when a page breaks. */
const PUBLIC_FILES: readonly string[] = [
  'app/page.tsx',
  'app/layout.tsx',
  'app/status/page.tsx',
  'app/status/status-client.tsx',
  'app/status/status-view.tsx',
  'app/status/capability-names.ts',
  'app/not-found.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
  'app/pilot-access-denied/page.tsx',
  'app/trust/page.tsx',
  'app/trust/[packKey]/page.tsx',
  'components/pilot-banner.tsx',
];

const ENGINEERING_TALK: readonly { readonly pattern: RegExp; readonly say: string }[] = [
  { pattern: /\b(vercel|neon|workos|postgres|clamav)\b/i, say: 'do not name the tools behind it' },
  { pattern: /\bMRZ\b/, say: '"passport details"' },
  {
    pattern: /\b(tamper-evident|append-only|audit chain)\b/i,
    say: '"a record that cannot be quietly changed"',
  },
  { pattern: /\b(immutable|atomic|atomically|idempotent)\b/i, say: 'say what the person sees' },
  { pattern: /\b(opaque|checksum|checksummed|hash|hashed)\b/i, say: 'leave the mechanism out' },
  { pattern: /\bstep-up\b/i, say: '"extra identity confirmation"' },
  { pattern: /\b(provider-agnostic|ports?)\b/i, say: 'leave the architecture out' },
  { pattern: /\b(fail-closed|default-deny|deterministic|invariants?)\b/i, say: 'plain promise' },
  { pattern: /\b(liveness|readiness|health probes?)\b/i, say: '"what works today"' },
  {
    pattern: /\b(api|json|sdk|webhook|endpoint|backend|frontend|pipeline|schema|migration)\b/i,
    say: 'engineering word',
  },
  { pattern: /\/api\//, say: 'a path is not for visitors' },
  { pattern: /\bcore v\d/i, say: 'a version number means nothing to a visitor' },
  { pattern: /\b(remote-first|pack-composable)\b/i, say: 'internal description' },
  { pattern: /\b(quarantine|normali[sz]e|extraction)\b/i, say: 'say what happens to the document' },
  { pattern: /\b(unconfigured|degraded|not_ready)\b/, say: 'raw state code' },
  { pattern: new RegExp(EM_DASH), say: 'no em dash in written text' },
];

const visible = PUBLIC_FILES.flatMap((file) => {
  const path = join(WEB_SRC, file);
  return visibleText(path, readFileSync(path, 'utf8'));
});

describe('the guard itself', () => {
  it('reads the public pages it is meant to check', () => {
    const text = visible.map((v) => v.text);
    expect(text).toContain('One profile. Every visa.');
    expect(text).toContain('What works today');
    expect(text.some((t) => t.startsWith('Open test version'))).toBe(true);
    expect(visible.length).toBeGreaterThan(40);
  });

  it('recognises each kind of engineering talk it is written to catch', () => {
    const samples: Record<number, string> = {
      0: 'Built on Vercel and Neon',
      1: 'deterministic passport-MRZ parsing',
      2: 'an append-only audit chain',
      3: 'every value is an immutable version',
      4: 'checksummed packs',
      5: 'step-up authentication',
      6: 'Provider-agnostic ports',
      7: 'Default-deny permissions',
      8: 'Polled from the readiness probe',
      9: 'a JSON endpoint',
      10: 'see /api/health/ready',
      11: 'Universal Core v0.0.0',
      12: 'Remote-first delivery',
      13: 'Quarantine, scan, normalize',
      14: 'status: unconfigured',
      15: `one thing ${EM_DASH} another`,
    };
    ENGINEERING_TALK.forEach((rule, index) => {
      const sample = samples[index];
      expect(sample, `a sample for rule ${index}`).toBeDefined();
      expect(rule.pattern.test(sample ?? ''), `rule ${index} should match "${sample}"`).toBe(true);
    });
  });

  it('does not mistake ordinary words for jargon', () => {
    const ordinary = [
      'Upload your passport',
      'We support Bangla',
      'Report a problem',
      'Your data is kept only as long as it is needed',
      'VisaStack private pilot',
    ];
    for (const sentence of ordinary) {
      for (const rule of ENGINEERING_TALK) {
        expect(rule.pattern.test(sentence), `"${sentence}" matched ${rule.pattern}`).toBe(false);
      }
    }
  });
});

describe('public pages use everyday words', () => {
  for (const { pattern, say } of ENGINEERING_TALK) {
    it(`has no visible text matching ${pattern} (${say})`, () => {
      const hits = visible
        .filter((v) => pattern.test(v.text))
        .map((v) => `${relative(WEB_SRC, v.file)}:${v.line}: ${JSON.stringify(v.text)}`);
      expect(hits, hits.join('\n')).toEqual([]);
    });
  }
});
