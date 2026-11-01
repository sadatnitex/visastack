import { createMigratedPglite } from '@visastack/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  belowSeq,
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeSeqCursor,
  decodeTimeCursor,
  encodeSeqCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';

const SCOPE = 'applicant:7d4b2f2e-1111-4c3a-9d55-0a1b2c3d4e5f:history';
const OTHER = 'applicant:0b9e8c11-2222-4c3a-9d55-0a1b2c3d4e5f:history';
const KEY = { at: '2026-10-31T09:15:02.123456Z', id: '5b1f7c56-3d0e-4d36-a3a1-7b8f0c2d9e10' };

describe('clampLimit', () => {
  it('keeps a page between 1 and 100 and falls back to the default for nonsense', () => {
    expect(clampLimit(undefined)).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampLimit(Number.NaN)).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(PAGE_LIMIT_DEFAULT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(25.9)).toBe(25);
    expect(clampLimit(10_000)).toBe(PAGE_LIMIT_MAX);
    expect(clampLimit(undefined, 25)).toBe(25);
    expect(clampLimit(undefined, 500)).toBe(PAGE_LIMIT_MAX);
  });
});

describe('time cursors', () => {
  it('round-trips inside the same scope and hides the scope and position from plain sight', () => {
    const cursor = encodeTimeCursor(KEY, SCOPE);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('applicant');
    expect(decodeTimeCursor(cursor, SCOPE)).toEqual(KEY);
  });

  it('gives null, never another view, for a cursor made for a different scope', () => {
    expect(decodeTimeCursor(encodeTimeCursor(KEY, OTHER), SCOPE)).toBeNull();
  });

  it('gives null for anything malformed', () => {
    const forged = (body: unknown) => Buffer.from(JSON.stringify(body)).toString('base64url');
    const good = JSON.parse(Buffer.from(encodeTimeCursor(KEY, SCOPE), 'base64url').toString());
    for (const bad of [
      undefined,
      null,
      '',
      42,
      ['a'],
      'not base64!',
      'x'.repeat(600),
      Buffer.from('not json').toString('base64url'),
      forged([1, 2]),
      forged('text'),
      forged({ ...good, v: 2 }),
      forged({ ...good, t: '2026-10-31 09:15:02' }),
      forged({ ...good, t: '2026-10-31T09:15:02+06:00' }),
      forged({ ...good, t: '2026-13-45T99:99:99Z' }),
      forged({ ...good, t: '2026-02-30T00:00:00Z' }),
      forged({ ...good, t: '2026-02-29T00:00:00Z' }),
      forged({ ...good, t: '2026-04-31T00:00:00Z' }),
      forged({ ...good, t: '2026-10-31T24:00:00Z' }),
      forged({ ...good, t: '0000-01-01T00:00:00Z' }),
      forged({ ...good, i: 'abc' }),
      forged({ ...good, i: "x' or 1=1 --" }),
      forged({ ...good, i: 42 }),
      forged({ ...good, i: '' }),
    ]) {
      expect(decodeTimeCursor(bad, SCOPE)).toBeNull();
    }
  });

  it('accepts real edge dates and text ids when the list says its ids are codes', () => {
    for (const at of [
      '2028-02-29T23:59:59.999999Z',
      '0001-01-01T00:00:00Z',
      '9999-12-31T23:59:59Z',
    ]) {
      expect(decodeTimeCursor(encodeTimeCursor({ ...KEY, at }, SCOPE), SCOPE)?.at).toBe(at);
    }
    const coded = encodeTimeCursor({ ...KEY, id: 'pack:uk-visitor.v2' }, SCOPE);
    expect(decodeTimeCursor(coded, SCOPE)).toBeNull();
    expect(decodeTimeCursor(coded, SCOPE, 'code')?.id).toBe('pack:uk-visitor.v2');
  });

  it('refuses to make a cursor no reader would accept', () => {
    expect(() => encodeTimeCursor({ ...KEY, at: 'yesterday' }, SCOPE)).toThrow();
    expect(() => encodeTimeCursor({ ...KEY, id: '<script>' }, SCOPE)).toThrow();
    expect(() => encodeTimeCursor(KEY, '')).toThrow();
  });
});

describe('sequence cursors', () => {
  it('round-trips numbers, bigints and digit strings in the same scope only', () => {
    expect(decodeSeqCursor(encodeSeqCursor(42, SCOPE), SCOPE)).toEqual({ seq: '42' });
    expect(decodeSeqCursor(encodeSeqCursor(9_000_000_000_000_000_000n, SCOPE), SCOPE)).toEqual({
      seq: '9000000000000000000',
    });
    expect(decodeSeqCursor(encodeSeqCursor('7', OTHER), SCOPE)).toBeNull();
    expect(decodeSeqCursor(encodeTimeCursor(KEY, SCOPE), SCOPE)).toBeNull();
  });

  it('refuses negative, fractional, padded and out-of-range sequences', () => {
    for (const bad of [-1, 1.5, '01', '1e3', '9223372036854775808', '']) {
      expect(() => encodeSeqCursor(bad, SCOPE)).toThrow();
    }
  });
});

describe('toPage', () => {
  it('drops the extra row and points the cursor at the last row kept', () => {
    const rows = [5, 4, 3, 2];
    expect(toPage(rows, 3, (last) => `after-${last}`)).toEqual({
      items: [5, 4, 3],
      nextCursor: 'after-3',
    });
    expect(toPage(rows, 4, (last) => `after-${last}`)).toEqual({ items: rows, nextCursor: null });
    expect(toPage([], 3, () => 'never')).toEqual({ items: [], nextCursor: null });
    expect(() => toPage(rows, 0, () => 'never')).toThrow();
    expect(() => toPage(rows, 2.5, () => 'never')).toThrow();
    expect(toPage([1, 2, 3, 4, 5, 6], 150, () => 'never').items).toHaveLength(6);
  });
});

describe('paging a real table', () => {
  it('walks every row once, newest first, even when rows share a millisecond', async () => {
    const db = drizzle(await createMigratedPglite());
    await db.execute(sql`create table paging_probe (id uuid primary key, at timestamptz not null)`);
    // 23 rows: groups inside the same millisecond, some at the very same microsecond.
    // Offsets in microseconds: 0, 1, 0, 250, 251, 250, ... so several rows share one millisecond
    // and pairs share one microsecond.
    const values = Array.from({ length: 23 }, (_, n) => {
      const micros = Math.floor(n / 3) * 250 + (n % 3 === 1 ? 1 : 0);
      return {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        at: `2026-10-31T09:00:00.${String(micros).padStart(6, '0')}Z`,
      };
    });
    for (const row of values) {
      await db.execute(sql`insert into paging_probe values (${row.id}, ${row.at}::timestamptz)`);
    }
    const id = sql.raw('id');
    const at = sql.raw('at');
    const read = async (before: string | undefined) => {
      const key = decodeTimeCursor(before, SCOPE);
      const where = key ? sql`where ${olderThan(at, id, key)}` : sql``;
      const [first, second] = cursorOrder(at, id);
      const result = await db.execute<{ id: string; at_text: string }>(
        sql`select id, ${cursorTime(at)} as at_text from paging_probe ${where} order by ${first}, ${second} limit ${5 + 1}`,
      );
      return toPage(result.rows, 5, (last) =>
        encodeTimeCursor({ at: last.at_text, id: last.id }, SCOPE),
      );
    };
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await read(cursor);
      seen.push(...page.items.map((row) => row.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const expected = (
      await db.execute<{ id: string }>(sql`select id from paging_probe order by at desc, id desc`)
    ).rows.map((row) => row.id);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(23);
    // A cursor from another scope reads as the first page, not a later one.
    const foreign = encodeTimeCursor(
      { at: '2026-10-31T09:00:00.001Z', id: values[0]?.id ?? '' },
      OTHER,
    );
    expect((await read(foreign)).items.map((row) => row.id)).toEqual(expected.slice(0, 5));
  });

  it('pages by sequence number with belowSeq', async () => {
    const db = drizzle(await createMigratedPglite());
    await db.execute(sql`create table paging_seq (seq bigint primary key)`);
    await db.execute(sql`insert into paging_seq select generate_series(1, 12)`);
    const key = decodeSeqCursor(encodeSeqCursor(8, SCOPE), SCOPE);
    if (!key) throw new Error('cursor');
    const result = await db.execute<{ seq: string }>(
      sql`select seq::text as seq from paging_seq where ${belowSeq(sql.raw('seq'), key)} order by seq desc limit 3`,
    );
    expect(result.rows.map((row) => row.seq)).toEqual(['7', '6', '5']);
  });
});
