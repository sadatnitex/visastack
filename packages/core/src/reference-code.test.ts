import { describe, expect, it } from 'vitest';
import {
  REFERENCE_ALPHABET,
  REFERENCE_CODE_PATTERN,
  REFERENCE_KINDS,
  formatReferenceCode,
  generateReferenceCode,
  isIssuableReferenceCode,
  isValidReferenceCode,
  looksLikeMistypedReferenceCode,
  parseReferenceCode,
  readsAsReferenceCode,
  referenceCheckCharacter,
} from './reference-code';

/** A deterministic byte source (xorshift32) so the statistical tests are repeatable. */
function seededBytes(seed: number) {
  let x = seed >>> 0 || 1;
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      out[i] = x & 0xff;
    }
    return out;
  };
}

const withCheck = (kind: (typeof REFERENCE_KINDS)[number], payload: string) =>
  payload + referenceCheckCharacter(kind, payload);

describe('reference code format', () => {
  it('uses Crockford base32 without I, L, O or U, 32 characters, no repeats', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(32);
    expect(new Set(REFERENCE_ALPHABET).size).toBe(32);
    for (const c of 'ILOU') expect(REFERENCE_ALPHABET).not.toContain(c);
    for (const c of REFERENCE_ALPHABET)
      expect(`${c}${c}${c}${c}${c}${c}`).toMatch(REFERENCE_CODE_PATTERN);
  });

  it('generates 5 random characters and 1 check character that validates under its own type only', () => {
    const random = seededBytes(7);
    for (const kind of REFERENCE_KINDS) {
      for (let i = 0; i < 200; i += 1) {
        const code = generateReferenceCode(kind, { random });
        expect(code).toHaveLength(6);
        expect(code).toMatch(REFERENCE_CODE_PATTERN);
        expect(isValidReferenceCode(kind, code)).toBe(true);
        for (const other of REFERENCE_KINDS.filter((k) => k !== kind)) {
          expect(isValidReferenceCode(other, code)).toBe(false);
        }
      }
    }
  });

  it('can lengthen to 6 random characters later without changing the parser', () => {
    const code = generateReferenceCode('C', { payloadLength: 6, random: seededBytes(3) });
    expect(code).toHaveLength(7);
    expect(parseReferenceCode(`C-${code}`)).toEqual({ ok: true, kind: 'C', code });
    expect(() => generateReferenceCode('C', { payloadLength: 4 })).toThrow();
    expect(() => generateReferenceCode('C', { payloadLength: 8 })).toThrow();
  });

  it('uses the platform random generator by default', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateReferenceCode('D')));
    expect(codes.size).toBe(50);
  });

  it('formats with the type letter and a hyphen', () => {
    expect(formatReferenceCode('C', '7K2Q9M')).toBe('C-7K2Q9M');
  });
});

describe('the check character', () => {
  // Every pair of last two characters behind a fixed start, and a random sample, under every type.
  const payloads: string[] = [];
  for (const a of REFERENCE_ALPHABET)
    for (const b of REFERENCE_ALPHABET) payloads.push(`7K2${a}${b}`);
  const random = seededBytes(11);
  for (let i = 0; i < 400; i += 1) {
    payloads.push([...random(5)].map((byte) => REFERENCE_ALPHABET[byte & 31]).join(''));
  }

  it('catches every single wrong character', () => {
    const missed: string[] = [];
    for (const kind of REFERENCE_KINDS) {
      for (const payload of payloads) {
        const code = withCheck(kind, payload);
        for (let i = 0; i < code.length; i += 1) {
          for (const c of REFERENCE_ALPHABET) {
            const typo = code.slice(0, i) + c + code.slice(i + 1);
            if (c !== code[i] && isValidReferenceCode(kind, typo)) missed.push(`${kind}-${typo}`);
          }
        }
      }
    }
    expect(missed).toEqual([]);
  }, 30_000);

  it('catches every swap of two neighbouring characters', () => {
    const missed: string[] = [];
    for (const kind of REFERENCE_KINDS) {
      for (const payload of payloads) {
        const code = withCheck(kind, payload);
        for (let i = 0; i + 1 < code.length; i += 1) {
          const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
          if (code[i] !== code[i + 1] && isValidReferenceCode(kind, swapped))
            missed.push(`${kind}-${swapped}`);
        }
      }
    }
    expect(missed).toEqual([]);
  }, 30_000);

  it('proves both properties exhaustively for the check step itself', () => {
    // The step s' = 2s XOR d is a totally anti-symmetric quasigroup over
    // GF(32): for every state and every pair of different characters, the
    // two orders end in different states, and one character changes the state.
    const values = [...REFERENCE_ALPHABET].map((_, i) => i);
    const step = (s: number, d: number) => {
      const t = s << 1;
      return (t & 32 ? t ^ 0b100101 : t) ^ d;
    };
    for (const s of values) {
      for (const x of values) {
        for (const y of values) {
          if (x === y) continue;
          expect(step(s, x)).not.toBe(step(s, y));
          expect(step(step(s, x), y)).not.toBe(step(step(s, y), x));
        }
      }
    }
  }, 30_000);

  it('fails a code typed under the wrong type letter', () => {
    const code = withCheck('C', '7K2Q9');
    expect(isValidReferenceCode('C', code)).toBe(true);
    for (const kind of ['P', 'D', 'R'] as const)
      expect(isValidReferenceCode(kind, code)).toBe(false);
  });
});

describe('reading a typed code', () => {
  const code = withCheck('C', '7K2Q9');

  it('ignores case, spaces and hyphens, and reads O as 0 and I or L as 1', () => {
    for (const typed of [
      `C-${code}`,
      `c-${code.toLowerCase()}`,
      ` C ${code.slice(0, 3)} ${code.slice(3)} `,
      `C${code}`,
    ]) {
      expect(parseReferenceCode(typed)).toEqual({ ok: true, kind: 'C', code });
    }
    const withZeroAndOne = withCheck('D', '1K0Q9');
    expect(parseReferenceCode(`d-${withZeroAndOne.replace('1', 'l').replace('0', 'o')}`)).toEqual({
      ok: true,
      kind: 'D',
      code: withZeroAndOne,
    });
    expect(parseReferenceCode(`D-${withZeroAndOne.replace('1', 'I').replace('0', 'O')}`)).toEqual({
      ok: true,
      kind: 'D',
      code: withZeroAndOne,
    });
  });

  it('finds the type from the check character when the letter is left out', () => {
    for (const kind of REFERENCE_KINDS) {
      const bare = generateReferenceCode(kind, { random: seededBytes(5) });
      // A bare code that starts with a type letter followed by 5 characters is still bare.
      expect(parseReferenceCode(bare)).toEqual({ ok: true, kind, code: bare });
    }
  });

  it('says one character looks wrong for a typo, and refuses anything else as malformed', () => {
    const typo = `${code.slice(0, 5)}${code[5] === 'A' ? 'B' : 'A'}`;
    expect(parseReferenceCode(`C-${typo}`)).toEqual({ ok: false, reason: 'check_failed' });
    // A wrong type letter fails the check: it never lands on a record of another type.
    expect(parseReferenceCode(`D-${code}`)).toEqual({ ok: false, reason: 'check_failed' });
    for (const bad of [
      '',
      '   ',
      'C-',
      'C-7K2',
      'C-7K2Q9MXYZ12',
      `C-${code.slice(0, 5)}U`,
      'hello world',
      'C_7K2Q9M',
    ]) {
      expect(parseReferenceCode(bad).ok).toBe(false);
    }
    expect(parseReferenceCode(`C-${code.slice(0, 5)}U`)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('refuses a valid code of another type when one type is expected', () => {
    expect(parseReferenceCode(`C-${code}`, 'C')).toEqual({ ok: true, kind: 'C', code });
    expect(parseReferenceCode(`C-${code}`, 'R')).toEqual({ ok: false, reason: 'wrong_kind' });
  });
});

describe('codes that are never handed out', () => {
  it('refuses denylisted words, also when spelled with look-alike digits', () => {
    for (const code of [
      'A55XYZ',
      'ASS123',
      'SH1T22',
      'XP0RN2',
      'NAZ1K2',
      '5EX999',
      'MAG1QQ',
      'CH0D22',
    ]) {
      expect(isIssuableReferenceCode(code)).toBe(false);
    }
    expect(isIssuableReferenceCode('7K2Q9M')).toBe(true);
  });

  it('refuses one repeated character and anything starting 00 (kept for examples)', () => {
    expect(isIssuableReferenceCode('777777')).toBe(false);
    expect(isIssuableReferenceCode('00K2Q9')).toBe(false);
    expect(isIssuableReferenceCode('0K2Q9M')).toBe(true);
  });

  it('never generates one of them, even from a source that keeps offering them', () => {
    // First a payload that starts 00, then one that spells a word, then a normal one.
    const queue = [
      [0, 0, 1, 2, 3],
      [10, 5, 5, 1, 2],
      [7, 19, 2, 23, 9],
    ];
    const random = (length: number) => Uint8Array.from((queue.shift() ?? []).slice(0, length));
    const code = generateReferenceCode('C', { random });
    expect(code.startsWith('7K2Q9')).toBe(true);
    expect(isIssuableReferenceCode(code)).toBe(true);
  });

  it('gives up loudly rather than looping forever on a broken source', () => {
    expect(() => generateReferenceCode('C', { random: (n) => new Uint8Array(n) })).toThrow();
  });
});

describe('distribution', () => {
  it('spreads characters evenly over 100,000 codes (chi-square per position)', () => {
    const random = seededBytes(2026);
    const counts = Array.from({ length: 5 }, () => new Array<number>(32).fill(0));
    const n = 100_000;
    for (let i = 0; i < n; i += 1) {
      const code = generateReferenceCode('C', { random });
      for (let p = 0; p < 5; p += 1) {
        const position = counts[p] as number[];
        const index = REFERENCE_ALPHABET.indexOf(code[p] as string);
        position[index] = (position[index] ?? 0) + 1;
      }
    }
    for (const position of counts) {
      const expected = n / 32;
      const chi = position.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
      // 31 degrees of freedom; 61.1 is the 0.1% critical value. The denylist
      // removes so few codes that the spread stays well inside it.
      expect(chi).toBeLessThan(61.1);
    }
  }, 30_000);
});

describe('codes typed without a separator, and words that only look like codes', () => {
  it('reads a longer code typed bare that starts with a type letter', () => {
    // Find a 6-character payload for C that starts with D, so its bare form starts with a letter.
    let code = '';
    for (const second of REFERENCE_ALPHABET) {
      const payload = `D${second}N0GC`;
      const candidate = payload + referenceCheckCharacter('C', payload);
      // Skip the rare payload that also reads as a D code (that text is refused, see below).
      if (!isValidReferenceCode('D', candidate.slice(1))) {
        code = candidate;
        break;
      }
    }
    expect(parseReferenceCode(code)).toEqual({ ok: true, kind: 'C', code });
    // With the letter and a hyphen, the letter decides.
    expect(parseReferenceCode(`C-${code}`)).toEqual({ ok: true, kind: 'C', code });
    expect(parseReferenceCode(`D-${code.slice(1)}`)).toEqual({ ok: false, reason: 'check_failed' });
  });

  it('never has two valid readings of the same text, so it never has to guess', () => {
    for (const kind of REFERENCE_KINDS) {
      for (const a of REFERENCE_ALPHABET) {
        for (const b of REFERENCE_ALPHABET) {
          const payload = `7K2${a}${b}`;
          const whole = kind + payload + referenceCheckCharacter(kind, payload);
          expect(REFERENCE_KINDS.some((k) => isValidReferenceCode(k, whole))).toBe(false);
        }
      }
    }
  });

  it('treats a code as a lookup only when typed with its letter or holding a digit', () => {
    expect(readsAsReferenceCode('Germany').ok).toBe(false);
    expect(readsAsReferenceCode('Invoice').ok).toBe(false);
    expect(parseReferenceCode('Germany').ok).toBe(true); // why the rule exists
    const withDigit = generateReferenceCode('C', {
      random: () => Uint8Array.from([7, 19, 2, 23, 9]),
    });
    expect(readsAsReferenceCode(`C-${withDigit}`).ok).toBe(true);
    expect(readsAsReferenceCode(withDigit).ok).toBe(true);
    // A letters-only code is a lookup when typed with its letter and hyphen.
    expect(readsAsReferenceCode('R-GERMANY')).toEqual({ ok: true, kind: 'R', code: 'GERMANY' });
  });

  it('flags only text clearly typed as a code with one wrong character', () => {
    const code = withCheck('C', '7K2Q9');
    const typo = `C-${code.slice(0, 5)}${code[5] === 'A' ? 'B' : 'A'}`;
    expect(looksLikeMistypedReferenceCode(typo)).toBe(true);
    for (const text of [
      'D Rahman',
      'R Hossain',
      'P Sarker',
      'C Ahmed',
      'C-7K2Q9',
      `C-${code}`,
      'Germany',
    ]) {
      expect(looksLikeMistypedReferenceCode(text)).toBe(false);
    }
  });

  it('stays fast on long hostile input (no backtracking patterns)', () => {
    const hostile = `c\t${'\t\t'.repeat(50_000)}!`;
    const started = performance.now();
    expect(looksLikeMistypedReferenceCode(hostile)).toBe(false);
    expect(readsAsReferenceCode(hostile).ok).toBe(false);
    expect(parseReferenceCode(hostile).ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
